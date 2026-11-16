(() => {
  if (window.__prepifyLoaded) return;
  window.__prepifyLoaded = true;

  const host = location.hostname;
  const SOURCE = host.includes('ambitionbox') ? 'AmbitionBox'
    : host.includes('indeed') ? 'Indeed'
    : host.includes('reddit') ? 'Reddit'
    : host.includes('geeksforgeeks') ? 'GeeksforGeeks'
    : 'Glassdoor';

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

  // "Question 1Tell me about..." -> "Tell me about..."
  const stripQLabel = (t) => t.replace(/^\s*(question|q)\s*\d+\s*[:.)\-]?\s*/i, '');

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
      text = stripQLabel(clean(text));
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
    const items = [...block.querySelectorAll('li, p')].map(e => stripQLabel(clean(e.textContent))).filter(t => t.length > 8);
    if (items.length > 1) return items;
    const t = clean(block.textContent);
    const parts = t.split(/(?:^|\s)(?:Q\s?\d+[.):]|\d+[.)])\s+/).map(stripQLabel).filter(p => p.length > 8);
    return parts.length > 1 ? parts : (t.length > 8 ? [stripQLabel(t)] : []);
  }

  function extractExperiences() {
    const cards = new Set();
    findLabels(document, XP_LABEL).forEach(l => { const c = experienceCard(l); if (c) cards.add(c); });
    // keep only the innermost cards (a page wrapper also "contains" every card)
    const list = [...cards].filter(c => ![...cards].some(o => o !== c && c.contains(o)));

    return list.map(card => {
      const xp = { role: '', date: '', location: '', outcome: '', experience: '', difficulty: '',
                   application: '', process: '', rounds: [], questions: [], tips: '' };
      const heads = [...card.querySelectorAll('h1, h2, h3, h4, h5, [class*="title" i], [data-test*="title" i]')]
        .filter(h => { const t = clean(h.textContent); return t.length > 3 && t.length < 140 && !/^(question|q)\s*\d+$/i.test(t) && !XP_LABEL.test(t); });
      const heading = heads.find(h => /interview$/i.test(clean(h.textContent))) || heads[0];
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
    const experiences = SOURCE === 'GeeksforGeeks' && isArticlePage() ? [extractArticle()]
      : SOURCE === 'Reddit' ? [extractRedditThread()].filter(Boolean)
      : extractExperiences();
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
    if (SOURCE === 'Glassdoor') return /\/Interview\//i.test(location.pathname);
    if (SOURCE === 'AmbitionBox') return /\/interviews\//i.test(location.pathname);
    if (SOURCE === 'Indeed') return /\/cmp\/[^/]+\/interviews/i.test(location.pathname);
    if (SOURCE === 'GeeksforGeeks') return isArticlePage();
    return false;
  }

  // A bot check (Cloudflare / "Help us protect Glassdoor") rather than real content.
  function looksBlocked() {
    const title = document.title.toLowerCase();
    const t = document.body ? document.body.innerText.slice(0, 3000).toLowerCase() : '';
    return /just a moment|attention required|access denied|help us protect|security check|blocked/.test(title)
      || /verify you are human|unusual traffic|checking your browser|help us protect glassdoor|press (and|&) hold|additional verification required|are you a robot|complete the security check/.test(t);
  }

  // A real sign-in wall: a login URL, or a visible dialog asking to sign in. Plain "Sign in"
  // links in the site header don't count (they appear on every page).
  function looksLikeLoginWall() {
    if (/\/(profile\/login|member\/|login|signin|account\/login)/i.test(location.pathname)) return true;
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
    } else if (SOURCE === 'AmbitionBox') {
      const direct = links.find(h => /\/interviews\/[^/?#]+-interview-questions/i.test(h) && h.toLowerCase().includes(want));
      if (direct) return direct;
      for (const h of links) {
        const m = h.match(/\/(?:overview|reviews|salaries)\/([a-z0-9-]+?)-(?:overview|reviews|salaries)\b/i);
        if (m && m[1].includes(want)) return `${location.origin}/interviews/${m[1]}-interview-questions`;
      }
      // last resort: AmbitionBox slugs usually match the company name
      return `${location.origin}/interviews/${slug(company)}-interview-questions`;
    } else if (SOURCE === 'Indeed') {
      const direct = links.find(h => /\/cmp\/[^/?#]+\/interviews/i.test(h) && h.toLowerCase().includes(want));
      if (direct) return direct;
      for (const h of links) {
        const m = h.match(/\/cmp\/([^/?#]+)/i);
        if (m && m[1].toLowerCase().includes(want)) return `${location.origin}/cmp/${m[1]}/interviews`;
      }
    }
    return null;
  }

  // ---------- Indeed company pages ----------
  // Indeed company slugs are usually the name in Title-Case with dashes: /cmp/Target-Corporation, /cmp/Target
  function indeedGuesses(company) {
    const words = company.replace(/[^A-Za-z0-9 &]/g, ' ').split(/\s+/).filter(Boolean)
      .map(w => w.length <= 4 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    const full = words.join('-');
    const first = words[0];
    return [...new Set([full, first].filter(Boolean))].map(slg => `${location.origin}/cmp/${slg}/interviews`);
  }

  // ---------- Reddit (old.reddit.com) ----------
  function redditThreadLinks(company) {
    const want = slug(company).split('-')[0];
    const seen = new Set();
    return [...document.querySelectorAll('a.search-title, a.title, a[data-event-action="title"]')]
      .filter(a => {
        const h = a.href.split('?')[0];
        const t = (a.textContent || '').toLowerCase();
        if (!/\/comments\//.test(h) || seen.has(h)) return false;
        if (!t.includes(want) || !/interview|hiring|offer|round|placement|recruit|selected|rejected|onsite|\boa\b|assessment|experience/.test(t)) return false;
        seen.add(h);
        return true;
      })
      .map(a => a.href.split('?')[0].replace('://www.reddit.com', '://old.reddit.com'));
  }

  function extractRedditThread() {
    const thing = document.querySelector('#siteTable .thing.link') || document.querySelector('.thing.link');
    if (!thing) return null;
    const titleEl = thing.querySelector('a.title');
    const body = thing.querySelector('.usertext-body');
    const bodyText = body ? (body.innerText || '').trim().slice(0, 4000) : '';
    const comments = [...document.querySelectorAll('.commentarea > .sitetable > .thing.comment')]
      .map(c => {
        const entry = c.querySelector(':scope > .entry');
        const text = entry && entry.querySelector('.usertext-body') ? entry.querySelector('.usertext-body').innerText.trim() : '';
        const scoreEl = entry && entry.querySelector('.score.unvoted');
        const score = parseInt((scoreEl && (scoreEl.getAttribute('title') || scoreEl.textContent)) || '0', 10) || 0;
        return { text: text.slice(0, 1500), score };
      })
      .filter(c => c.text && !/^\[(deleted|removed)\]$/.test(c.text))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    const time = thing.querySelector('time');
    const questions = (bodyText.match(/[^.!?\n]{12,300}\?/g) || []).map(t => ({ text: t.trim(), answers: [] })).slice(0, 15);
    return {
      role: clean(titleEl && titleEl.textContent), date: time ? (time.getAttribute('datetime') || '').slice(0, 10) : '',
      location: thing.dataset.subreddit ? 'r/' + thing.dataset.subreddit : '',
      outcome: '', experience: '', difficulty: '', application: '', process: bodyText, rounds: [], questions, tips: '',
      discussion: comments, score: parseInt(thing.dataset.score || '0', 10) || 0,
      comments: parseInt(thing.dataset.commentsCount || '0', 10) || 0,
      url: location.href.split('?')[0].replace('://old.reddit.com', '://www.reddit.com')
    };
  }

  // ---------- article sources (GeeksforGeeks interview experiences) ----------
  function isArticlePage() {
    return !!document.querySelector('article h1, main h1, h1') && /interview/i.test(document.title + ' ' + location.pathname)
      && !/\/(search|tag|category)\b/i.test(location.pathname);
  }

  // Interview-experience article links on a search or tag page, best matches first.
  function articleLinks(company) {
    const want = slug(company).split('-')[0];
    const seen = new Set();
    return [...document.querySelectorAll('a[href]')]
      .filter(a => {
        const h = a.href.split('#')[0].split('?')[0];
        const text = (a.textContent + ' ' + h).toLowerCase();
        if (seen.has(h) || !/geeksforgeeks\.org\/[a-z0-9-]+/.test(h) || /\/(tag|category|search|user)\//.test(h)) return false;
        if (!/interview/.test(text) || !text.includes(want)) return false;
        seen.add(h);
        return true;
      })
      .map(a => a.href.split('#')[0].split('?')[0]);
  }

  // Questions written into free text: lines/items that end in "?" or start with "Q1." etc.
  function questionsFromText(nodes) {
    const out = [];
    const seen = new Set();
    nodes.forEach(n => {
      clean(n.textContent).split(/(?<=\?)\s+/).forEach(s => {
        const t = stripQLabel(s.trim());
        if (t.length < 12 || t.length > 300 || seen.has(t)) return;
        if (/\?$/.test(t) || /^(q\s?\d+|question\s*\d+)/i.test(s.trim())) { seen.add(t); out.push({ text: t, answers: [] }); }
      });
    });
    return out;
  }

  // One article = one experience: title, date, rounds (from headings), questions, write-up.
  function extractArticle() {
    const root = document.querySelector('article') || document.querySelector('main') || document.body;
    const h1 = root.querySelector('h1') || document.querySelector('h1');
    const title = clean(h1 && h1.textContent);
    const dateText = clean((document.querySelector('time') || {}).textContent || '') ||
      ((root.innerText.match(/(?:Last Updated|Published|Updated)\s*:?\s*([0-9]{1,2}\s+[A-Za-z]{3,9},?\s+\d{4})/i) || [])[1] || '');

    const xp = { role: title.replace(/\s*[-|:]\s*GeeksforGeeks.*$/i, ''), date: dateText, location: '', outcome: '',
                 experience: '', difficulty: '', application: '', process: '', rounds: [], questions: [], tips: '' };

    const blocks = [...root.querySelectorAll('h2, h3, h4, p, li, strong, b')];
    let current = null;
    const intro = [];
    blocks.forEach(el => {
      const t = clean(el.textContent);
      if (!t) return;
      const isHeading = /^H[234]$/.test(el.tagName) || (/^(STRONG|B)$/.test(el.tagName) && t.length < 80 && el.parentElement && clean(el.parentElement.textContent) === t);
      if (isHeading && /round|test|interview|assessment|hr\b|technical|coding|aptitude|managerial|online/i.test(t)) {
        current = { name: t.replace(/[:：]$/, ''), detail: '' };
        xp.rounds.push(current);
        return;
      }
      if (isHeading && /tip|advice|preparation|suggestion/i.test(t)) { current = { tips: true }; return; }
      if (el.tagName === 'P' || el.tagName === 'LI') {
        if (current && current.tips) xp.tips = [xp.tips, t].filter(Boolean).join('\n');
        else if (current) current.detail = [current.detail, t].filter(Boolean).join('\n').slice(0, 2500);
        else if (intro.join(' ').length < 900) intro.push(t);
      }
    });
    xp.process = intro.join('\n');
    if (/selected|got the offer|received (an|the) offer/i.test(root.innerText)) xp.outcome = 'Selected';
    xp.questions = questionsFromText([...root.querySelectorAll('li, p')]).slice(0, 40);
    return xp;
  }

  async function settle() {
    // single-page apps keep rendering after load; wait until the text stops growing
    let last = -1;
    for (let i = 0; i < 8; i++) {
      await sleep(1000);
      const len = document.body ? document.body.innerText.length : 0;
      if (len === last && len > 500) break;
      last = len;
    }
  }

  async function researchMode() {
    const job = await send({ type: 'research:whoami' });
    if (!job) return;
    btn.style.display = 'none';
    await settle();

    const fail = (status) => send({ type: 'research:result', status, url: location.href, detail: pageDetail() });
    if (looksBlocked()) return fail('blocked');

    // Reddit (old.reddit.com, plain HTML): queue the best threads from search, then read each one
    if (SOURCE === 'Reddit') {
      if (/\/comments\//.test(location.pathname)) {
        const xp = extractRedditThread();
        if (!xp) return send({ type: 'research:partial', payload: { questions: [], reviews: [], experiences: [] }, url: location.href });
        const payload = { source: SOURCE, url: location.href, company_name: job.company,
                          questions: xp.questions.map(q => ({ ...q, role: xp.role })), reviews: [], experiences: [xp] };
        return send({ type: 'research:partial', payload, url: location.href });
      }
      const threads = redditThreadLinks(job.company);
      if (threads.length) return send({ type: 'research:queue', urls: threads.slice(0, 4), step: `reading ${Math.min(threads.length, 4)} threads` });
      return fail(looksLikeLoginWall() ? 'login' : 'not-found');
    }

    // Indeed: the company page may be missing from search; try its usual address directly
    if (SOURCE === 'Indeed') {
      const guesses = indeedGuesses(job.company);
      const notFoundPage = /not found|page doesn.t exist|can.t find|404/i.test(document.title + ' ' + (document.body ? document.body.innerText.slice(0, 800) : ''));
      if (isInterviewPage() && notFoundPage) {
        const next = guesses.find(u => !location.href.startsWith(u));
        if (next) return send({ type: 'research:navigate', url: next, step: 'trying another company page' });
        return fail('not-found');
      }
      if (!isInterviewPage() && !findInterviewUrl(job.company)) {
        if (guesses[0]) return send({ type: 'research:navigate', url: guesses[0], step: 'opening company page' });
      }
    }

    // GeeksforGeeks: queue a few interview-experience articles, then read each one
    if (SOURCE === 'GeeksforGeeks') {
      if (isArticlePage()) {
        const xp = extractArticle();
        const payload = { source: SOURCE, url: location.href, company_name: job.company,
                          questions: xp.questions.map(q => ({ ...q, role: xp.role })), reviews: [], experiences: [xp] };
        return send({ type: 'research:partial', payload, url: location.href });
      }
      const links = articleLinks(job.company);
      if (links.length) return send({ type: 'research:queue', urls: links.slice(0, 4), step: `reading ${Math.min(links.length, 4)} articles` });
      if (!/\/tag\//.test(location.pathname)) {
        return send({ type: 'research:navigate', url: `${location.origin}/tag/${slug(job.company)}/`, step: 'opening company tag page' });
      }
      return fail('not-found');
    }

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
