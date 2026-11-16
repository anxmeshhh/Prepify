// Prepify Capture — background service worker.
// 1. Posts captured data to the local Prepify server (host_permissions avoid CORS).
// 2. Runs "research" jobs: when the Prepify page asks, opens the company's pages on each site
//    in a background tab of the user's own (signed-in) browser, lets content.js read them,
//    then closes the tab and reports back to the Prepify page.
//    Limits: only sites the user asked for, at most MAX_HOPS page loads per site, no pagination.
const API = 'http://localhost:5000';
const MAX_HOPS = 3;
const JOB_TIMEOUT_MS = 45000;

async function post(path, body) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Prepify': '1' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ---------- research jobs (kept in session storage: the worker can be suspended) ----------
const START_URL = {
  Glassdoor: (c) => `https://www.glassdoor.co.in/Search/results.htm?keyword=${encodeURIComponent(c)}`,
  AmbitionBox: (c) => `https://www.ambitionbox.com/search?q=${encodeURIComponent(c)}`
};

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
  chrome.tabs.remove(Number(tabId)).catch(() => {});
}

async function startResearch(company, sites, uiTabId) {
  try { await post('/api/active', { name: company }); } catch (e) { /* app offline: content capture will report */ }
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab && sender.tab.id;

  if (msg.type === 'capture') {
    post('/api/capture', msg.payload)
      .then(r => sendResponse({ ok: true, result: r }))
      .catch(e => sendResponse({ ok: false, error: String(e.message || e) }));
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

  if (msg.type === 'research:result') {
    finishJob(tabId, msg.status, { added: msg.added || 0, url: msg.url, detail: msg.detail });
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
  let msg;
  try {
    const r = await post('/api/capture', {
      source, url: tab.url,
      questions: [{ text: info.selectionText.trim() }]
    });
    msg = r.questions_added ? 'Saved question to Prepify' : 'Already saved';
  } catch (e) {
    msg = 'Prepify: ' + e.message;
  }
  chrome.tabs.sendMessage(tab.id, { type: 'toast', text: msg }).catch(() => {});
});
