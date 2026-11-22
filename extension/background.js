// Prepify Capture — background service worker.
// Nothing is sent to any server of ours: captured experiences, questions, answers and discussions
// are handed straight to the open Prepify tab, which keeps them only for that browser session.
//
// Research jobs, started from a signed-in Prepify page:
//  * Tab sources (Glassdoor, AmbitionBox, Indeed, GeeksforGeeks): the company's pages open in a
//    background tab of the user's own signed-in browser, content.js reads them, the tab closes.
//    Limits: at most MAX_HOPS navigations plus MAX_ARTICLES article pages per site, no pagination.
//  * Reddit: old.reddit.com search, then up to MAX_ARTICLES threads with their top comments.
// Speed: a search page's articles are read in parallel background tabs (at most MAX_OPEN_ARTICLES at
// once across all sites), and Prepify's own background tabs skip images, video and fonts (text is all
// that's read). Tabs the user sees, such as a sign-in page, load normally.
const MAX_HOPS = 3;
const MAX_ARTICLES = 4;
const MAX_OPEN_ARTICLES = 8;
const JOB_TIMEOUT_MS = 60000;
const ARTICLE_TIMEOUT_MS = 25000;
const APP_URLS = ['http://localhost:5000/*', 'http://127.0.0.1:5000/*'];

const START_URL = {
  Glassdoor: (c) => `https://www.glassdoor.co.in/Search/results.htm?keyword=${encodeURIComponent(c)}`,
  AmbitionBox: (c) => `https://www.ambitionbox.com/search?q=${encodeURIComponent(c)}`,
  Indeed: (c) => `https://in.indeed.com/companies/search?q=${encodeURIComponent(c)}`,
  GeeksforGeeks: (c) => `https://www.geeksforgeeks.org/search/?gq=${encodeURIComponent(c + ' interview experience')}`,
  // old.reddit.com is plain HTML: search, then read the top threads like articles
  Reddit: (c) => `https://old.reddit.com/search?q=${encodeURIComponent(c + ' interview')}&sort=relevance&t=all`,
  LeetCode: (c) => `https://leetcode.com/discuss/interview-experience?currentPage=1&orderBy=most_relevant&query=${encodeURIComponent(c)}`,
  // PrepInsta's search sends you to a 404; its company pages live at /<company>/ (e.g. /tcs/)
  PrepInsta: (c) => `https://prepinsta.com/${c.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')[0]}/`,
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
// Read-modify-write of the jobs, one at a time: parallel article tabs report at the same moment.
let jobsLock = Promise.resolve();
function withJobs(fn) {
  const run = jobsLock.then(async () => {
    const jobs = await getJobs();
    const out = await fn(jobs);
    await setJobs(jobs);
    return out;
  });
  jobsLock = run.catch(() => {});
  return run;
}

// ---------- lighter background tabs: no images, video or fonts in tabs Prepify opened for reading ----------
async function lighten(tabId) {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [tabId],
      addRules: [{ id: tabId, priority: 1, action: { type: 'block' },
                   condition: { tabIds: [tabId], resourceTypes: ['image', 'media', 'font'] } }]
    });
  } catch (e) { /* not available: the tab just loads everything */ }
}
function unlighten(tabId) {
  chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [Number(tabId)] }).catch(() => {});
}

// A background tab for reading: opened blank, lightened and registered, then sent to the page, so the
// page's first question ("am I a research tab?") always finds its job.
async function openReadingTab(url, job, timeoutMs, onTimeout) {
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  await lighten(tab.id);
  await withJobs(jobs => { jobs[tab.id] = job; });
  await chrome.tabs.update(tab.id, { url });
  setTimeout(() => onTimeout(tab.id), timeoutMs);
  return tab.id;
}

// ---------- articles read in parallel: each a child tab of its site's job ----------
const articleQueue = [];      // [{ parentId, url }] waiting for a free slot
let openArticles = 0;

function queueArticles(parentId, urls) {
  urls.forEach(url => articleQueue.push({ parentId, url }));
  pumpArticles();
}

async function pumpArticles() {
  while (openArticles < MAX_OPEN_ARTICLES && articleQueue.length) {
    const { parentId, url } = articleQueue.shift();
    const parent = (await getJobs())[parentId];
    if (!parent) continue;                       // the site's job already ended
    openArticles += 1;
    try {
      await openReadingTab(url, { child: true, parent: parentId, site: parent.site, company: parent.company,
                                  uiTabId: parent.uiTabId, reading: true, located: parent.located, match: parent.match },
                           ARTICLE_TIMEOUT_MS, (id) => articleDone(id, null));
    } catch (e) {
      openArticles -= 1;
      articleDone(null, null, parentId);
    }
  }
}

