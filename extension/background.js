// Prepify Capture — background service worker.
// Nothing is sent to any server: captured questions, answers and reviews are handed straight
// to the open Prepify tab, which keeps them only for that browser session.
//
// Research jobs: when a signed-in Prepify page asks, the worker opens the company's pages on each
// site in a background tab of the user's own (signed-in) browser, content.js reads them, and the
// tab is closed. Limits: only the sites asked for, at most MAX_HOPS page loads per site, no pagination.
const MAX_HOPS = 3;
const JOB_TIMEOUT_MS = 45000;
const APP_URLS = ['http://localhost:5000/*', 'http://127.0.0.1:5000/*'];

const START_URL = {
  Glassdoor: (c) => `https://www.glassdoor.co.in/Search/results.htm?keyword=${encodeURIComponent(c)}`,
  AmbitionBox: (c) => `https://www.ambitionbox.com/search?q=${encodeURIComponent(c)}`
};

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

async function finishJob(tabId, status, extra = {}) {
  const jobs = await getJobs();
  const job = jobs[tabId];
  if (!job) return;
  delete jobs[tabId];
  await setJobs(jobs);
  notifyUi(job, status, extra);
  // A sign-in wall or "verify you're human" check needs the user: leave that tab open for them.
  if (status === 'login' || status === 'blocked') return;
  chrome.tabs.remove(Number(tabId)).catch(() => {});
}

async function startResearch(company, sites, uiTabId) {
  for (const site of sites) {
    if (!START_URL[site]) continue;
    const tab = await chrome.tabs.create({ url: START_URL[site](company), active: false });
    const jobs = await getJobs();               // save before the page can ask "whoami"
    jobs[tab.id] = { site, company, uiTabId, hops: 0, started: Date.now() };
    await setJobs(jobs);
    notifyUi(jobs[tab.id], 'working');
    setTimeout(() => finishJob(tab.id, 'timeout'), JOB_TIMEOUT_MS);
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
    startResearch(msg.company, msg.sites || Object.keys(START_URL), tabId);
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
    notifyUi(job, 'cancelled');
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
  const source = host.includes('ambitionbox') ? 'AmbitionBox' : host.includes('glassdoor') ? 'Glassdoor' : host;
  const n = await sendToApp({ source, url: tab.url, questions: [{ text: info.selectionText.trim() }] });
  const msg = n ? 'Sent to Prepify' : 'Open Prepify (localhost:5000) in a tab first';
  chrome.tabs.sendMessage(tab.id, { type: 'toast', text: msg }).catch(() => {});
});
