// Prepify Capture — background service worker.
// Nothing is sent to any server of ours: captured experiences, questions, answers and discussions
// are handed straight to the open Prepify tab, which keeps them only for that browser session.
//
// Research jobs, started from a signed-in Prepify page:
//  * Tab sources (Glassdoor, AmbitionBox, Indeed, GeeksforGeeks): the company's pages open in a
//    background tab of the user's own signed-in browser, content.js reads them, the tab closes.
//    Limits: at most MAX_HOPS navigations plus MAX_ARTICLES article pages per site, no pagination.
//  * Reddit: old.reddit.com search, then up to MAX_ARTICLES threads with their top comments.
const MAX_HOPS = 3;
const MAX_ARTICLES = 4;
const JOB_TIMEOUT_MS = 60000;
const APP_URLS = ['http://localhost:5000/*', 'http://127.0.0.1:5000/*'];

const START_URL = {
  Glassdoor: (c) => `https://www.glassdoor.co.in/Search/results.htm?keyword=${encodeURIComponent(c)}`,
  AmbitionBox: (c) => `https://www.ambitionbox.com/search?q=${encodeURIComponent(c)}`,
  Indeed: (c) => `https://in.indeed.com/companies/search?q=${encodeURIComponent(c)}`,
  GeeksforGeeks: (c) => `https://www.geeksforgeeks.org/search/?gq=${encodeURIComponent(c + ' interview experience')}`,
  // old.reddit.com is plain HTML: search, then read the top threads like articles
  Reddit: (c) => `https://old.reddit.com/search?q=${encodeURIComponent(c + ' interview')}&sort=relevance&t=all`,
  LeetCode: (c) => `https://leetcode.com/discuss/interview-experience?currentPage=1&orderBy=most_relevant&query=${encodeURIComponent(c)}`,
  PrepInsta: (c) => `https://prepinsta.com/?s=${encodeURIComponent(c + ' interview')}`,
  Code360: (c) => `https://www.naukri.com/code360/interview-experiences/${c.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
};
const API_SOURCES = {};

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
  // A sign-in wall or "verify you're human" check needs the user: keep that tab, put it just to the
  // left of the Prepify tab, and watch it so Prepify can retry once the wall is gone.
  if (status === 'login' || status === 'blocked') {
    await placeBesideApp(Number(tabId), job.uiTabId);
    await rememberLoginTab(Number(tabId), job, status);
    notifyUi(job, status, extra);
    return;
  }
  notifyUi(job, status, extra);
  chrome.tabs.remove(Number(tabId)).catch(() => {});
}

// ---------- sign-in tabs: the user signs in there, we notice when they're done ----------
async function getLoginTabs() {
  return (await chrome.storage.session.get('loginTabs')).loginTabs || {};
}
async function setLoginTabs(t) {
  await chrome.storage.session.set({ loginTabs: t });
}
async function rememberLoginTab(tabId, job, reason) {
  const t = await getLoginTabs();
  t[tabId] = { site: job.site, company: job.company, uiTabId: job.uiTabId, reason };
  await setLoginTabs(t);
}
async function placeBesideApp(tabId, uiTabId) {
  try {
    const ui = await chrome.tabs.get(uiTabId);
    const tab = await chrome.tabs.get(tabId);
    if (tab.windowId !== ui.windowId) await chrome.tabs.move(tabId, { windowId: ui.windowId, index: ui.index });
    else await chrome.tabs.move(tabId, { index: Math.max(0, tab.index < ui.index ? ui.index - 1 : ui.index) });
  } catch (e) { /* tab or window gone */ }
}
async function focusTab(tabId) {
  const tab = await chrome.tabs.update(tabId, { active: true });
  if (tab && tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
}

// Prepify asked to show the sign-in page for a site: reuse the waiting tab or open a new one.
async function openLogin(site, company, uiTabId) {
  const t = await getLoginTabs();
  const found = Object.entries(t).find(([, v]) => v.site === site && v.uiTabId === uiTabId);
  if (found) {
    try { await focusTab(Number(found[0])); return; } catch (e) { delete t[found[0]]; await setLoginTabs(t); }
  }
  if (!START_URL[site]) return;
  const tab = await chrome.tabs.create({ url: START_URL[site](company), active: true });
  await placeBesideApp(tab.id, uiTabId);
  await rememberLoginTab(tab.id, { site, company, uiTabId }, 'login');
}

async function loginCleared(tabId) {
  const t = await getLoginTabs();
  const info = t[tabId];
  if (!info) return;
  delete t[tabId];
  await setLoginTabs(t);
  chrome.tabs.sendMessage(info.uiTabId, { type: 'research:update', site: info.site, company: info.company, status: 'login-cleared' }).catch(() => {});
  try { await focusTab(info.uiTabId); } catch (e) { /* Prepify tab closed */ }
  chrome.tabs.remove(tabId).catch(() => {});
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

  if (msg.type === 'login:open') {               // from Prepify: show me the sign-in page
    openLogin(msg.site, msg.company, tabId);
    return false;
  }

  if (msg.type === 'login:whoami') {              // from a site tab: am I a sign-in tab?
    getLoginTabs().then(t => sendResponse(t[tabId] || null));
    return true;
  }

  if (msg.type === 'login:cleared') {             // from a sign-in tab: the wall is gone
    loginCleared(tabId);
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
      job.reading = true;                      // pages from here on are articles, never list pages
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

// a research tab the user closes counts as cancelled; a closed sign-in tab is reported too
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const logins = await getLoginTabs();
  if (logins[tabId]) {
    const info = logins[tabId];
    delete logins[tabId];
    await setLoginTabs(logins);
    chrome.tabs.sendMessage(info.uiTabId, { type: 'research:update', site: info.site, company: info.company, status: 'login-closed' }).catch(() => {});
  }
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
    : host.includes('indeed') ? 'Indeed' : host.includes('geeksforgeeks') ? 'GeeksforGeeks'
    : host.includes('reddit') ? 'Reddit' : host.includes('leetcode') ? 'LeetCode'
    : host.includes('prepinsta') ? 'PrepInsta' : host.includes('naukri') ? 'Code360' : host;
  const n = await sendToApp({ source, url: tab.url, questions: [{ text: info.selectionText.trim() }] });
  const msg = n ? 'Sent to Prepify' : 'Open Prepify (localhost:5000) in a tab first';
  chrome.tabs.sendMessage(tab.id, { type: 'toast', text: msg }).catch(() => {});
});
