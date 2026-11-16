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
  // Answers shown under a question: an "Answer"/"3 Answers"/"Ans" label near it, followed by the text.
  const ANSWER_RE = /^(\d+\s+)?(answers?|interview answers?|ans)$/i;
  function answersNear(label) {
    let el = label.parentElement;
    for (let i = 0; i < 5 && el && el !== document.body; i++, el = el.parentElement) {
      const labels = findLabels(el, ANSWER_RE);
      if (labels.length) {
        return labels.map(valueAfter)
          .filter(a => a && a.length > 3 && a.length < 4000 && !/^(add|answer|write)( an?)? (answer|question)/i.test(a));
      }
    }
    return [];
  }

  function extractQuestions() {
    const out = [];
    const seen = new Map();
    const add = (text, answers = []) => {
      text = clean(text);
      if (text.length < 8 || text.length > 1500) return;
      if (seen.has(text)) {               // same question twice on a page: keep all answers
        const q = seen.get(text);
        answers.forEach(a => { if (!q.answers.includes(a)) q.answers.push(a); });
        return;
      }
      const q = { text, answers: [...new Set(answers.map(clean))] };
      seen.set(text, q);
      out.push(q);
    };

    // Pattern 1: an "Interview Questions" / "Question" label followed by the question text.
    findLabels(document, /^(interview )?questions?$/i).forEach(label => {
      const v = valueAfter(label);
      if (!v) return;
      // The value may hold several numbered questions: "Q1. ... Q2. ..." or "1. ... 2. ..."
      const parts = v.split(/(?:^|\s)(?:Q\s?\d+[.):]|\d+[.)])\s+/).filter(Boolean);
      if (parts.length > 1) parts.forEach(p => add(p));
      else add(v, answersNear(label));
    });

    // Pattern 2: elements that read like "Q1. text", optionally followed by "A1. text" / "Ans: text".
    document.querySelectorAll('li, p, div').forEach(el => {
      if (el.children.length > 1) return;
      const m = clean(el.textContent).match(/^Q\s?\d+[.):]\s*(.{10,})$/i);
      if (!m) return;
      const next = el.nextElementSibling && clean(el.nextElementSibling.textContent);
      const a = next && next.match(/^(?:A\s?\d*[.):]|Ans(?:wer)?\s*[.:-])\s*(.+)$/i);
      add(m[1], a ? [a[1]] : []);
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

  // ---------- interview experiences: one candidate's whole write-up, kept structured ----------
  // Section labels used inside experience cards on Glassdoor ("Application", "Interview",
  // "Interview questions [2]") and AmbitionBox ("Round 1 - Aptitude Test", "Interview Preparation Tips").
  const XP_LABEL = /^(application|interview|interview process|interview questions?\s*[\[(]?\d*[\])]?|interview preparation tips|interview tips|preparation tips|tips?|round\s*\d+.*|topics to prepare.*|i applied via .*)$/i;
  const DATE_RE = /\b(\d{1,2}\s+[A-Z][a-z]{2,8}\s+\d{4}|[A-Z][a-z]{2,8}\s+\d{1,2},?\s+\d{4}|[A-Z][a-z]{2,8}\s+\d{4}|\d+\s+(?:days?|weeks?|months?|years?)\s+ago)\b/;
  const OUTCOME_RE = /^(accepted offer|declined offer|no offer|got offer|offer|selected|rejected|no response|under process)$/i;
  const EXPERIENCE_RE = /^(positive|neutral|negative) experience$/i;
  const DIFFICULTY_RE = /^(very easy|easy|average|moderate|difficult|hard|very difficult) interview$|^difficulty[:\s]+.+$/i;

  function leafTexts(card) {
    return [...card.querySelectorAll('*')].filter(isLeaf).map(e => clean(e.textContent)).filter(Boolean);
  }

  function experienceCard(label) {
    let el = label.parentElement;
    for (let i = 0; i < 10 && el && el !== document.body; i++, el = el.parentElement) {
      const n = findLabels(el, XP_LABEL).length;
      const len = clean(el.textContent).length;
      if (len > 8000) break;
      if (n >= 2) return el;
    }
    return null;
  }

  // Splits a questions block into separate questions (list items, lines or "Q1." prefixes).
  function splitQuestions(block) {
    const items = [...block.querySelectorAll('li, p')].map(e => clean(e.textContent)).filter(t => t.length > 8);
    if (items.length > 1) return items;
    const t = clean(block.textContent);
    const parts = t.split(/(?:^|\s)(?:Q\s?\d+[.):]|\d+[.)])\s+/).filter(p => p.length > 8);
    return parts.length > 1 ? parts : (t.length > 8 ? [t] : []);
  }

  function extractExperiences() {
    const cards = new Set();
    findLabels(document, XP_LABEL).forEach(l => { const c = experienceCard(l); if (c) cards.add(c); });
    // keep only the innermost cards (a page wrapper also "contains" every card)
    const list = [...cards].filter(c => ![...cards].some(o => o !== c && c.contains(o)));

    return list.map(card => {
      const xp = { role: '', date: '', location: '', outcome: '', experience: '', difficulty: '',
                   application: '', process: '', rounds: [], questions: [], tips: '' };
      const heading = card.querySelector('h2, h3, h4, [class*="title" i], [data-test*="title" i]');
      xp.role = clean(heading && heading.textContent)
        .replace(/\s+interview(\s+questions?)?(\s+(and|&)\s+answers?)?$/i, '').slice(0, 120);

      leafTexts(card).forEach(t => {
        // AmbitionBox summary sentence: "I applied via Campus Placement and was interviewed in Nov 2024. ..."
        if (!xp.application && /^i applied via/i.test(t)) {
          xp.application = t;
          const when = t.match(/interviewed (?:in|on|before)\s+([A-Z][a-z]{2,8}\s+\d{4})/);
          if (when && !xp.date) xp.date = when[1];
          return;
        }
        if (!xp.outcome && OUTCOME_RE.test(t)) xp.outcome = t;
        else if (!xp.experience && EXPERIENCE_RE.test(t)) xp.experience = t;
        else if (!xp.difficulty && DIFFICULTY_RE.test(t)) xp.difficulty = t.replace(/^difficulty[:\s]+/i, '');
        if (!xp.date) { const m = t.match(DATE_RE); if (m && t.length < 60) xp.date = m[0]; }
      });

      findLabels(card, XP_LABEL).forEach(label => {
        const name = clean(label.textContent).replace(/[:：]$/, '');
        const value = valueAfter(label);
        if (/^application$/i.test(name) || /^i applied via/i.test(name)) {
          xp.application = /^i applied via/i.test(name) ? name : value;
        } else if (/^(interview|interview process)$/i.test(name)) {
          xp.process = value;
        } else if (/^round\s*\d+/i.test(name)) {
          xp.rounds.push({ name, detail: value });
        } else if (/tips?$/i.test(name) || /^topics to prepare/i.test(name)) {
          xp.tips = [xp.tips, value].filter(Boolean).join('\n');
        } else if (/^interview questions?/i.test(name)) {
          let block = label;
          for (let i = 0; i < 3 && block && !block.nextElementSibling; i++) block = block.parentElement;
          const qBlock = block && block.nextElementSibling;
          (qBlock ? splitQuestions(qBlock) : [value]).forEach(text => {
            if (text) xp.questions.push({ text, answers: qBlock ? answersNear(qBlock.querySelector('*') || qBlock) : [] });
          });
        }
      });
      return xp;
    }).filter(xp => xp.process || xp.questions.length || xp.rounds.length || xp.application);
  }

  // Everything readable on this page. Questions found inside experiences are also listed on
  // their own (with their answers) so the Q&A view has them too.
  function collect() {
    const experiences = extractExperiences();
    const questions = extractQuestions();
    const seen = new Map(questions.map(q => [q.text, q]));
    experiences.forEach(xp => xp.questions.forEach(q => {
      const have = seen.get(q.text);
      if (have) q.answers.forEach(a => { if (!have.answers.includes(a)) have.answers.push(a); });
      else { const nq = { text: q.text, answers: [...q.answers], role: xp.role || undefined }; seen.set(q.text, nq); questions.push(nq); }
    }));
    return { questions, reviews: extractReviews(), experiences };
  }
  if (window.__prepifyTest) window.__prepifyTest.collect = collect;   // test pages only

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
    const { questions, reviews, experiences } = collect();
    if (!questions.length && !reviews.length && !experiences.length) {
      showToast('Nothing recognised on this page. Select a question and right-click, then choose Save selection.');
      btn.disabled = false;
      return;
    }
    chrome.runtime.sendMessage({
      type: 'capture',
      payload: { source: SOURCE, url: location.href, company_name: companyFromPage(), questions, reviews, experiences }
    }, (resp) => {
      btn.disabled = false;
      if (chrome.runtime.lastError || !resp) {
        showToast('Prepify extension is not responding. Reload the page and try again.');
      } else if (!resp.ok) {
        showToast('Prepify: ' + resp.error);
      } else {
        showToast(`Sent ${experiences.length} experiences, ${questions.length} questions and ${reviews.length} reviews to Prepify`);
      }
    });
  });

  // ---------- research mode: this tab was opened by Prepify in the background ----------
  const send = (m) => new Promise(res => chrome.runtime.sendMessage(m, r => res(chrome.runtime.lastError ? null : r)));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const slug = (t) => t.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  function isInterviewPage() {
    return SOURCE === 'Glassdoor' ? /\/Interview\//i.test(location.pathname)
                                  : /\/interviews\//i.test(location.pathname);
  }

  // A bot check (Cloudflare / "Help us protect Glassdoor") rather than real content.
  function looksBlocked() {
    const title = document.title.toLowerCase();
    const t = document.body ? document.body.innerText.slice(0, 3000).toLowerCase() : '';
    return /just a moment|attention required|access denied|help us protect/.test(title)
      || /verify you are human|unusual traffic|checking your browser|help us protect glassdoor|press (and|&) hold/.test(t);
  }

  // A real sign-in wall: a login URL, or a visible dialog asking to sign in. Plain "Sign in"
  // links in the site header don't count (they appear on every page).
  function looksLikeLoginWall() {
    if (/\/(profile\/login|member\/|login|signin)/i.test(location.pathname)) return true;
    const dialogs = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"], [class*="modal" i]')]
      .filter(d => d.offsetParent !== null || getComputedStyle(d).position === 'fixed');
    if (dialogs.some(d => /sign in|log in|continue with google|create (a free )?account|sign up/i.test(d.innerText || ''))) return true;
    // Glassdoor's wall is a bottom sheet, not a dialog: "Continue with Google" / "Continue with Apple or email".
    // Only called once a page has yielded nothing, so this text alone is enough.
    const t = document.body ? document.body.innerText : '';
    return /continue with apple or email|continue with google|sign in to (see|read|continue|unlock)|join (now )?to (see|unlock|continue)/i.test(t);
  }

  const pageDetail = () => `${document.title.slice(0, 80)} (${location.pathname})`;

  // From a search or company page, find the company's interview page.
  function findInterviewUrl(company) {
    const links = [...document.querySelectorAll('a[href]')].map(a => a.href);
    const want = slug(company).split('-')[0];
    if (SOURCE === 'Glassdoor') {
      const direct = links.find(h => /\/Interview\/.+-Interview-Questions-E\d+/i.test(h));
      if (direct) return direct;
      for (const h of links) {
        const m = h.match(/(?:EI_IE|-E)(\d+)[.\d,]*\.htm/i);
        if (m && h.toLowerCase().includes(want)) {
          return `${location.origin}/Interview/${slug(company)}-Interview-Questions-E${m[1]}.htm`;
        }
      }
    } else {
      const direct = links.find(h => /\/interviews\/[^/?#]+-interview-questions/i.test(h) && h.toLowerCase().includes(want));
      if (direct) return direct;
      for (const h of links) {
        const m = h.match(/\/(?:overview|reviews|salaries)\/([a-z0-9-]+?)-(?:overview|reviews|salaries)\b/i);
        if (m && m[1].includes(want)) return `${location.origin}/interviews/${m[1]}-interview-questions`;
      }
      // last resort: AmbitionBox slugs usually match the company name
      return `${location.origin}/interviews/${slug(company)}-interview-questions`;
    }
    return null;
  }

  async function researchMode() {
    const job = await send({ type: 'research:whoami' });
    if (!job) return;
    btn.style.display = 'none';

    // single-page apps keep rendering after load; wait until the text stops growing
    let last = -1;
    for (let i = 0; i < 8; i++) {
      await sleep(1000);
      const len = document.body ? document.body.innerText.length : 0;
      if (len === last && len > 500) break;
      last = len;
    }

    const fail = (status) => send({ type: 'research:result', status, url: location.href, detail: pageDetail() });

    if (looksBlocked()) return fail('blocked');

    if (!isInterviewPage()) {
      // look for the company's interview link first: header "Sign in" text is not a wall
      const next = findInterviewUrl(job.company);
      if (next && next !== location.href) return send({ type: 'research:navigate', url: next, step: 'opening interview page' });
      return fail(looksLikeLoginWall() ? 'login' : 'not-found');
    }

    const { questions, reviews, experiences } = collect();
    if (!questions.length && !reviews.length && !experiences.length) return fail(looksLikeLoginWall() ? 'login' : 'empty');
    send({
      type: 'research:result', status: 'done', url: location.href,
      payload: { source: SOURCE, url: location.href, company_name: job.company, questions, reviews, experiences }
    });
  }

  researchMode();
})();
