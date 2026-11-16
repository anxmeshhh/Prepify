// Prepify Capture — background service worker.
// Nothing is sent to any server of ours: captured experiences, questions, answers and discussions
// are handed straight to the open Prepify tab, which keeps them only for that browser session.
//
// Research jobs, started from a signed-in Prepify page:
//  * Tab sources (Glassdoor, AmbitionBox, Indeed, GeeksforGeeks): the company's pages open in a
//    background tab of the user's own signed-in browser, content.js reads them, the tab closes.
//    Limits: at most MAX_HOPS navigations plus MAX_ARTICLES article pages per site, no pagination.
//  * Reddit: public JSON listing + the top threads' comments (a handful of requests, no login).
const MAX_HOPS = 3;
const MAX_ARTICLES = 4;
const JOB_TIMEOUT_MS = 60000;
const APP_URLS = ['http://localhost:5000/*', 'http://127.0.0.1:5000/*'];

const START_URL = {
  Glassdoor: (c) => `https://www.glassdoor.co.in/Search/results.htm?keyword=${encodeURIComponent(c)}`,
  AmbitionBox: (c) => `https://www.ambitionbox.com/search?q=${encodeURIComponent(c)}`,
  Indeed: (c) => `https://in.indeed.com/companies/search?q=${encodeURIComponent(c)}`,
  GeeksforGeeks: (c) => `https://www.geeksforgeeks.org/search/?gq=${encodeURIComponent(c + ' interview experience')}`
};
const API_SOURCES = { Reddit: pullReddit };

// jobs live in session storage because the worker can be suspended between page loads
async function getJobs() {
  return (await chrome.storage.session.get('jobs')).jobs || {};
}
async function setJobs(jobs) {
  await chrome.storage.session.set({ jobs });
}

function notifyUi(job, status, extra = {}) {
  chrome.tabs.sendMessage(job.uiTabId, {
    type: 'research:update', site: job.site, company: job.company, status, ...extra
  }).catch(() => {});
}

const emptyPayload = (job) => ({ source: job.site, url: '', company_name: job.company, questions: [], reviews: [], experiences: [] });
function mergeInto(acc, p) {
  acc.questions.push(...(p.questions || []));
  acc.reviews.push(...(p.reviews || []));
  acc.experiences.push(...(p.experiences || []));
  if (!acc.url) acc.url = p.url;
}
const hasContent = (p) => p && (p.questions.length || p.reviews.length || p.experiences.length);

async function finishJob(tabId, status, extra = {}) {
  const jobs = await getJobs();
  const job = jobs[tabId];
  if (!job) return;
  delete jobs[tabId];
  await setJobs(jobs);
  // articles already read count even if a later one failed
  if (status !== 'done' && hasContent(job.acc)) { status = 'done'; extra = { ...extra, payload: job.acc }; }
  notifyUi(job, status, extra);
  // A sign-in wall or "verify you're human" check needs the user: leave that tab open for them.
  if (status === 'login' || status === 'blocked') return;
  chrome.tabs.remove(Number(tabId)).catch(() => {});
}

async function startResearch(company, sites, uiTabId) {
  for (const site of sites) {
    if (API_SOURCES[site]) { runApiSource(site, company, uiTabId); continue; }
    if (!START_URL[site]) continue;
    const tab = await chrome.tabs.create({ url: START_URL[site](company), active: false });
    const jobs = await getJobs();               // save before the page can ask "whoami"
    jobs[tab.id] = { site, company, uiTabId, hops: 0, queue: [], read: 0, acc: null, started: Date.now() };
    await setJobs(jobs);
    notifyUi(jobs[tab.id], 'working');
    setTimeout(() => finishJob(tab.id, 'timeout'), JOB_TIMEOUT_MS);
  }
}

async function runApiSource(site, company, uiTabId) {
  const job = { site, company, uiTabId };
  notifyUi(job, 'working', { step: 'searching ' + site });
  try {
    const payload = await API_SOURCES[site](company, (step) => notifyUi(job, 'working', { step }));
    notifyUi(job, hasContent(payload) ? 'done' : 'empty', { payload });
  } catch (e) {
    notifyUi(job, 'error', { detail: String(e.message || e) });
  }
}

// ---------- Reddit: threads about the company's interviews, with top comments ----------
async function pullReddit(company, progress) {
  const word = company.toLowerCase().split(/\s+/)[0];
  const q = encodeURIComponent(`${company} interview`);
  const res = await fetch(`https://www.reddit.com/search.json?q=${q}&sort=relevance&t=all&limit=25&type=link`, { credentials: 'include' });
  if (!res.ok) throw new Error(`Reddit search returned ${res.status}`);
  const listing = await res.json();
  const posts = (listing.data && listing.data.children || []).map(c => c.data)
    .filter(p => !p.over_18 && (p.title + ' ' + p.selftext).toLowerCase().includes(word)
      && /interview|hiring|offer|round|placement|recruit|selected|rejected|onsite|oa\b|assessment/i.test(p.title + ' ' + p.selftext))
    .slice(0, 6);

  const payload = { source: 'Reddit', url: `https://www.reddit.com/search/?q=${q}`, company_name: company,
                    questions: [], reviews: [], experiences: [] };
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    progress(`reading thread ${i + 1} of ${posts.length}`);
    let discussion = [];
    try {
      const t = await (await fetch(`https://www.reddit.com/comments/${p.id}.json?limit=50&depth=1&sort=top`, { credentials: 'include' })).json();
      discussion = (t[1] && t[1].data.children || [])
        .filter(c => c.kind === 't1' && c.data.body && !/^\[(deleted|removed)\]$/.test(c.data.body))
        .map(c => ({ text: c.data.body.slice(0, 1500), score: c.data.score }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);
    } catch (e) { /* thread unavailable: keep the post itself */ }
    const body = (p.selftext || '').slice(0, 4000);
    const questions = (body.match(/[^.!?\n]{12,300}\?/g) || []).map(s => ({ text: s.trim(), answers: [] })).slice(0, 15);
    payload.experiences.push({
      role: p.title, date: new Date(p.created_utc * 1000).toISOString().slice(0, 10), location: 'r/' + p.subreddit,
      outcome: '', experience: '', difficulty: '', application: '', process: body, rounds: [], questions, tips: '',
      discussion, score: p.score, comments: p.num_comments, url: 'https://www.reddit.com' + p.permalink
    });
    payload.questions.push(...questions.map(q2 => ({ ...q2, role: p.title })));
  }
  return payload;
}

