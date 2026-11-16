(() => {
  if (window.__prepifyLoaded) return;
  window.__prepifyLoaded = true;

  const host = location.hostname;
  const SOURCE = host.includes('ambitionbox') ? 'AmbitionBox' : 'Glassdoor';

  // ---------- helpers ----------
  const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const isLeaf = (el) => el.children.length === 0;

  // Leaf elements whose whole text matches a label, e.g. "Pros", "Interview Questions".
  function findLabels(root, re) {
    const out = [];
    root.querySelectorAll('*').forEach(el => {
      if (!isLeaf(el)) return;
      const t = clean(el.textContent).replace(/[:：]$/, '');
      if (t && t.length < 40 && re.test(t)) out.push(el);
    });
    return out;
  }

  // Text that follows a label: the next sibling (walking up a few levels), else the
  // parent's text with the label removed.
  function valueAfter(label) {
    const labelText = clean(label.textContent);
    let node = label;
    for (let i = 0; i < 3 && node; i++, node = node.parentElement) {
      const sib = node.nextElementSibling;
      if (sib && clean(sib.textContent)) return clean(sib.textContent);
    }
    const p = label.parentElement;
    return p ? clean(p.textContent.replace(labelText, '')) : '';
  }

  // Smallest ancestor of a label that also contains the other label kind (e.g. Pros + Cons).
  function cardOf(label, otherRe) {
    let el = label.parentElement;
    while (el && el !== document.body) {
      if (findLabels(el, otherRe).length && clean(el.textContent).length < 6000) return el;
      el = el.parentElement;
    }
    return label.parentElement;
  }

  // ---------- extractors ----------
  function extractQuestions() {
    const out = [];
    const seen = new Set();
    const add = (text) => {
      text = clean(text);
      if (text.length < 8 || text.length > 1500 || seen.has(text)) return;
      seen.add(text);
      out.push({ text });
    };

    // Pattern 1: an "Interview Questions" / "Question" label followed by the question text.
    findLabels(document, /^(interview )?questions?$/i).forEach(label => {
      const v = valueAfter(label);
      if (!v) return;
      // The value may hold several numbered questions: "Q1. ... Q2. ..." or "1. ... 2. ..."
      const parts = v.split(/(?:^|\s)(?:Q\s?\d+[.):]|\d+[.)])\s+/).filter(Boolean);
      (parts.length > 1 ? parts : [v]).forEach(add);
    });

    // Pattern 2: elements that already read like "Q1. text".
    document.querySelectorAll('li, p, div').forEach(el => {
      if (el.children.length > 1) return;
      const m = clean(el.textContent).match(/^Q\s?\d+[.):]\s*(.{10,})$/i);
      if (m) add(m[1]);
    });

    return out;
  }

  function numberFrom(el) {
    if (!el) return null;
    const aria = el.getAttribute('aria-label') || el.getAttribute('title');
    const m = (aria || el.textContent || '').match(/(\d(?:\.\d)?)/);
    return m ? parseFloat(m[1]) : null;
  }

  function extractReviews() {
    const out = [];
    const proRe = /^(pros|likes?)$/i;
    const conRe = /^(cons|dislikes?)$/i;
    const seen = new Set();

    findLabels(document, proRe).forEach(proLabel => {
      const card = cardOf(proLabel, conRe);
      if (!card || seen.has(card)) return;
      seen.add(card);

      const conLabel = findLabels(card, conRe)[0];
      const heading = card.querySelector('h1,h2,h3,h4,h5,[class*="title" i],[data-test*="title" i]');
      const ratingEl = card.querySelector('[aria-label*="rating" i],[class*="rating" i],[data-test*="rating" i]');
      const dateEl = card.querySelector('time,[class*="date" i]');
      const jobEl = card.querySelector('[class*="job" i],[class*="designation" i],[data-test*="job" i]');

      out.push({
        title: clean(heading && heading.textContent),
        rating: numberFrom(ratingEl),
        pros: valueAfter(proLabel),
        cons: conLabel ? valueAfter(conLabel) : '',
        job_title: clean(jobEl && jobEl.textContent),
        date: clean(dateEl && (dateEl.getAttribute('datetime') || dateEl.textContent))
      });
    });
    return out;
  }

  function companyFromPage() {
    // "Stripe Interview Questions" / "Stripe Reviews" -> "Stripe"
    const h1 = document.querySelector('h1');
    const t = clean((h1 && h1.textContent) || document.title);
    return t.replace(/\b(interview|reviews?|salaries|questions?|experience|jobs?|working at)\b.*$/i, '').trim() || null;
  }

  // ---------- UI ----------
  const btn = document.createElement('button');
  btn.textContent = 'Save to Prepify';
  Object.assign(btn.style, {
    position: 'fixed', right: '20px', bottom: '20px', zIndex: 2147483647,
    padding: '10px 14px', border: '1px solid #2a3040', borderRadius: '8px',
    background: '#12151c', color: '#e6e8ee', font: '600 13px system-ui, sans-serif',
    cursor: 'pointer', boxShadow: '0 4px 16px rgba(0,0,0,.4)'
  });
  document.documentElement.appendChild(btn);

  const toast = document.createElement('div');
  Object.assign(toast.style, {
    position: 'fixed', right: '20px', bottom: '70px', zIndex: 2147483647,
    padding: '10px 14px', borderRadius: '8px', background: '#12151c', color: '#e6e8ee',
    border: '1px solid #2a3040', font: '13px system-ui, sans-serif', display: 'none',
    maxWidth: '320px', boxShadow: '0 4px 16px rgba(0,0,0,.4)'
  });
  document.documentElement.appendChild(toast);

  let timer;
  function showToast(text) {
    toast.textContent = text;
    toast.style.display = 'block';
    clearTimeout(timer);
    timer = setTimeout(() => (toast.style.display = 'none'), 5000);
  }

  chrome.runtime.onMessage.addListener((m) => { if (m.type === 'toast') showToast(m.text); });

  btn.addEventListener('click', () => {
    btn.disabled = true;
    const questions = extractQuestions();
    const reviews = extractReviews();
    if (!questions.length && !reviews.length) {
      showToast('Nothing recognised on this page. Select a question and right-click, then choose Save selection.');
      btn.disabled = false;
      return;
    }
    chrome.runtime.sendMessage({
      type: 'capture',
      payload: { source: SOURCE, url: location.href, company_name: companyFromPage(), questions, reviews }
    }, (resp) => {
      btn.disabled = false;
      if (chrome.runtime.lastError || !resp) {
        showToast('Could not reach Prepify. Is the app running on localhost:5000?');
      } else if (!resp.ok) {
        showToast('Prepify: ' + resp.error);
      } else {
        const r = resp.result;
        showToast(`Saved ${r.questions_added} questions, ${r.reviews_added} reviews` +
          (r.duplicates_skipped ? ` (${r.duplicates_skipped} already saved)` : ''));
      }
    });
  });
})();
