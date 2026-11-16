// Runs on the Prepify app page. Lets the page ask the extension to pull a source, and
// passes progress and captured data back to the page (which keeps it in sessionStorage only).
(() => {
  document.documentElement.dataset.prepifyExt = chrome.runtime.getManifest().version;

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'prepify-page') return;
    if (e.data.type === 'research:start') {
      chrome.runtime.sendMessage({ type: 'research:start', company: e.data.company, sites: e.data.sites });
    }
  });

  chrome.runtime.onMessage.addListener((m) => {
    if (m.type === 'research:update' || m.type === 'capture') {
      window.postMessage({ source: 'prepify-ext', ...m }, location.origin);
    }
  });
})();
