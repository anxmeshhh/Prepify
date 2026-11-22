// Runs on the Prepify app page. Lets the page ask the extension to pull a source or show a
// sign-in page, and passes progress and captured data back (the page keeps it in sessionStorage only).
(() => {
  document.documentElement.dataset.prepifyExt = chrome.runtime.getManifest().version;

  // After the extension is reloaded or updated, this copy of the script is orphaned:
  // chrome.runtime calls throw "Extension context invalidated". Tell the page instead of crashing.
  const alive = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; } };
  const stale = () => window.postMessage({ source: 'prepify-ext', type: 'ext:stale' }, location.origin);
  function toExtension(msg) {
    if (!alive()) return stale();
    try {
      const p = chrome.runtime.sendMessage(msg);
      if (p && p.catch) p.catch(() => {});
    } catch (e) {
      stale();
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'prepify-page') return;
    if (e.data.type === 'research:start') {
      toExtension({ type: 'research:start', company: e.data.company, sites: e.data.sites,
                    urls: e.data.urls || {}, match: e.data.match || {} });
    } else if (e.data.type === 'login:open') {
      toExtension({ type: 'login:open', company: e.data.company, site: e.data.site });
    }
  });

  chrome.runtime.onMessage.addListener((m) => {
    if (m.type === 'research:update' || m.type === 'capture') {
      window.postMessage({ source: 'prepify-ext', ...m }, location.origin);
    }
  });
})();