// One article finished (payload), failed or timed out (null). When the site's last one is in, the site is done.
async function articleDone(childId, payload, parentIdIfNoTab = null, wall = null) {
  const r = await withJobs(jobs => {
    let parentId = parentIdIfNoTab;
    if (childId !== null) {
      const c = jobs[childId];
      if (!c) return { gone: true };             // already counted (finished, then timed out)
      delete jobs[childId];
      parentId = c.parent;
    }
    const parent = jobs[parentId];
    if (!parent) return { closed: true };
    parent.acc = parent.acc || emptyPayload(parent);
    if (payload) mergeInto(parent.acc, payload);
    if (wall && !parent.wall) parent.wall = wall;
    parent.read += 1;
    parent.pending -= 1;
    return { parentId, job: JSON.parse(JSON.stringify(parent)) };
  });
  if (r && r.gone) return;
  if (childId !== null) {
    unlighten(childId);
    chrome.tabs.remove(Number(childId)).catch(() => {});
    openArticles = Math.max(0, openArticles - 1);
    pumpArticles();
  }
  if (!r || r.closed) return;
  const { parentId, job } = r;
  if (job.pending > 0) {
    notifyUi(job, 'working', { step: `read ${job.read} of ${job.total} ${job.site === 'Reddit' ? 'threads' : 'articles'}` });
  } else if (hasContent(job.acc)) {
    finishJob(parentId, 'done', { payload: job.acc });
  } else {
    finishJob(parentId, job.wall || 'empty');    // nothing read: a sign-in or check stopped the articles
  }
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
  const r = await withJobs(jobs => {
    const job = jobs[tabId];
    if (!job) return null;
    delete jobs[tabId];
    // its article tabs still open (the site timed out): close them
    const children = Object.keys(jobs).filter(id => jobs[id].parent === Number(tabId) || jobs[id].parent === tabId);
    children.forEach(id => delete jobs[id]);
    return { job, children };
  });
  if (!r) return;
  const { job, children } = r;
  children.forEach(id => { unlighten(id); chrome.tabs.remove(Number(id)).catch(() => {}); });
  if (children.length) { openArticles = Math.max(0, openArticles - children.length); pumpArticles(); }
  unlighten(tabId);
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

async function startResearch(company, sites, uiTabId, urls = {}, match = {}) {
  const running = Object.values(await getJobs())
    .filter(j => !j.child && j.uiTabId === uiTabId && (j.company || '').toLowerCase() === (company || '').toLowerCase())
    .map(j => j.site);
  for (const site of sites) {
    if (running.includes(site)) continue;        // already being pulled for this tab: never two jobs for one site
    if (API_SOURCES[site]) { runApiSource(site, company, uiTabId); continue; }
    if (!START_URL[site]) continue;
    // Prepify may already know the company's page on this site (from the site's own index)
    const located = urls && typeof urls[site] === 'string' && /^https:\/\//.test(urls[site]) ? urls[site] : null;
    const job = { site, company, uiTabId, hops: 0, read: 0, pending: 0, total: 0, acc: null, started: Date.now(),
                  located: !!located, match: Array.isArray(match && match[site]) ? match[site].slice(0, 4) : [] };
    notifyUi(job, 'working');
    // all sites start together; none waits for another
    openReadingTab(located || START_URL[site](company), job, JOB_TIMEOUT_MS, (id) => finishJob(id, 'timeout'))
      .catch(e => notifyUi(job, 'error', { detail: String(e.message || e) }));
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
    startResearch(msg.company, msg.sites || [...Object.keys(START_URL), ...Object.keys(API_SOURCES)], tabId, msg.urls, msg.match);
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
    withJobs(jobs => {
      const job = jobs[tabId];
      if (!job || job.child) return null;
      if (job.hops >= MAX_HOPS) return 'limit';
      job.hops += 1;
      return { ...job };
    }).then(async job => {
      if (job === 'limit') { await finishJob(tabId, 'not-found'); return sendResponse(false); }
      if (!job) return sendResponse(false);
      notifyUi(job, 'working', { step: msg.step || 'opening page' });
      chrome.tabs.update(tabId, { url: msg.url });
      sendResponse(true);
    });
    return true;
  }

  // a search page found several articles: read them all at once, each in its own background tab
  if (msg.type === 'research:queue') {
    const urls = [...new Set(msg.urls || [])].slice(0, MAX_ARTICLES);
    withJobs(jobs => {
      const job = jobs[tabId];
      if (!job || job.child) return null;
      job.acc = job.acc || emptyPayload(job);
      job.pending = urls.length;
      job.total = urls.length;
      job.read = 0;
      return { ...job };
    }).then(job => {
      if (!job) return;
      if (!urls.length) return finishJob(tabId, 'not-found');
      notifyUi(job, 'working', { step: `reading ${urls.length} ${job.site === 'Reddit' ? 'threads' : 'articles'}` });
      queueArticles(tabId, urls);
    });
    return false;
  }

  // an article read (in its own tab), or a site's page that is itself the article
  if (msg.type === 'research:partial') {
    getJobs().then(jobs => {
      const job = jobs[tabId];
      if (!job) return;
      if (job.child) return articleDone(tabId, msg.payload || null);
      const payload = { ...emptyPayload(job), ...(msg.payload || {}) };
      finishJob(tabId, hasContent(payload) ? 'done' : 'empty', { payload });
    });
    return false;
  }

  if (msg.type === 'research:result') {       // payload travels to the Prepify tab with the status
    getJobs().then(jobs => {
      const job = jobs[tabId];
      if (job && job.child) {                   // an article hit a wall or had nothing: the others still count
        const wall = msg.status === 'login' || msg.status === 'blocked' ? msg.status : null;
        return articleDone(tabId, msg.status === 'done' ? msg.payload : null, null, wall);
      }
      finishJob(tabId, msg.status, { url: msg.url, payload: msg.payload, detail: msg.detail, outline: msg.outline });
    });
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
  const job = (await getJobs())[tabId];
  if (!job) return;
  if (job.child) return articleDone(tabId, null);     // an article tab closed: the rest of the site carries on
  const r = await withJobs(jobs => {
    const j = jobs[tabId];
    if (!j) return null;
    delete jobs[tabId];
    const children = Object.keys(jobs).filter(id => String(jobs[id].parent) === String(tabId));
    children.forEach(id => delete jobs[id]);
    return { j, children };
  });
  if (!r) return;
  unlighten(tabId);
  r.children.forEach(id => { unlighten(id); chrome.tabs.remove(Number(id)).catch(() => {}); });
  notifyUi(r.j, hasContent(r.j.acc) ? 'done' : 'cancelled', hasContent(r.j.acc) ? { payload: r.j.acc } : {});
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