// Hands a manual capture to every open Prepify tab. Returns how many tabs received it.
async function sendToApp(payload) {
  const tabs = await chrome.tabs.query({ url: APP_URLS });
  await Promise.all(tabs.map(t => chrome.tabs.sendMessage(t.id, { type: 'capture', payload }).catch(() => {})));
  return tabs.length;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab && sender.tab.id;

  if (msg.type === 'capture') {               // "Save to Prepify" button on a page
    sendToApp(msg.payload).then(n => sendResponse(n
      ? { ok: true }
      : { ok: false, error: 'Open Prepify (localhost:5000) in a tab first' }));
    return true;
  }

  if (msg.type === 'research:start') {
    startResearch(msg.company, msg.sites || [...Object.keys(START_URL), ...Object.keys(API_SOURCES)], tabId);
    return false;
  }

  if (msg.type === 'research:whoami') {
    getJobs().then(jobs => sendResponse(jobs[tabId] || null));
    return true;
  }

  if (msg.type === 'research:navigate') {
    getJobs().then(async jobs => {
      const job = jobs[tabId];
      if (!job) return sendResponse(false);
      if (job.hops >= MAX_HOPS) { await finishJob(tabId, 'not-found'); return sendResponse(false); }
      job.hops += 1;
      await setJobs(jobs);
      notifyUi(job, 'working', { step: msg.step || 'opening page' });
      chrome.tabs.update(tabId, { url: msg.url });
      sendResponse(true);
    });
    return true;
  }

  // a search page found several articles: read them one after another in the same tab
  if (msg.type === 'research:queue') {
    getJobs().then(async jobs => {
      const job = jobs[tabId];
      if (!job) return;
      job.queue = (msg.urls || []).slice(0, MAX_ARTICLES);
      job.acc = job.acc || emptyPayload(job);
      const next = job.queue.shift();
      await setJobs(jobs);
      if (!next) return finishJob(tabId, 'not-found');
      notifyUi(job, 'working', { step: `reading article 1 of ${job.queue.length + 1}` });
      chrome.tabs.update(tabId, { url: next });
    });
    return false;
  }

  // one article read: keep it, move to the next or finish
  if (msg.type === 'research:partial') {
    getJobs().then(async jobs => {
      const job = jobs[tabId];
      if (!job) return;
      job.acc = job.acc || emptyPayload(job);
      mergeInto(job.acc, msg.payload || {});
      job.read += 1;
      const next = job.queue.shift();
      await setJobs(jobs);
      if (next) {
        notifyUi(job, 'working', { step: `reading article ${job.read + 1} of ${job.read + 1 + job.queue.length}` });
        chrome.tabs.update(tabId, { url: next });
      } else {
        finishJob(tabId, hasContent(job.acc) ? 'done' : 'empty', { payload: job.acc });
      }
    });
    return false;
  }

  if (msg.type === 'research:result') {       // payload travels to the Prepify tab with the status
    finishJob(tabId, msg.status, { url: msg.url, payload: msg.payload, detail: msg.detail });
    return false;
  }
});

// a research tab the user closes counts as cancelled
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const jobs = await getJobs();
  if (jobs[tabId]) {
    const job = jobs[tabId];
    delete jobs[tabId];
    await setJobs(jobs);
    notifyUi(job, hasContent(job.acc) ? 'done' : 'cancelled', hasContent(job.acc) ? { payload: job.acc } : {});
  }
});

// ---------- right-click: save selected text as a question ----------
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'save-selection',
    title: 'Save selection to Prepify as a question',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'save-selection' || !info.selectionText) return;
  const host = new URL(tab.url).hostname;
  const source = host.includes('ambitionbox') ? 'AmbitionBox' : host.includes('glassdoor') ? 'Glassdoor'
    : host.includes('indeed') ? 'Indeed' : host.includes('geeksforgeeks') ? 'GeeksforGeeks' : host;
  const n = await sendToApp({ source, url: tab.url, questions: [{ text: info.selectionText.trim() }] });
  const msg = n ? 'Sent to Prepify' : 'Open Prepify (localhost:5000) in a tab first';
  chrome.tabs.sendMessage(tab.id, { type: 'toast', text: msg }).catch(() => {});
});
