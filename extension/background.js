// Posts captured data to the local Prepify server. Done here (not in the content
// script) because host_permissions let the service worker call localhost without CORS issues.
const API = 'http://localhost:5000';

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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'capture') {
    post('/api/capture', msg.payload)
      .then(r => sendResponse({ ok: true, result: r }))
      .catch(e => sendResponse({ ok: false, error: String(e.message || e) }));
    return true; // async response
  }
});

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
