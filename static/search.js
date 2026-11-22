// Prepify search page.
// No database: everything pulled lives in this tab's sessionStorage and is gone when the tab closes.
// Guests get links only; signing in (Google) unlocks pulling sources into Prepify.
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

function esc(t) {
  if (t === null || t === undefined) return '';
  const d = document.createElement('div');
  d.textContent = String(t);
  return d.innerHTML;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? String(iso) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const norm = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function getJson(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

// ---------- sources ----------
// linkOnly: Prepify never reads that site automatically (LinkedIn bans automated access); it only links.
const SITES = {
  Official: {
    mark: 'Of', color: 'var(--accent)', host: 'Careers page', server: true,
    url: (n) => OFFICIAL_LINKS[n.toLowerCase()] || null
  },
  Glassdoor: {
    mark: 'G', color: 'var(--good)', host: 'glassdoor.co.in',
    url: (n) => `https://www.glassdoor.co.in/Search/results.htm?keyword=${encodeURIComponent(n)}`
  },
  AmbitionBox: {
    mark: 'A', color: 'var(--link)', host: 'ambitionbox.com',
    url: (n) => `https://www.ambitionbox.com/search?q=${encodeURIComponent(n)}`
  },
  Indeed: {
    mark: 'I', color: 'var(--purple)', host: 'in.indeed.com',
    url: (n) => `https://in.indeed.com/companies/search?q=${encodeURIComponent(n)}`
  },
  GeeksforGeeks: {
    mark: 'Gf', color: '#2f8d46', host: 'geeksforgeeks.org',
    url: (n) => `https://www.geeksforgeeks.org/search/?gq=${encodeURIComponent(n + ' interview experience')}`
  },
  Reddit: {
    mark: 'R', color: 'var(--error)', host: 'reddit.com',
    url: (n) => `https://www.reddit.com/search/?q=${encodeURIComponent(n + ' interview')}`
  },
  Code360: {
    mark: 'C3', color: '#f0883e', host: 'naukri.com/code360',
    url: (n) => `https://www.naukri.com/code360/interview-experiences/${n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
  },
  PrepInsta: {
    mark: 'P', color: '#6c8cff', host: 'prepinsta.com',
    url: (n) => `https://prepinsta.com/${n.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')[0]}/`
  },
  LeetCode: {
    mark: 'LC', color: '#ffa116', host: 'leetcode.com/discuss',
    url: (n) => `https://leetcode.com/discuss/interview-experience?currentPage=1&orderBy=most_relevant&query=${encodeURIComponent(n)}`
  },
  LinkedIn: {
    mark: 'in', color: '#4a90d9', host: 'linkedin.com', linkOnly: true,
    url: (n) => `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(n + ' interview experience')}`
  }
};
const PULLABLE = Object.keys(SITES).filter(k => !SITES[k].linkOnly);
const OFFICIAL_LINKS = {};          // company (lower case) -> careers link the user added this session
const GOOGLE = {
  mark: 'g', color: 'var(--purple)', host: 'google.com',
  url: (n) => `https://www.google.com/search?q=${encodeURIComponent(n + ' interview questions experience')}`
};
const siteInfo = (name) => SITES[name] || { mark: (name || '?')[0].toUpperCase(), color: 'var(--purple)', host: '', url: null };

// ---------- cleaning what the sites give us ----------
// Glassdoor glues its button text and labels onto questions:
// "Why join us?Answer questionQuestion 2Tell me about..." -> ["Why join us?", "Tell me about..."]
function splitGlued(text) {
  return String(text || '')
    .split(/\s*answer question\s*|(?=\bquestion\s*\d+)/i)
    .map(t => t
      .replace(/^\s*(question|q)\s*\d+\s*[:.)\-]?\s*/i, '')
      .replace(/\s*(answer question|\d+\s+answers?|answer)\s*$/i, '')
      .trim())
    .filter(t => t.length > 3);
}

// "Interview" or "Question 1" picked up as a title means the real role wasn't found.
const cleanRole = (r) => (/^(interview|question\s*\d+|q\s*\d+)$/i.test((r || '').trim()) ? '' : (r || '').trim());

function cleanQuestions(list) {
  const out = [];
  (list || []).forEach(q => {
    const parts = splitGlued(q.text);
    parts.forEach((text, i) => out.push({ ...q, text, answers: i === 0 ? [...(q.answers || [])] : [] }));
  });
  return out;
}

// ---------- presenting messy site text cleanly ----------
// Lines that are only site chrome, never content.
const CHROME_LINE = /^(read more|show more|see more|show less|view more|helpful|not helpful|report|share|reply|upvote|downvote|answer question|add an answer|write an answer|view all answers?|\d+\s+answers?|helpful\s*\(\d+\)|\d+\s+(people\s+)?found (this|it) helpful|was this helpful\??|\.\.\.)$/i;

function tidyText(t) {
  return String(t || '')
    .replace(/\r/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[ \t\u00A0]+/g, ' ')
    .split('\n').map(l => l.trim()).filter(l => l && !CHROME_LINE.test(l)).join('\n')
    .replace(/(\s*(answer question|read more|show more|helpful|report))+\s*$/i, '')
    .trim();
}

// Turns raw text into paragraphs and lists: real line breaks, "1. a 2. b" runs, "- a - b" bullets,
// "Round 1: ... Round 2: ..." steps, and over-long paragraphs split by sentence.
function textBlocks(raw) {
  const text = tidyText(raw);
  if (!text) return [];
  const blocks = [];
  const pushPara = (p) => {
    p = p.trim();
    if (!p) return;
    if (p.length > 600) {
      const sentences = p.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [p];
      let chunk = '';
      sentences.forEach(x => { if ((chunk + x).length > 380 && chunk) { blocks.push({ type: 'p', text: chunk.trim() }); chunk = ''; } chunk += x; });
      if (chunk.trim()) blocks.push({ type: 'p', text: chunk.trim() });
    } else blocks.push({ type: 'p', text: p });
  };
  const inlineList = (line) => {
    // "intro 1. a 2. b 3. c"  or  "Round 1: a Round 2: b"
    const num = line.split(/\s(?=(?:\d{1,2}[.)]|Round\s*\d+\s*[:.\-])\s)/i);
    if (num.length >= 3) {
      const first = /^(\d{1,2}[.)]|Round\s*\d+)/i.test(num[0]) ? null : num.shift();
      if (first) pushPara(first);
      blocks.push({ type: 'ol', items: num.map(x => x.replace(/^\d{1,2}[.)]\s*/, '').trim()).filter(Boolean) });
      return true;
    }
    const bul = line.split(/\s[•▪●]\s|\s-\s(?=[A-Z])/);
    if (bul.length >= 3) {
      pushPara(bul.shift());
      blocks.push({ type: 'ul', items: bul.map(x => x.trim()).filter(Boolean) });
      return true;
    }
    return false;
  };
  let list = null;
  text.split('\n').forEach(line => {
    const m = line.match(/^(?:[-*•▪●]|\d{1,2}[.)])\s+(.*)$/);
    if (m) {
      const type = /^\d/.test(line) ? 'ol' : 'ul';
      if (!list || list.type !== type) { list = { type, items: [] }; blocks.push(list); }
      list.items.push(m[1]);
      return;
    }
    list = null;
    if (!inlineList(line)) pushPara(line);
  });
  const seen = new Set();             // the same paragraph repeated by the site
  return blocks.filter(b => { const k = b.type + (b.text || b.items.join('|')); if (seen.has(k)) return false; seen.add(k); return true; });
}

function richText(raw) {
  return `<div class="rich">${textBlocks(raw).map(b => b.type === 'p'
    ? `<p>${esc(b.text)}</p>`
    : `<${b.type}>${b.items.map(i => `<li>${esc(i)}</li>`).join('')}</${b.type}>`).join('')}</div>`;
}

// Practice links for coding questions: a direct LeetCode problem for classics, otherwise searches.
const CLASSICS = [
  [/reverse (a |the )?linked list/i, 'reverse-linked-list'], [/two sum/i, 'two-sum'],
  [/valid parenthes|balanced (brackets|parenthes)/i, 'valid-parentheses'], [/merge two sorted (lists|linked)/i, 'merge-two-sorted-lists'],
  [/longest substring without repeat/i, 'longest-substring-without-repeating-characters'], [/maximum subarray|kadane/i, 'maximum-subarray'],
  [/detect (a )?cycle in (a )?linked list|linked list cycle/i, 'linked-list-cycle'], [/climbing stairs/i, 'climbing-stairs'],
  [/lowest common ancestor/i, 'lowest-common-ancestor-of-a-binary-tree'], [/level order traversal/i, 'binary-tree-level-order-traversal'],
  [/palindrom(e|ic) (string|number)|check (if|whether) .* palindrome/i, 'valid-palindrome'], [/anagram/i, 'valid-anagram'],
  [/second (highest|largest) salary/i, 'second-highest-salary'], [/nth highest salary/i, 'nth-highest-salary'],
  [/binary search\b/i, 'binary-search'], [/rotate (an )?array/i, 'rotate-array'], [/missing number/i, 'missing-number'],
  [/fibonacci/i, 'fibonacci-number'], [/lru cache/i, 'lru-cache'], [/merge intervals/i, 'merge-intervals'],
  [/number of islands/i, 'number-of-islands'], [/trapping rain ?water/i, 'trapping-rain-water'], [/best time to buy and sell/i, 'best-time-to-buy-and-sell-stock']
];
function practiceLinks(q) {
  if (subjectOf(q) !== 'Coding & DSA' && subjectOf(q) !== 'SQL & DBMS') return '';
  const hit = CLASSICS.find(([re]) => re.test(q.text));
  const terms = q.text.replace(/^(write (a|an) (program|function|code) (to|that|for)|how (would|do) you|explain|implement|given)\s+/i, '')
    .replace(/[?.]$/, '').split(/\s+/).slice(0, 8).join(' ');
  const lc = hit ? `https://leetcode.com/problems/${hit[1]}/` : `https://leetcode.com/problemset/?search=${encodeURIComponent(terms)}`;
  const gfg = `https://www.geeksforgeeks.org/search/?gq=${encodeURIComponent(terms)}`;
  return `<div class="practice">Practice: <a href="${lc}" target="_blank" rel="noopener noreferrer">${hit ? 'LeetCode problem' : 'Search LeetCode'} ↗</a>
    <a href="${gfg}" target="_blank" rel="noopener noreferrer">Search GeeksforGeeks ↗</a></div>`;
}

// ---------- session store (this tab only) ----------
const STORE_KEY = 'prepify.session.v1';
function loadStore() {
  try { return JSON.parse(sessionStorage.getItem(STORE_KEY)) || { companies: {} }; }
  catch (e) { return { companies: {} }; }
}
let store = loadStore();
function saveStore() {
  try { sessionStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* storage full or blocked */ }
}
function clearStore() {
  store = { companies: {} };
  ai.state = {};
  try { sessionStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
}

// ---------- the same thing is stored once ----------
// Pulling again, retrying, parallel article tabs and the same page reached by two links all deliver items
// that are already here, often with small differences: "Q1." numbering, case, spacing, punctuation, a
// trailing "Read more". These keys ignore all of that, so each question, answer, review and experience is
// kept once per site (questions are merged across sites later, when shown).
const dupKey = (t) => String(t || '').toLowerCase()
  .replace(/^\s*(?:q(?:uestion)?\s*\d+\s*[:.)\-]|\d{1,2}\s*[.)])\s*/, '')
  .replace(/\b(read more|show more|see more)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').trim();
const reviewKey = (r) => [r.title, r.pros, r.cons, r.body].map(dupKey).join('|');
function experienceKey(x) {
  const qs = (x.questions || []).map(q => dupKey(q.text)).join('|');
  const body = dupKey([x.process, x.application, ...(x.rounds || []).map(r => `${r.name} ${r.detail || ''}`)].filter(Boolean).join(' '));
  // an article page is one experience: its address identifies it; list pages hold many, so use the content
  return [dupKey(cleanRole(x.role)), dupKey(x.date), body.slice(0, 160) || qs.slice(0, 160)].join('#');
}
function addAnswers(target, answers) {
  const have = new Set((target.answers || []).map(dupKey));
  target.answers = target.answers || [];
  answers.forEach(a => { const k = dupKey(a); if (k && !have.has(k)) { have.add(k); target.answers.push(a); } });
}
function mergeExperience(into, x) {
  // the second copy may have read more of the page: keep the longer text and every question once
  ['process', 'application', 'tips'].forEach(f => { if ((x[f] || '').length > (into[f] || '').length) into[f] = x[f]; });
  if ((x.rounds || []).length > (into.rounds || []).length) into.rounds = x.rounds;
  const have = new Map((into.questions || []).map(q => [dupKey(q.text), q]));
  (x.questions || []).forEach(q => {
    const k = dupKey(q.text);
    if (!k) return;
    if (have.has(k)) addAnswers(have.get(k), q.answers || []);
    else { into.questions = into.questions || []; into.questions.push(q); have.set(k, q); }
  });
}

// Tidy data saved by older versions (glued questions, "Interview" titles, near-duplicates) so nothing
// needs re-pulling.
function normalizeStore() {
  Object.values(store.companies).forEach(c => {
    const qs = new Map();
    cleanQuestions(c.questions).forEach(q => {
      const k = q.source + '|' + dupKey(q.text);
      if (qs.has(k)) addAnswers(qs.get(k), q.answers || []);
      else qs.set(k, q);
    });
    c.questions = [...qs.values()];
    const xs = new Map();
    (c.experiences || []).forEach(x => {
      x.role = cleanRole(x.role);
      x.questions = cleanQuestions(x.questions);
      const k = x.source + '|' + experienceKey(x);
      if (xs.has(k)) mergeExperience(xs.get(k), x);
      else xs.set(k, { ...x, _k: experienceKey(x) });
    });
    c.experiences = [...xs.values()];
    const rs = new Map();
    (c.reviews || []).forEach(r => { const k = r.source + '|' + reviewKey(r); if (!rs.has(k)) rs.set(k, { ...r, _k: reviewKey(r) }); });
    c.reviews = [...rs.values()];
  });
  saveStore();
}
normalizeStore();

// Adds what the extension captured. Each question, review and experience is kept once per site (see dupKey);
// a repeat adds only what is new (an answer, a longer text). Returns how many new items were added.
function addCapture(payload, fallbackCompany) {
  const name = (payload.company_name || fallbackCompany || '').trim();
  if (!name) return 0;
  const key = name.toLowerCase();
  const c = store.companies[key] || (store.companies[key] = { name, questions: [], reviews: [] });
  c.experiences = c.experiences || [];
  c.official = c.official || [];
  const src = payload.source || 'Unknown';
  const now = new Date().toISOString();
  let added = 0;

  cleanQuestions(payload.questions).forEach(it => {
    const text = it.text;
    const answers = [].concat(it.answers || []).filter(a => typeof a === 'string' && a.trim()).map(a => a.trim());
    const k = dupKey(text);
    if (!k) return;
    const existing = c.questions.find(q => q.source === src && dupKey(q.text) === k);
    if (existing) { addAnswers(existing, answers); return; }
    c.questions.push({
      text, answers, source: src, url: payload.url,
      round_type: it.round_type || null, category: it.category || 'Other',
      difficulty: it.difficulty || null, role_title: it.role || 'General', created_at: now
    });
    added += 1;
  });

  (payload.reviews || []).forEach(r => {
    const k = reviewKey(r);
    if (k === '|||' || c.reviews.some(x => x.source === src && x._k === k)) return;
    c.reviews.push({ ...r, review_date: r.date || null, source: src, url: payload.url, created_at: now, _k: k });
    added += 1;
  });

  (payload.official || []).forEach(pg => {
    const i = c.official.findIndex(x => x.url === pg.url);
    const item = { ...pg, source: 'Official', created_at: now };
    if (i >= 0) c.official[i] = item; else { c.official.push(item); added += 1; }
  });

  (payload.experiences || []).forEach(raw => {
    const xp = { ...raw, role: cleanRole(raw.role), questions: cleanQuestions(raw.questions) };
    const k = experienceKey(xp);
    const same = c.experiences.find(x => x.source === src && x._k === k);
    if (same) { mergeExperience(same, xp); return; }
    c.experiences.push({ ...xp, source: src, url: xp.url || payload.url, created_at: now, _k: k });
    added += 1;
  });

  saveStore();
  return added;
}

// ---------- auth (optional Google sign-in) ----------
const auth = { clientId: null, user: null, ready: false, sources: {}, ai: null };
const signedIn = () => !!auth.user;

async function loadAuth() {
  try {
    const r = await getJson('/api/auth/config');
    auth.clientId = r.google_client_id;
    auth.user = r.user;
    auth.sources = r.sources || {};
    auth.ai = r.ai || null;
  } catch (e) { /* server offline: stay guest */ }
  auth.ready = true;
  renderAuth();
}

function renderAuth() {
  $$('[data-auth]').forEach(el => {
    el.innerHTML = auth.user
      ? `<span class="user" title="${esc(auth.user.email)}">${esc(auth.user.name)}</span><button class="linkbtn" data-signout>Sign out</button>`
      : `<span class="guest-tag">Guest</span><button class="btn small" data-signin>Sign in</button>`;
  });
  $$('[data-signin]').forEach(b => b.onclick = openSignin);
  $$('[data-signout]').forEach(b => b.onclick = signOut);
  $('#mode-line').innerHTML = auth.user
    ? `<span>Signed in as <b>${esc(auth.user.name)}</b>. Pulled data stays in this tab only and is gone when you close it.</span>`
    : `<span>Guest mode shows links only. Sign in with Google to pull questions, answers and experiences into Prepify.</span>
       <button class="linkbtn accent" data-signin>Sign in with Google</button>`;
  $$('#mode-line [data-signin]').forEach(b => b.onclick = openSignin);
}

function openSignin() {
  $('#signin-modal').classList.remove('hidden');
  const setup = !auth.clientId;
  $('#signin-setup').classList.toggle('hidden', !setup);
  $('#gsi-button').classList.toggle('hidden', setup);
  if (setup) return;
  const draw = () => {
    if (!(window.google && google.accounts && google.accounts.id)) return setTimeout(draw, 300);
    google.accounts.id.initialize({ client_id: auth.clientId, callback: onCredential });
    google.accounts.id.renderButton($('#gsi-button'), { theme: 'filled_black', size: 'large', text: 'signin_with', shape: 'rectangular' });
  };
  draw();
}

async function onCredential(resp) {
  try {
    const r = await getJson('/api/auth/google', { method: 'POST', body: JSON.stringify({ credential: resp.credential }) });
    auth.user = r.user;
    try { auth.ai = (await getJson('/api/auth/config')).ai || auth.ai; } catch (e) { /* keep what we had */ }
    $('#signin-modal').classList.add('hidden');
    renderAuth();
    rerender();
  } catch (e) {
    $('#signin-setup').classList.remove('hidden');
    $('#signin-setup').innerHTML = `<p class="modal-sub"><b>Sign-in failed:</b> ${esc(e.message)}</p>`;
  }
}

async function signOut() {
  try { await getJson('/api/auth/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
  auth.user = null;
  clearStore();                              // signing out also wipes everything pulled in this tab
  Object.keys(pulls).forEach(k => delete pulls[k]);
  renderAuth();
  rerender();
}

$('#signin-close').onclick = () => $('#signin-modal').classList.add('hidden');
$('#signin-modal').onclick = (e) => { if (e.target.id === 'signin-modal') $('#signin-modal').classList.add('hidden'); };

// ---------- pulling sources into Prepify (signed-in only, via the Prepify Capture extension) ----------
const pulls = {};                       // `${company}|${site}` -> { status, step, added }
const pullKey = (company, site) => `${company.toLowerCase()}|${site}`;
const hasExtension = () => !!document.documentElement.dataset.prepifyExt;

// A pull still running for a site is not started again (double clicks, "Pull all" while one runs);
// one that has been silent for longer than the extension's own time limit counts as finished.
const PULL_STALE_MS = 75000;
const pullRunning = (company, site) => {
  const p = pulls[pullKey(company, site)];
  return !!(p && p.status === 'working' && Date.now() - (p.at || 0) < PULL_STALE_MS);
};

function pullSources(company, sites = PULLABLE) {
  if (!signedIn()) { openSignin(); return; }
  sites = sites.filter(s => SITES[s] && !SITES[s].linkOnly && !pullRunning(company, s));
  if (!sites.length) { toast('Those sources are already being pulled.'); return; }
  const viaServer = sites.filter(s => s === 'Official' || (s === 'Reddit' && auth.sources.reddit_api));
  const viaExtension = sites.filter(s => !viaServer.includes(s));
  viaServer.forEach(s => pullFromServer(company, s));
  if (!viaExtension.length) return;
  if (!hasExtension()) { showExtensionNotice(); return; }
  viaExtension.forEach(site => { pulls[pullKey(company, site)] = { status: 'working', at: Date.now(), step: LOCATED_SITES.includes(site) ? 'finding the company page' : 'starting' }; });
  refreshBoxes();
  startExtensionPull(company, viaExtension);
}

// Code360 and PrepInsta file companies under names that can't be guessed (TCS is tata-consultancy-services),
// so the server finds the right page from each site's own index first, or says the site has nothing.
const LOCATED_SITES = ['Code360', 'PrepInsta'];

async function startExtensionPull(company, sites) {
  const start = (list, urls = {}, match = {}) => {
    if (list.length) window.postMessage({ source: 'prepify-page', type: 'research:start', company, sites: list, urls, match }, location.origin);
  };
  // sites that need no lookup start right away; each looked-up site starts as soon as its own page is found
  start(sites.filter(s => !LOCATED_SITES.includes(s)));
  await Promise.all(sites.filter(s => LOCATED_SITES.includes(s)).map(async (site) => {
    try {
      const r = await getJson(`/api/sources/locate?site=${encodeURIComponent(site)}&company=${encodeURIComponent(company)}`);
      if (!r.covered) {
        pulls[pullKey(company, site)] = { status: 'not-covered', detail: r.message };
        noteDiag(site, 'not-found', { detail: r.message });
        refreshBoxes();
        return;
      }
      start([site], { [site]: r.url }, { [site]: r.match || [] });
    } catch (e) {
      start([site]);                   // the index couldn't be read: fall back to the extension's own guess
    }
  }));
}

// Sources the Prepify server reads through an official API (nothing is stored there).
async function pullFromServer(company, site) {
  const key = pullKey(company, site);
  pulls[key] = { status: 'working', at: Date.now(), step: 'searching ' + site };
  refreshBoxes();
  try {
    const link = site === 'Official' ? OFFICIAL_LINKS[company.toLowerCase()] : null;
    const payload = await getJson(`/api/sources/${site.toLowerCase()}?company=${encodeURIComponent(company)}` +
                                  (link ? `&url=${encodeURIComponent(link)}` : ''));
    const added = addCapture(payload, company);
    const any = (payload.experiences || []).length || (payload.questions || []).length || (payload.official || []).length;
    pulls[key] = { status: any ? 'done' : 'empty', added };
    noteDiag(site, any ? 'done' : 'empty', { added });
    rerender();
  } catch (e) {
    const needsUrl = site === 'Official' && !!(e.body && e.body.needs_url);
    const why = needsUrl && e.body.reason !== 'unknown' ? e.message : null;
    pulls[key] = { status: needsUrl ? 'needs-url' : 'error', detail: why || (needsUrl ? null : e.message), tried: e.body && e.body.tried };
    noteDiag(site, needsUrl ? 'needs-url' : 'error', { detail: e.message });
    refreshBoxes();
    if (needsUrl) askOfficialLink(company, why, e.body && e.body.tried);
  }
}

// No careers page known for this company: ask the user for the link once.
function askOfficialLink(company, why = null, tried = null) {
  let el = $('#official-modal');
  if (!el) {
    el = document.createElement('div');
    el.id = 'official-modal';
    el.className = 'modal';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    document.body.appendChild(el);
  }
  el.innerHTML = `
    <form class="modal-box">
      <h2>Add ${esc(company)}'s careers page</h2>
      <p class="modal-sub">${why ? `${esc(why)} Paste a different official page, such as its campus hiring or selection process page,`
        : `Prepify doesn't know ${esc(company)}'s official careers or campus-hiring page yet. Paste its link`}
        and Prepify reads the eligibility, selection process and test pattern from it.</p>
      ${tried ? `<p class="modal-note">Tried: <a href="${esc(tried)}" target="_blank" rel="noopener noreferrer">${esc(tried)} ↗</a></p>` : ''}
      <input class="qa-filter" id="official-url" type="url" required placeholder="https://www.company.com/careers" aria-label="Careers page link" />
      <div class="login-actions">
        <button class="btn primary" type="submit">Read official page</button>
        <button class="linkbtn" type="button" data-close>Not now</button>
      </div>
    </form>`;
  const close = () => el.remove();
  el.querySelector('[data-close]').onclick = close;
  el.querySelector('form').onsubmit = (e) => {
    e.preventDefault();
    OFFICIAL_LINKS[company.toLowerCase()] = $('#official-url').value.trim();
    close();
    pullFromServer(company, 'Official');
  };
  setTimeout(() => $('#official-url').focus(), 0);
}

function showExtensionNotice() {
  if ($('#ext-notice')) return;
  $('#report').insertAdjacentHTML('afterbegin', `
    <div class="notice" id="ext-notice">
      <b>Prepify Capture extension not detected.</b> It reads the sites with your own signed-in Chrome.
      Load it from <code>chrome://extensions</code> → Developer mode → Load unpacked → the <code>extension</code> folder,
      then reload this page.
    </div>`);
}

window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.source !== 'prepify-ext') return;
  const m = e.data;
  if (m.type === 'ext:stale') {                     // the extension was reloaded after this page opened
    if (!$('#stale-notice')) {
      $('#report').insertAdjacentHTML('afterbegin', `
        <div class="notice" id="stale-notice">
          <b>Prepify Capture was updated.</b> Reload this page to reconnect. Your pulled data in this tab is kept.
          <div><button class="btn primary" onclick="location.reload()">Reload page</button></div>
        </div>`);
    }
    Object.keys(pulls).forEach(k => { if (pulls[k].status === 'working') delete pulls[k]; });
    refreshBoxes();
    return;
  }
  if (m.type === 'capture') {                       // "Save to Prepify" pressed on a site page
    if (!signedIn()) return;
    addCapture(m.payload, lastData && companyName(lastData));
    rerender();
    return;
  }
  if (m.type !== 'research:update') return;
  if (m.status === 'login' || m.status === 'blocked') {
    noteDiag(m.site, m.status, { detail: m.detail, outline: m.outline });
    pulls[pullKey(m.company, m.site)] = { status: m.status, detail: m.detail };
    refreshBoxes();
    if (!diag.active) showLoginPrompt(m.site, m.company, m.status);   // during a source check, just record it
    return;
  }
  if (m.status === 'login-cleared') {
    hideLoginPrompt(m.site);
    toast(`Signed in to ${m.site}. Retrying ${m.site}…`);
    pullSources(m.company, [m.site]);
    return;
  }
  if (m.status === 'login-closed') {
    updateLoginPrompt(m.site, 'The sign-in tab was closed. Open it again, or retry if you already signed in.');
    return;
  }
  let added = 0;
  if (m.status === 'done' && m.payload) added = addCapture(m.payload, m.company);
  pulls[pullKey(m.company, m.site)] = { status: m.status, step: m.step, added, detail: m.detail, at: Date.now() };
  if (m.status !== 'working') noteDiag(m.site, m.status, { added, detail: m.detail, outline: m.outline });
  m.status === 'done' ? rerender() : refreshBoxes();
});

// ---------- sign-in prompt: a source needs the user to sign in (or pass a check) first ----------
const loginQueue = [];          // sites waiting for the user, shown one at a time

function showLoginPrompt(site, company, reason) {
  if (!loginQueue.some(x => x.site === site)) loginQueue.push({ site, company, reason });
  renderLoginPrompt();
}
function hideLoginPrompt(site) {
  const i = loginQueue.findIndex(x => x.site === site);
  if (i >= 0) loginQueue.splice(i, 1);
  renderLoginPrompt();
}
function updateLoginPrompt(site, note) {
  const item = loginQueue.find(x => x.site === site);
  if (item) { item.note = note; renderLoginPrompt(); }
}

function renderLoginPrompt() {
  let el = $('#login-modal');
  const item = loginQueue[0];
  if (!item) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'login-modal';
    el.className = 'modal';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    document.body.appendChild(el);
  }
  const s = siteInfo(item.site);
  const blocked = item.reason === 'blocked';
  el.innerHTML = `
    <div class="modal-box login-box">
      <div class="login-head">
        <span class="mark big" style="--c:${s.color}">${esc(s.mark)}</span>
        <div>
          <h2>${blocked ? `${esc(item.site)} wants to check you're human` : `Sign in to ${esc(item.site)}`}</h2>
          <p class="modal-sub">Needed to pull ${esc(item.site)} results for ${esc(item.company)}.</p>
        </div>
      </div>
      <ol class="login-steps">
        <li>Click <b>${blocked ? 'Open verification' : `Open ${esc(item.site)} sign-in`}</b>. It opens in the tab just to the left of Prepify.</li>
        <li>${blocked ? 'Complete the check there.' : `Sign in there. Your password goes only to ${esc(item.site)}, never to Prepify.`}</li>
        <li>Prepify notices when you're done, brings you back and retries ${esc(item.site)} automatically.</li>
      </ol>
      ${item.note ? `<p class="notice">${esc(item.note)}</p>` : ''}
      <div class="login-actions">
        <button class="btn primary" data-login-open>${blocked ? 'Open verification' : `Open ${esc(item.site)} sign-in`}</button>
        <button class="btn" data-login-retry>I'm signed in, retry</button>
        <button class="linkbtn" data-login-skip>Skip ${esc(item.site)} for now</button>
      </div>
      ${loginQueue.length > 1 ? `<p class="modal-note">Also waiting: ${loginQueue.slice(1).map(x => esc(x.site)).join(', ')}</p>` : ''}
    </div>`;
  el.querySelector('[data-login-open]').onclick = () =>
    window.postMessage({ source: 'prepify-page', type: 'login:open', site: item.site, company: item.company }, location.origin);
  el.querySelector('[data-login-retry]').onclick = () => { hideLoginPrompt(item.site); pullSources(item.company, [item.site]); };
  el.querySelector('[data-login-skip]').onclick = () => hideLoginPrompt(item.site);
}

// Destructive buttons ask once more: the first click arms them for a few seconds, the second acts.
function confirmClick(btn, act, label = 'Click again to confirm') {
  if (!btn) return;
  btn.onclick = () => {
    if (btn.dataset.armed) { clearTimeout(btn._disarm); act(); return; }
    const before = btn.textContent;
    btn.dataset.armed = '1';
    btn.textContent = label;
    btn.classList.add('armed');
    btn._disarm = setTimeout(() => { delete btn.dataset.armed; btn.textContent = before; btn.classList.remove('armed'); }, 4000);
  };
}

function toast(text) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 4000);
}

// ---------- source check: pull every source, time it, report exactly what happened ----------
const diag = { active: false, company: null, started: 0, results: {} };

function runSourceCheck(company) {
  diag.active = true;
  diag.company = company;
  diag.started = Date.now();
  diag.results = {};
  PULLABLE.forEach(site => { diag.results[site] = { status: 'working', t0: Date.now() }; });
  renderDiag();
  if (!signedIn()) { diag.active = false; renderDiag(); openSignin(); return; }
  pullSources(company);
  if (!hasExtension()) {
    PULLABLE.filter(site => !(site === 'Official' || (site === 'Reddit' && auth.sources.reddit_api)))
      .forEach(site => noteDiag(site, 'error', { detail: 'Prepify Capture extension not detected' }));
  }
  const started = diag.started;
  setTimeout(() => {               // nothing should run longer than this
    if (diag.started !== started) return;
    Object.entries(diag.results).forEach(([site, r]) => { if (r.status === 'working') noteDiag(site, 'timeout', { detail: 'No answer from the source within 90 s' }); });
  }, 90000);
}

function noteDiag(site, status, info = {}) {
  if (!diag.active || !diag.results[site]) return;
  const r = diag.results[site];
  Object.assign(r, info, { status, ms: Date.now() - r.t0 });
  renderDiag();
}

const DIAG_LABEL = {
  working: 'Running…', done: 'Passed', empty: 'No results', 'not-found': 'No results', login: 'Needs sign-in',
  blocked: 'Needs verification', 'needs-url': 'Needs careers link', timeout: 'Timed out', error: 'Error', cancelled: 'Cancelled'
};
const diagKind = (st) => st === 'done' ? 'good' : st === 'working' ? '' : (st === 'empty' || st === 'not-found') ? 'muted' : 'bad';

function diagCounts(site) {
  if (!lastData) return { x: 0, q: 0, a: 0 };
  const g = groupBySource(lastData).find(x => x.name === site);
  return g ? { x: g.experiences.length + g.official.length, q: g.questions.length, a: g.answers } : { x: 0, q: 0, a: 0 };
}

function renderDiag() {
  let el = $('#diag-modal');
  if (!diag.active) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'diag-modal';
    el.className = 'modal';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    document.body.appendChild(el);
  }
  const rows = Object.entries(diag.results);
  const finished = rows.filter(([, r]) => r.status !== 'working').length;
  el.innerHTML = `
    <div class="modal-box diag-box">
      <h2>Source check · ${esc(diag.company)}</h2>
      <p class="modal-sub">${finished} of ${rows.length} sources finished. Failures include an outline of the page so they can be fixed.</p>
      <div class="diag-table" role="table">
        <div class="diag-row head" role="row"><span>Source</span><span>Result</span><span>Items</span><span>Questions</span><span>Answers</span><span>Time</span></div>
        ${rows.map(([site, r]) => {
          const c = diagCounts(site);
          return `<div class="diag-row" role="row">
            <span><span class="mark tiny" style="--c:${siteInfo(site).color}">${esc(siteInfo(site).mark)}</span>${esc(site)}</span>
            <span class="diag-st ${diagKind(r.status)}">${r.status === 'working' ? '<span class="spinner"></span>' : ''}${esc(DIAG_LABEL[r.status] || r.status)}</span>
            <span>${c.x}</span><span>${c.q}</span><span>${c.a}</span>
            <span>${r.ms ? (r.ms / 1000).toFixed(1) + ' s' : '–'}</span>
            ${r.detail && r.status !== 'done' ? `<span class="diag-detail" title="${esc(r.detail)}">Stopped at: ${esc(r.detail)}</span>` : ''}
          </div>`;
        }).join('')}
      </div>
      <div class="login-actions">
        <button class="btn primary" data-diag-copy>Copy report</button>
        <button class="btn" data-diag-rerun>Run again</button>
        <button class="linkbtn" data-diag-close>Close</button>
      </div>
    </div>`;
  el.querySelector('[data-diag-copy]').onclick = async (e) => {
    try { await navigator.clipboard.writeText(diagReport()); e.target.textContent = 'Copied'; }
    catch (err) { e.target.textContent = 'Copy blocked by the browser'; }
  };
  el.querySelector('[data-diag-rerun]').onclick = () => runSourceCheck(diag.company);
  el.querySelector('[data-diag-close]').onclick = () => { diag.active = false; renderDiag(); };
}

function diagReport() {
  const lines = [
    `Prepify source check · ${diag.company} · ${new Date().toISOString()} · extension ${document.documentElement.dataset.prepifyExt || 'not detected'}`,
    '',
    '| Source | Result | Items | Questions | Answers | Time | Stopped at |',
    '| --- | --- | --- | --- | --- | --- | --- |'
  ];
  const fails = [];
  Object.entries(diag.results).forEach(([site, r]) => {
    const c = diagCounts(site);
    lines.push(`| ${site} | ${DIAG_LABEL[r.status] || r.status} | ${c.x} | ${c.q} | ${c.a} | ${r.ms ? (r.ms / 1000).toFixed(1) + ' s' : '-'} | ${(r.status !== 'done' && r.detail) || ''} |`);
    if (r.status !== 'done' && r.status !== 'working' && r.outline) fails.push(`### ${site}: ${r.status}` + '\n```\n' + r.outline + '\n```');
  });
  if (fails.length) lines.push('', '## Page outlines for failures', '', ...fails);
  return lines.join('\n');
}

// ---------- routing ----------
function showHome() {
  $('#home').classList.remove('hidden');
  $('#results').classList.add('hidden');
  document.title = 'Prepify';
  $('#home-q').focus();
  typeExamples();
}

// The empty home search box types example searches into its placeholder, slowly, to show what works.
// It stops for good once the person types, and never runs for people who ask for less motion.
const HOME_HINT = 'Search a company, role or round…';
const HOME_EXAMPLES = ['TCS Ninja HR questions', 'Amazon SDE 2 system design round', 'Accenture ASE interview process',
                       'Infosys SP coding questions', 'Target data analyst interview'];
let typing = null;
function typeExamples() {
  const box = $('#home-q');
  if (!box || typing || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const stop = () => { clearTimeout(typing && typing.t); typing = { stopped: true }; box.placeholder = HOME_HINT; };
  box.addEventListener('input', stop, { once: true });
  let n = 0;
  const wait = (ms, fn) => { if (!typing.stopped) typing.t = setTimeout(fn, ms); };
  const type = (text, i, then) => {
    if (typing.stopped || box.value) return;
    box.placeholder = text.slice(0, i);
    if (i < text.length) wait(55 + Math.random() * 45, () => type(text, i + 1, then));
    else wait(2200, then);
  };
  const erase = (text, i, then) => {
    if (typing.stopped || box.value) return;
    box.placeholder = text.slice(0, i);
    if (i > 0) wait(22, () => erase(text, i - 1, then));
    else wait(350, then);
  };
  const next = () => {
    if ($('#home').classList.contains('hidden')) { typing = null; box.placeholder = HOME_HINT; return; }
    const text = HOME_EXAMPLES[n++ % HOME_EXAMPLES.length];
    type(text, 0, () => erase(text, text.length, () => {
      if (n % HOME_EXAMPLES.length === 0) { box.placeholder = HOME_HINT; wait(4000, next); } else next();
    }));
  };
  typing = { stopped: false };
  wait(3000, next);                       // first the plain hint, then the examples
}

const urlFor = (q, src, tab) => '/?q=' + encodeURIComponent(q) + (src ? '&src=' + encodeURIComponent(src) : '') + (src && tab ? '&tab=' + encodeURIComponent(tab) : '');
const currentSrc = () => new URLSearchParams(location.search).get('src');

function go(q, push = true, src = null, tab = null) {
  q = q.trim();
  if (!q) return;
  if (push) history.pushState({ q, src, tab }, '', urlFor(q, src, tab));
  return runSearch(q, src);
}

// Links inside Prepify are real links (Ctrl/middle-click opens a new tab); a plain click stays in the page.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-nav]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  const u = new URL(a.href, location.origin);
  go(u.searchParams.get('q') || '', true, u.searchParams.get('src'), u.searchParams.get('tab'));
  window.scrollTo(0, 0);
});

window.addEventListener('popstate', () => {
  const params = new URLSearchParams(location.search);
  const q = params.get('q');
  q ? go(q, false, params.get('src')) : showHome();
});

// ---------- search ----------
let lastParsed = null;   // { query, parsed } from the server
let lastData = null;     // parsed + this tab's data for the company

function buildData() {
  const p = lastParsed.parsed;
  const entry = p.company ? store.companies[p.company.toLowerCase()] : null;
  let questions = entry ? aiApply(entry, entry.questions) : [];
  let roleMatched;
  if (p.role && questions.length) {
    const f = questions.filter(q => (q.role_title || '').toLowerCase().includes(p.role.toLowerCase()));
    roleMatched = f.length > 0;
    if (f.length) questions = f;
  }
  return { query: lastParsed.query, parsed: p, company: entry ? { name: entry.name } : null,
           questions, reviews: entry ? entry.reviews : [],
           experiences: entry ? (entry.experiences || []).map(x => ({ ...x, questions: aiApply(entry, x.questions, false) })) : [],
           official: entry ? (entry.official || []) : [],
           role_matched: roleMatched };
}

async function runSearch(q, src) {
  $('#home').classList.add('hidden');
  $('#results').classList.remove('hidden');
  $('#top-q').value = q;
  if ($('#results-title')) $('#results-title').textContent = 'Results for ' + q;
  document.title = q + ' - Prepify';
  try {
    if (!lastParsed || lastParsed.query !== q) {
      $('#understood').textContent = 'Searching…';
      $('#report').innerHTML = '';
      $('#panel').innerHTML = '';
      const known = Object.values(store.companies).map(c => c.name);
      const qs = 'q=' + encodeURIComponent(q) + known.map(k => '&known=' + encodeURIComponent(k)).join('');
      lastParsed = await getJson('/api/parse?' + qs);
      if (aiReady() && aiWantsParse(lastParsed.parsed)) {
        $('#understood').textContent = 'Reading your search with AI…';
        lastParsed = await aiParse(lastParsed);
      }
    }
    rerender(src);
    window.scrollTo(0, 0);
  } catch (e) {
    $('#understood').textContent = '';
    $('#report').innerHTML = `<div class="empty"><h3>Search failed</h3>${esc(e.message)}</div>`;
  }
}

function rerender(src = currentSrc()) {
  if (!lastParsed || $('#results').classList.contains('hidden')) return;
  lastData = buildData();
  if (src === 'JD' && jdNow()) renderJdPage(lastData);
  else if (!signedIn()) renderGuest(lastData);
  else render(lastData, src);
  aiSchedule();
}

const companyName = (d) => d.company ? d.company.name : d.parsed.company;
const INTENT_LABEL = { questions: 'Questions', experiences: 'Experiences', process: 'Process', tips: 'Tips',
                       salary: 'Salary', reviews: 'Reviews', technical: 'Technical', hr: 'HR' };

// What Prepify understood from the search, as chips the user can correct.
function understoodLine(p) {
  const el = $('#understood');
  if (!p.company && !p.role) { el.innerHTML = ''; return; }
  const chip = (k, v) => v ? `<span class="u-chip"><span class="k">${k}</span>${esc(v)}</span>` : '';
  el.innerHTML = `
    <span class="u-chips">
      ${chip('Company', p.company || 'Not found')}
      ${chip('Role', p.role || 'Any')}
      ${chip('Level', p.level)}
      ${chip('Experience', p.experience)}
      ${chip('Location', p.location)}
      ${chip('Year', p.year)}
      ${chip('Rounds', (p.rounds || []).join(', '))}
      ${chip('Topics', (p.topics || []).map(t => t.name).join(', '))}
      ${chip('Looking for', (p.intents || []).map(i => INTENT_LABEL[i] || i).join(', '))}
      <button class="linkbtn accent" id="u-edit" type="button">Edit</button>
    </span>
    ${p.corrected_from ? `<span class="u-note">Showing results for <b>${esc(p.company)}</b>. You typed “${esc(p.corrected_from)}”.</span>` : ''}
    ${p.company_source === 'guess' ? `<span class="u-note">Prepify took “${esc(p.company)}” to be the company. If that's wrong, click Edit.</span>` : ''}
    ${p.company_source === 'ai' ? `<span class="u-note">Read with AI assist. If anything's wrong, click Edit.</span>` : ''}
    <form class="u-edit hidden" id="u-form">
      <label>Company<input id="u-company" name="company" autocomplete="organization" spellcheck="false" value="${esc(p.company || '')}" /></label>
      <label>Role<input id="u-role" name="role" autocomplete="organization-title" value="${esc(p.role || '')}" placeholder="Any role…" /></label>
      <button class="btn small primary" type="submit">Apply</button>
      <button class="linkbtn" type="button" id="u-cancel">Cancel</button>
    </form>`;
  $('#u-edit').onclick = () => { $('#u-form').classList.remove('hidden'); $('#u-company').focus(); };
  $('#u-cancel').onclick = () => $('#u-form').classList.add('hidden');
  $('#u-form').onsubmit = (e) => {
    e.preventDefault();
    const c = $('#u-company').value.trim().replace(/"/g, '');
    const r = $('#u-role').value.trim().replace(/"/g, '');
    const rest = (lastParsed ? lastParsed.query : '').replace(/\b(company|role):\s*("[^"]*"|\S+)\s*/gi, '').trim();
    go([c && `company:"${c}"`, r && `role:"${r}"`, rest].filter(Boolean).join(' '), true, currentSrc());
  };
}

function noCompany() {
  $('#panel').innerHTML = '';
  $('#report').innerHTML = `<div class="empty"><h3>Which company do you mean?</h3>
    Try naming it, for example <i>Infosys interview questions</i> or <i>Accenture ASE interview process</i>.</div>`;
}

// ---------- guest view: links only ----------
function renderGuest(d) {
  understoodLine(d.parsed);
  if (!d.parsed.company) return noCompany();
  const name = companyName(d);
  const links = [...Object.entries(SITES).filter(([, x]) => x.url(name)), ['Google', GOOGLE]];
  $('#report').innerHTML = `
    <header class="dash-head">
      <div class="dash-title">
        <h2>${esc(name)}</h2>
        <p>Guest mode shows a link to each source. Sign in to pull the questions and experiences into Prepify.</p>
      </div>
      <div class="dash-actions"><button class="btn primary" data-signin>Sign in with Google</button></div>
    </header>
    ${jdBanner(d)}
    <div class="link-grid">${links.map(([label, s]) => `
      <a class="link-row" href="${s.url(name)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(label)}: ${esc(name)} (opens in a new tab)">
        <span class="mark" style="--c:${s.color}">${esc(s.mark)}</span>
        <span class="lr-text"><b>${esc(label)}</b><span>${esc(label === 'Google' ? 'Web results' : s.host)}</span></span>
        <span class="lr-arrow" aria-hidden="true">↗</span>
      </a>`).join('')}
    </div>`;
  $$('#report [data-signin]').forEach(b => b.onclick = openSignin);
  $('#panel').innerHTML = `<div class="panel">${jdPanelHtml()}${aiPanelHtml()}</div>`;
  wireAiPanel();
  wireJdPanel(d);
}

// ---------- signed-in results: source boxes + a dedicated area per site ----------
function groupBySource(d) {
  const groups = new Map();
  const blank = (s) => ({ name: s, questions: [], reviews: [], experiences: [], official: [], pages: new Map() });
  PULLABLE.forEach(s => groups.set(s, blank(s)));
  const add = (x, kind) => {
    const s = x.source || 'Unknown';
    if (!groups.has(s)) groups.set(s, blank(s));
    const g = groups.get(s);
    g[kind].push(x);
    if (x.url) {
      const p = g.pages.get(x.url) || { url: x.url, items: 0, saved: '' };
      p.items += 1;
      if ((x.created_at || '') > p.saved) p.saved = x.created_at;
      g.pages.set(x.url, p);
    }
  };
  d.questions.forEach(q => add(q, 'questions'));
  d.reviews.forEach(r => add(r, 'reviews'));
  (d.experiences || []).forEach(x => add(x, 'experiences'));
  (d.official || []).forEach(x => add(x, 'official'));
  groups.forEach(g => {
    g.answers = g.questions.reduce((n, q) => n + (q.answers || []).length, 0);
    g.newest = [...g.questions, ...g.reviews, ...g.experiences, ...g.official].map(x => x.created_at).sort().at(-1);
  });
  return [...groups.values()];
}
const hasData = (g) => g.questions.length || g.reviews.length || g.experiences.length || g.official.length;

// Subject of a question, from its wording (sites rarely label it). First match wins,
// so specific technical subjects come before broad ones like HR.
const SUBJECTS = [
  ['SQL & DBMS', /\b(sql|dbms|rdbms|databases?|normali[sz]ation|primary key|foreign key|acid propert|inner join|outer join|left join|right join|sql joins?|stored procedure|indexing|nosql|mongodb|mysql|postgres(ql)?|(second|third|nth|top \d+) highest salary|highest salary|employee table|from the \w+ table|write (a|an) (sql )?query|sql query)\b/i],
  ['OOP', /\b(oops?|object[- ]oriented|inheritance|polymorphism|encapsulation|abstraction|overloading|overriding|abstract class)\b/i],
  ['System Design', /\b(system design|design (a|an|the) |architecture|scalab|high[- ]level design|low[- ]level design|microservices?|load balanc|distributed system|concurrent users)/i],
  ['Data & ML', /\b(machine learning|ml model|data science|forecast|regression|classification|neural|deep learning|llm|nlp|statistic|a\/b test)/i],
  ['Coding & DSA', /\b(array|string|linked ?list|binary tree|tree|graph|sort(ing)?|binary search|dynamic programming|recursion|stack|queue|hash ?map|palindrome|fibonacci|reverse|algorithm|time complexity|leetcode|coding|write a (function|program|code))\b/i],
  ['OS & Networks', /\b(operating system|multithreading|threads?|deadlock|semaphore|paging|virtual memory|computer networks?|networking|tcp|udp|osi model|ip address|dns)\b/i],
  ['Cloud & DevOps', /\b(cloud|aws|azure|gcp|docker|kubernetes|devops|ci\/?cd|git|jenkins|linux)\b/i],
  ['Languages & Frameworks', /(c\+\+|\bc#|\bc language|\bc and c\b|\b(java|python|javascript|typescript|react|angular|spring|node(\.js)?|\.net|html|css|django|flask|golang|kotlin|pointers?)\b)/i],
  ['Aptitude & Reasoning', /\b(aptitude|puzzle|reasoning|probability|percentage|ratio|time and work|logical)\b/i],
  ['Projects & Experience', /\b(projects?|internship|product you built|worked on|final year|your role|previous (job|company)|experience)\b/i],
  ['HR & Behavioral', /\b(yourself|why|strengths?|weakness|relocat|shifts?|salary|ctc|notice period|team|conflict|disagree|challenge|goals?|five years|hobb|motivat|pressure|join|tell me about a time|situation|career|manager)\b/i]
];
function subjectOf(q) {
  if (q.category && q.category !== 'Other') return q.category;
  const hit = SUBJECTS.find(([, re]) => re.test(q.text));
  return hit ? hit[0] : 'General';
}

const STATUS_TEXT = {
  working: 'Reading in the background…',
  login: 'Sign-in needed. Click to sign in.',
  'needs-url': 'Add the official careers page link. Click to add.',
  blocked: 'Verification needed. Click to continue.',
  'not-found': 'Couldn\'t find an interview page. Click to retry.',
  empty: 'The page had no questions. Click to retry.',
  timeout: 'Took too long. Click to retry.',
  error: 'Couldn\'t read the page. Click to retry.',
  cancelled: 'Cancelled. Click to retry.'
};

// What each outcome means, and the one thing to do about it. "act" needs the user on the site first;
// "fail" and "none" can simply run again. Every action re-runs only that source.
const STATUS_INFO = {
  working: { text: 'Reading…' },
  login: { text: 'Sign-in needed', action: 'Sign in', kind: 'act' },
  blocked: { text: 'Human check', action: 'Verify', kind: 'act' },
  'needs-url': { text: 'Link needed', action: 'Add link', kind: 'act' },
  timeout: { text: 'Too slow to load', action: 'Retry', kind: 'fail' },
  error: { text: "Couldn't read page", action: 'Retry', kind: 'fail' },
  cancelled: { text: 'Stopped early', action: 'Retry', kind: 'fail' },
  'not-found': { text: 'Nothing found', action: 'Retry', kind: 'none' },
  'not-covered': { text: 'Not covered', kind: 'none' },
  empty: { text: 'No questions found', action: 'Retry', kind: 'none' }
};
const RETRYABLE = ['timeout', 'error', 'cancelled', 'not-found', 'empty'];

// A source as one tile: the name and one line (counts, or what's happening). Pulled ones link to their page.
function sourceCard(g, company) {
  const s = siteInfo(g.name);
  const has = hasData(g);
  const pull = pulls[pullKey(company, g.name)];
  const busy = pull && pull.status === 'working';
  const step = busy && pull.step && pull.step !== 'starting' ? sentence(pull.step) + '…' : null;
  const counts = g.official.length ? plural(g.official.length, 'official page')
    : [g.questions.length && plural(g.questions.length, 'question'), g.experiences.length && plural(g.experiences.length, 'experience')]
      .filter(Boolean).join(' · ') || (g.reviews.length ? plural(g.reviews.length, 'review') : '');
  const info = !busy && pull && !has ? STATUS_INFO[pull.status] : null;
  const status = busy ? (step || STATUS_INFO.working.text) : (info ? info.text : null);
  const kind = busy ? 'busy' : info ? info.kind : '';
  const open = has && !busy;
  const tag = open ? 'a' : 'button';
  const attrs = open ? `href="${urlFor(lastData.query, g.name)}" data-nav` : `type="button" data-src="${esc(g.name)}"`;
  const tip = pull && !busy && pull.status !== 'done' ? ` title="${esc([STATUS_TEXT[pull.status], pull.detail].filter(Boolean).join(' '))}"` : '';
  const label = info ? `${g.name}: ${info.text}.${info.action ? ` ${info.action} runs ${g.name} again.` : ''}` : null;
  return `<${tag} class="src-tile ${kind}" ${attrs}${tip}${label ? ` aria-label="${esc(label)}"` : ''}>
      <span class="mark" style="--c:${s.color}">${esc(s.mark)}</span>
      <span class="st-text"><b>${esc(g.name)}</b>
        <span class="st-sub">${busy ? '<span class="spinner"></span>' : ''}${esc(status || counts || 'Nothing found')}</span></span>
      ${info && info.action ? `<span class="st-action">${esc(info.action)}</span>`
             : `<span class="st-arrow" aria-hidden="true">${busy || info ? '' : has ? '→' : '↻'}</span>`}
    </${tag}>`;
}

// Pulled sources as tiles; the rest as one row of chips to pull from.
function sourcesHtml(groups, name) {
  const tiled = (g) => hasData(g) || pulls[pullKey(name, g.name)];
  const tiles = groups.filter(tiled);
  const rest = groups.filter(g => !tiled(g));
  const linkOnly = Object.entries(SITES).filter(([, s]) => s.linkOnly);
  const chip = (g) => { const s = siteInfo(g.name); return `
    <button class="src-chip" type="button" data-src="${esc(g.name)}" title="Pull ${esc(g.name)} into Prepify">
      <span class="mark tiny" style="--c:${s.color}">${esc(s.mark)}</span>${esc(g.name)}<span class="plus" aria-hidden="true">+</span>
    </button>`; };
  return `<div class="src-grid">${tiles.map(g => sourceCard(g, name)).join('')}</div>
    <div class="source-more">
      ${rest.length ? `<span class="source-more-label">${tiles.length ? 'More sources' : 'Sources'}</span>${rest.map(chip).join('')}` : ''}
      ${linkOnly.map(([label, s]) => `
        <a class="src-chip link" href="${s.url(name)}" target="_blank" rel="noopener noreferrer" title="${esc(label)} allows links only; opens in a new tab">
          <span class="mark tiny" style="--c:${s.color}">${esc(s.mark)}</span>${esc(label)}<span class="plus" aria-hidden="true">↗</span>
        </a>`).join('')}
    </div>`;
}

// ---------- results dashboard + one full page per source ----------
const TABS = [
  ['official', 'Official info'],
  ['experiences', 'Experiences'],
  ['questions', 'Questions & answers'],
  ['discussions', 'Discussions'],
  ['reviews', 'Reviews'],
  ['pages', 'Source pages']
];
const layoutEl = () => document.querySelector('.layout');

function render(d, src = null) {
  const p = d.parsed;
  understoodLine(p);
  if (!p.company) return noCompany();
  const groups = groupBySource(d);
  const g = src && groups.find(x => x.name === src);
  if (g && hasData(g)) return renderSourcePage(d, g, groups);
  layoutEl().classList.remove('wide');
  renderPanel(companyName(d), d);
  renderDashboard(d, groups);
}

// kept for old links
function renderSource(d, src) { render(d, src); }

// ----- dashboard: a header with the main actions, the sources, then what stands out across them -----
function renderDashboard(d, groups) {
  const name = companyName(d);
  const withData = groups.filter(hasData);
  const anything = withData.length > 0;
  const nq = pulledQuestions(d).length;
  const nx = (d.experiences || []).length;
  let html = `
    ${dashHeadHtml(d, groups, name)}
    <div id="sources">${sourcesHtml(groups, name)}</div>
    ${jdBanner(d)}${aiStripHtml(d)}`;
  if (anything) html += glance(d, withData);
  $('#report').innerHTML = html;
  wireDashHead(name);
  wireBrief(d);
  wireCards(name);
  wireJdBanner(d);
  wireAiStrip();
  wirePdf();
}

// Sources whose last pull didn't work, by what they need.
function sourceProblems(groups, name) {
  const out = { act: [], retry: [], missing: [] };
  groups.forEach(g => {
    const pull = pulls[pullKey(name, g.name)];
    if (!pull || hasData(g) || !STATUS_INFO[pull.status]) return;
    if (STATUS_INFO[pull.status].kind === 'act') out.act.push({ name: g.name, action: STATUS_INFO[pull.status].action });
    else if (RETRYABLE.includes(pull.status)) out.retry.push(g.name);
    else if (pull.status === 'not-covered') out.missing.push(g.name);
  });
  return out;
}

const listNames = (xs) => xs.length < 3 ? xs.join(' and ') : xs.slice(0, -1).join(', ') + ' and ' + xs.at(-1);

function dashHeadHtml(d, groups, name) {
  const withData = groups.filter(hasData);
  const anything = withData.length > 0;
  const nq = pulledQuestions(d).length;
  const nx = (d.experiences || []).length;
  const prob = sourceProblems(groups, name);
  const notes = [];
  if (prob.act.length) notes.push(`<span class="dash-note act">Needs you: ${prob.act.map(x => `${esc(x.name)} (${esc(x.action.toLowerCase())})`).join(', ')}. Click the tile; Prepify then runs only that source again.</span>`);
  if (prob.missing.length) notes.push(`<span class="dash-note">${esc(listNames(prob.missing))} ${prob.missing.length === 1 ? 'has' : 'have'} nothing for ${esc(name)}.</span>`);
  if (prob.retry.length) notes.push(`<span class="dash-note">${esc(listNames(prob.retry))} didn't finish or found nothing. Retry runs only ${prob.retry.length === 1 ? 'that one' : 'those'}.</span>`);
  return `<header class="dash-head" id="dash-head">
      <div class="dash-title">
        <h2>${esc(name)}</h2>
        <p>${anything ? `${plural(nq, 'question')} · ${plural(nx, 'experience')} · from ${plural(withData.length, 'source')}. Open a source to read everything it has.`
          : 'Nothing pulled yet. Pull the sources and their questions and experiences appear here.'}</p>
        ${notes.join('')}
      </div>
      <div class="dash-actions">
        ${prob.retry.length ? `<button class="btn" data-retry-failed>Retry ${prob.retry.length === 1 ? esc(prob.retry[0]) : `${prob.retry.length} failed`}</button>` : ''}
        <button class="btn ${anything ? '' : 'primary'}" data-pull-all>Pull all sources</button>
        ${anything ? '<button class="btn primary" data-pdf="">Download PDF</button>' : ''}
        ${anything && hasBrief() ? '<button class="btn" data-pdf="BRIEF">Download brief</button>' : ''}
      </div>
    </header>`;
}

function wireDashHead(name) {
  $$('[data-pull-all]').forEach(b => b.onclick = () => pullSources(name));
  $$('[data-retry-failed]').forEach(b => b.onclick = () => {
    const retry = sourceProblems(groupBySource(lastData), name).retry;
    if (retry.length) pullSources(name, retry);           // only the ones that failed
  });
  wirePdf();
}

// Questions that fit the rounds or topics named in the search ("Amazon HR questions", "... SQL ...").
const ROUND_SUBJECTS = {
  HR: ['HR & Behavioral'], Behavioural: ['HR & Behavioral'], Managerial: ['HR & Behavioral', 'Projects & Experience'],
  'System design': ['System Design'], Coding: ['Coding & DSA'], 'Online assessment': ['Coding & DSA', 'Aptitude & Reasoning'],
  Aptitude: ['Aptitude & Reasoning'], Puzzles: ['Aptitude & Reasoning'], 'Machine coding': ['Coding & DSA', 'Languages & Frameworks'],
  Technical: ['SQL & DBMS', 'OOP', 'System Design', 'Data & ML', 'Coding & DSA', 'OS & Networks', 'Cloud & DevOps', 'Languages & Frameworks', 'Projects & Experience'],
  'Case study': ['Data & ML', 'Aptitude & Reasoning']
};
function searchFocus(d) {
  const p = d.parsed;
  const subjects = new Set((p.rounds || []).flatMap(r => ROUND_SUBJECTS[r] || []));
  const topics = (p.topics || []).map(t => rxFor(t.pattern));
  if (!subjects.size && !topics.length) return null;
  const label = [...(p.rounds || []), ...(p.topics || []).map(t => t.name)].join(', ');
  const qs = pulledQuestions(d).filter(q => subjects.has(subjectOf(q)) || topics.some(rx => rx.test(q.text)));
  return { label, qs };
}

// Cross-source highlights shown under the boxes.
function glance(d, withData) {
  const subjects = {};
  d.questions.forEach(q => { const s = subjectOf(q); subjects[s] = (subjects[s] || 0) + 1; });
  const sites = new Map();
  d.questions.forEach(q => {
    const k = qKey(q);
    const e = sites.get(k) || { text: q.text, sites: new Set() };
    e.sites.add(q.source);
    sites.set(k, e);
  });
  const repeated = [...sites.values()].filter(e => e.sites.size > 1);

  let html = '<div class="glance">' + briefHtml(d) + practiceHtml(d) + askHtml(d);
  const focus = searchFocus(d);
  if (focus) {
    html += `<section class="section">
        <h2>Your search: ${esc(focus.label)}</h2>
        <p class="sub">${focus.qs.length ? `${plural(focus.qs.length, 'pulled question')} on this, from every source.` : 'None of the pulled questions are on this yet. Pull more sources, or add the job description for practice questions.'}</p>
        ${focus.qs.length ? `<ol class="repeat-list">${focus.qs.slice(0, 15).map(q => `<li><span>${esc(q.text)}</span><small>${[...q.sources].map(esc).join(' + ')}</small></li>`).join('')}</ol>` : ''}
      </section>`;
  }
  if (Object.keys(subjects).length) {
    html += `<section class="section">
        <h2>Subjects asked</h2>
        <p class="sub">Across all sources, ${aiOn() && !ai.showOriginal ? 'tagged by AI assist' : "worked out from each question's wording"}.</p>
        <div class="chips static">${Object.entries(subjects).sort((a, b) => b[1] - a[1])
          .map(([s, n]) => `<span class="chip-btn">${esc(s)} <span>${n}</span></span>`).join('')}</div>
      </section>`;
  }
  if (repeated.length) {
    html += `<section class="section">
        <h2>Asked on more than one site</h2>
        <p class="sub">The strongest signals: the same question reported independently.</p>
        <ol class="repeat-list">${repeated.map(e => `<li><span>${esc(e.text)}</span><small>${[...e.sites].map(esc).join(' + ')}</small></li>`).join('')}</ol>
      </section>`;
  }
  return html + '</div>';
}

function openSource(src, tab = null) {
  go(lastData.query, true, src, tab);
  window.scrollTo(0, 0);
}

function wireCards(name) {
  $$('#sources button[data-src]').forEach(card => card.onclick = () => {
    const src = card.dataset.src;
    if (card.classList.contains('busy')) return;
    const pull = pulls[pullKey(name, src)];
    if (pull && (pull.status === 'login' || pull.status === 'blocked')) {
      showLoginPrompt(src, name, pull.status);
      return;
    }
    if (pull && pull.status === 'needs-url') { askOfficialLink(name, pull.detail, pull.tried); return; }
    if (pull && pull.status === 'not-covered') { toast(pull.detail || `${src} has nothing for ${name}.`); return; }
    if (SITES[src]) pullSources(name, [src]);
  });
}

// re-render just the boxes (keeps scroll position)
function refreshBoxes() {
  if (!lastData || !signedIn()) return;
  const box = $('#sources');
  if (!box) return;
  const name = companyName(lastData);
  const groups = groupBySource(lastData);
  box.innerHTML = sourcesHtml(groups, name);
  const head = $('#dash-head');
  if (head) { head.outerHTML = dashHeadHtml(lastData, groups, name); wireDashHead(name); }
  wireCards(name);
}

// ----- one source's own page: breadcrumb, source switcher, header, tabs -----
function renderSourcePage(d, g, groups) {
  layoutEl().classList.add('wide');
  $('#panel').innerHTML = '';
  const name = companyName(d);
  const s = siteInfo(g.name);
  const counts = {
    official: g.official.length,
    experiences: g.experiences.length,
    questions: g.questions.length,
    discussions: g.experiences.filter(x => (x.discussion || []).length).length,
    reviews: g.reviews.length,
    pages: g.pages.size
  };
  const tabs = TABS.filter(([k]) => counts[k] > 0);
  const wanted = new URLSearchParams(location.search).get('tab');
  const tab = tabs.some(([k]) => k === wanted) ? wanted : tabs[0][0];

  $('#report').innerHTML = `
    <nav class="crumbs" aria-label="Breadcrumb">
      <a class="btn small" href="${urlFor(d.query)}" data-nav>← Back to results</a>
      <span class="crumb-path"><a class="linkbtn" href="${urlFor(d.query)}" data-nav>${esc(name)}</a><span aria-hidden="true">›</span><b aria-current="page">${esc(g.name)}</b></span>
      <nav class="switcher" aria-label="Sources">
        ${groups.filter(hasData).map(o => `
          <a class="switch ${o.name === g.name ? 'active' : ''}" href="${urlFor(d.query, o.name)}" data-nav ${o.name === g.name ? 'aria-current="page"' : ''}>
            <span class="mark tiny" style="--c:${siteInfo(o.name).color}">${esc(siteInfo(o.name).mark)}</span>${esc(o.name)}
          </a>`).join('')}
      </nav>
    </nav>

    <header class="source-hero">
      <span class="mark big" style="--c:${s.color}">${esc(s.mark)}</span>
      <div class="hero-text">
        <h1>${esc(g.name)} <span class="dim">· ${esc(name)}</span></h1>
        <div class="sub">${g.official.length
          ? `${plural(g.official.length, 'official page')} · ${plural(g.official.reduce((n, pg) => n + (pg.sections || []).length, 0), 'section')}`
          : `${plural(counts.experiences, 'experience')} · ${plural(counts.questions, 'question')} · ${plural(g.answers, 'answer')}${counts.reviews ? ' · ' + plural(counts.reviews, 'review') : ''}`} · pulled ${fmtDate(g.newest)}</div>
      </div>
      <div class="head-actions">
        <button class="btn primary" data-pdf="${esc(g.name)}">Download PDF</button>
        ${SITES[g.name] && !SITES[g.name].linkOnly ? `<button class="btn" id="refresh-src" data-src="${esc(g.name)}">Pull again</button>` : ''}
        ${s.url && s.url(name) ? `<a class="btn" href="${s.url(name)}" target="_blank" rel="noopener noreferrer">Open ${esc(g.name)} ↗</a>` : ''}
      </div>
    </header>

    <nav class="tabs" role="tablist">
      ${tabs.map(([k, label]) => `<button class="tab ${k === tab ? 'active' : ''}" role="tab" aria-selected="${k === tab}" data-tab="${k}">${label}<span>${counts[k]}</span></button>`).join('')}
    </nav>
    <div id="tab-body" role="tabpanel"></div>

    <div class="page-foot">
      <a class="btn" href="${urlFor(d.query)}" data-nav>← Back to results</a>
      <button class="linkbtn" id="to-top">Back to top ↑</button>
    </div>`;

  const showTab = (k) => {
    $$('.tabs .tab').forEach(t => { t.classList.toggle('active', t.dataset.tab === k); t.setAttribute('aria-selected', t.dataset.tab === k); });
    history.replaceState({ q: d.query, src: g.name, tab: k }, '', urlFor(d.query, g.name, k));
    $('#tab-body').innerHTML = tabBody(k, g, groups);
    wireTab(k, name);
  };
  $$('.tabs .tab').forEach(t => t.onclick = () => showTab(t.dataset.tab));

  $('#to-top').onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  const rb = $('#refresh-src');
  if (rb) rb.onclick = () => { pullSources(name, [rb.dataset.src]); rb.textContent = 'Pulling…'; rb.disabled = true; };
  showTab(tab);
  wirePdf();
}

function tabBody(k, g, groups) {
  if (k === 'official') {
    return `<div class="official-list">${g.official.map(pg => `
      <article class="official-page">
        <header>
          <a class="thread-title" href="${esc(pg.url)}" target="_blank" rel="noopener noreferrer">${esc(pg.title)} ↗</a>
          <div class="thread-meta">Official page · read ${fmtDate(pg.created_at)}</div>
        </header>
        ${(pg.sections || []).map(sec => `
          <section class="official-section">
            <h3>${esc(sec.heading)}</h3>
            ${richText(sec.text)}
          </section>`).join('')}
      </article>`).join('')}</div>`;
  }

  if (k === 'experiences') {
    const list = [...g.experiences].sort(byDateDesc);
    const counts = { good: 0, bad: 0, none: 0 };
    list.forEach(x => { counts[outcomeKind(x.outcome) || 'none'] += 1; });
    return `
      <div class="qa-tools">
        <div class="chips">
          <button class="chip-btn active" data-outcome="">All <span>${list.length}</span></button>
          ${counts.good ? `<button class="chip-btn" data-outcome="good">Offer or selected <span>${counts.good}</span></button>` : ''}
          ${counts.bad ? `<button class="chip-btn" data-outcome="bad">No offer or rejected <span>${counts.bad}</span></button>` : ''}
          ${counts.none && counts.none !== list.length ? `<button class="chip-btn" data-outcome="none">Outcome not stated <span>${counts.none}</span></button>` : ''}
        </div>
        <input class="qa-filter" id="xp-filter" placeholder="Filter experiences…" aria-label="Filter experiences" />
      </div>
      <div class="xp-list">${list.map((x, i) => xpCard(x, i)).join('')}</div>
      <p class="qa-none hidden" id="xp-none">No experiences match.</p>`;
  }

  if (k === 'questions') {
    const elsewhere = new Map();
    groups.filter(o => o.name !== g.name).forEach(o => o.questions.forEach(q => elsewhere.set(qKey(q), o.name)));
    const subjects = {};
    const qs = g.questions.map(q => { const subject = subjectOf(q); subjects[subject] = (subjects[subject] || 0) + 1; return { ...q, subject }; });
    const inJd = jdNow() ? qs.filter(q => jdSkillsIn(q.text).length).length : 0;
    return `
      <div class="qa-tools">
        <div class="chips">
          <button class="chip-btn active" data-subject="">All <span>${qs.length}</span></button>
          ${inJd ? `<button class="chip-btn jd" data-subject="__jd">Matches your JD <span>${inJd}</span></button>` : ''}
          ${Object.entries(subjects).sort((a, b) => b[1] - a[1]).map(([c, n]) => `<button class="chip-btn" data-subject="${esc(c)}">${esc(c)} <span>${n}</span></button>`).join('')}
        </div>
        <input class="qa-filter" id="qa-filter" placeholder="Filter questions…" aria-label="Filter questions" />
        ${aiAnswerBatchButton(qs)}
      </div>
      <div class="qa-list">${qs.map((q, i) => qaCard(q, i, g.name, elsewhere.get(qKey(q)))).join('')}</div>
      <p class="qa-none hidden" id="qa-none">No questions match.</p>`;
  }

  if (k === 'discussions') {
    const threads = g.experiences.filter(x => (x.discussion || []).length).sort((a, b) => (b.score || 0) - (a.score || 0));
    return `<div class="thread-list">${threads.map(x => `
      <article class="thread">
        <header>
          <a class="thread-title" href="${esc(x.url || '#')}" target="_blank" rel="noopener noreferrer">${esc(x.role || 'Discussion')}</a>
          <div class="thread-meta">${esc([x.location, x.date].filter(Boolean).join(' · '))}${x.score ? ` · ▲ ${esc(x.score)}` : ''}${x.comments ? ` · ${plural(x.comments, 'comment')}` : ''}</div>
        </header>
        ${x.process ? `<details class="thread-post"><summary>Original post</summary>${richText(x.process)}</details>` : ''}
        <ul class="xp-discussion">${x.discussion.map(c => `<li><span class="score">▲ ${esc(c.score)}</span>${richText(c.text)}</li>`).join('')}</ul>
      </article>`).join('')}</div>`;
  }

  if (k === 'reviews') return `<div class="review-list">${g.reviews.map(r => reviewHtml(r)).join('')}</div>`;

  return `<p class="sub">Every item on this page came from one of these pages.</p>
    ${[...g.pages.values()].map(pg => `
      <div class="result">
        <div class="title"><a href="${esc(pg.url)}" target="_blank" rel="noopener noreferrer">${esc(pg.url)}</a></div>
        <div class="meta">${plural(pg.items, 'item')} · pulled ${fmtDate(pg.saved)}</div>
      </div>`).join('')}`;
}

function wireTab(k, company) {
  $$('#tab-body .more-btn').forEach(b => {
    b.dataset.label = b.textContent;
    b.onclick = () => {
      const box = b.previousElementSibling;
      const open = box.classList.toggle('hidden') === false;
      b.textContent = open ? 'Hide answers' : b.dataset.label;
    };
  });

  if (k === 'questions') {
    let subject = '';
    const apply = () => {
      const f = $('#qa-filter').value.trim().toLowerCase();
      let shown = 0;
      $$('.qa-card').forEach(c => {
        const ok = (!subject || (subject === '__jd' ? c.dataset.jd === '1' : c.dataset.subject === subject)) && (!f || c.dataset.text.includes(f));
        c.classList.toggle('hidden', !ok);
        if (ok) shown += 1;
      });
      $('#qa-none').classList.toggle('hidden', shown > 0);
    };
    $$('#tab-body [data-subject]').forEach(b => b.onclick = () => {
      subject = b.dataset.subject;
      $$('#tab-body [data-subject]').forEach(x => x.classList.toggle('active', x === b));
      apply();
    });
    $('#qa-filter').oninput = apply;
    wireAiAnswers();
  }

  if (k === 'experiences') {
    let outcome = '';
    const apply = () => {
      const f = $('#xp-filter').value.trim().toLowerCase();
      let shown = 0;
      $$('.xp-card').forEach(c => {
        const ok = (!outcome || c.dataset.outcome === outcome) && (!f || c.textContent.toLowerCase().includes(f));
        c.classList.toggle('hidden', !ok);
        if (ok) shown += 1;
      });
      $('#xp-none').classList.toggle('hidden', shown > 0);
    };
    $$('#tab-body [data-outcome]').forEach(b => b.onclick = () => {
      outcome = b.dataset.outcome;
      $$('#tab-body [data-outcome]').forEach(x => x.classList.toggle('active', x === b));
      apply();
    });
    $('#xp-filter').oninput = apply;
  }
}

// newest experiences first; "3 months ago" style dates sort after real dates
function xpTime(x) {
  const t = Date.parse(x.date || '');
  return isNaN(t) ? 0 : t;
}
const byDateDesc = (a, b) => xpTime(b) - xpTime(a);
const sentence = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

function badge(text, kind) {
  return text ? `<span class="tag ${kind || ''}">${esc(sentence(text))}</span>` : '';
}
function outcomeKind(t) {
  return /accepted|selected|got offer|^offer/i.test(t || '') ? 'good' : /no offer|rejected|declined/i.test(t || '') ? 'bad' : '';
}
function experienceKind(t) {
  return /positive/i.test(t || '') ? 'good' : /negative/i.test(t || '') ? 'bad' : '';
}

function xpCard(x, i) {
  const block = (label, body) => body ? `<div class="xp-block"><div class="xp-label">${label}</div>${body}</div>` : '';
  const para = (t) => t ? richText(t) : '';
  const rounds = (x.rounds || []).length
    ? `<ol class="xp-rounds">${x.rounds.map(r => `<li><b>${esc(r.name)}</b>${r.detail ? richText(r.detail) : ''}</li>`).join('')}</ol>` : '';
  const qs = (x.questions || []).length
    ? `<ol class="xp-questions">${x.questions.map(q => `<li><span>${esc(q.text)}</span>${(q.answers || []).map((a, j) =>
        `<div class="answer"><div class="a-label">Answer${q.answers.length > 1 ? ' ' + (j + 1) : ''}</div>${richText(a)}</div>`).join('')}${practiceLinks(q)}</li>`).join('')}</ol>` : '';
  const preview = tidyText(x.process || x.application || (x.rounds && x.rounds[0] && `${x.rounds[0].name}: ${x.rounds[0].detail}`) || '').replace(/\n/g, ' ');
  const title = cleanRole(x.role) || `Interview experience ${i + 1}`;
  return `
    <details class="xp-card" data-outcome="${outcomeKind(x.outcome) || 'none'}" ${i === 0 ? 'open' : ''}>
      <summary>
        <div class="xp-head">
          <span class="xp-role">${esc(title)}</span>
          <span class="xp-when">${esc([x.date, x.location].filter(Boolean).join(' · '))}</span>
        </div>
        <div class="xp-badges">
          ${badge(x.outcome, outcomeKind(x.outcome))}${badge(x.experience, experienceKind(x.experience))}${badge(x.difficulty)}
          ${(x.rounds || []).length ? badge(plural(x.rounds.length, 'round')) : ''}${(x.questions || []).length ? badge(plural(x.questions.length, 'question')) : ''}
          ${x.comments ? badge(plural(x.comments, 'comment')) : ''}${x.score ? badge('▲ ' + x.score) : ''}
        </div>
        ${preview ? `<div class="xp-preview">${esc(preview)}</div>` : ''}
      </summary>
      <div class="xp-body">
        ${block('How they applied', para(x.application))}
        ${block('Interview process', para(x.process))}
        ${block('Rounds', rounds)}
        ${block('Questions asked', qs)}
        ${block('Tips', para(x.tips))}
        ${(x.discussion || []).length ? block(`Discussion · top ${plural(x.discussion.length, 'comment')}`,
          `<ul class="xp-discussion">${x.discussion.map(c => `<li><span class="score">▲ ${esc(c.score)}</span>${richText(c.text)}</li>`).join('')}</ul>`) : ''}
        ${x.url ? `<div class="meta">Pulled ${fmtDate(x.created_at)} · <a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">Source page</a></div>` : ''}
      </div>
    </details>`;
}

// "Technical round", unless the subject already says it ("Coding & DSA" + "Coding")
function roundTag(q) {
  const r = (q.round_type || '').trim();
  if (!r || (q.subject || '').toLowerCase().startsWith(r.toLowerCase())) return '';
  return `<span class="tag">${esc(/round$/i.test(r) ? r : r + ' round')}</span>`;
}

// The actions under a question, in one row: write a model answer (when the site had none) and practise it.
function qaActions(q, site, unanswered) {
  const write = unanswered && !aiAnswerFor(q) ? aiAnswerBlock(q, site) : '';
  const practise = practiseButton(q);
  return write || practise ? `<div class="qa-actions">${write}${practise}</div>` : '';
}

function qaCard(q, i, site, alsoOn) {
  const answers = q.answers || [];
  const first = answers[0];
  const rest = answers.slice(1);
  return `
    <article class="qa-card" data-subject="${esc(q.subject)}" data-text="${esc(q.text.toLowerCase())}" data-jd="${jdSkillsIn(q.text).length ? 1 : 0}">
      <div class="qa-q"><span class="qnum">Q${i + 1}</span><span>${esc(q.text)}</span></div>
      <div class="qa-tags">
        <span class="tag">${esc(q.subject)}</span>
        ${jdTagsHtml(q.text)}
        ${roundTag(q)}
        ${q.difficulty ? `<span class="tag">${esc(q.difficulty)}</span>` : ''}
        ${alsoOn ? `<span class="tag good">Also on ${esc(alsoOn)}</span>` : ''}
      </div>
      ${first
        ? `<div class="answer"><div class="a-label">Answer${answers.length > 1 ? ' 1' : ''}</div>${richText(first)}</div>
           ${rest.length ? `
             <div class="more-answers hidden">${rest.map((a, j) =>
               `<div class="answer"><div class="a-label">Answer ${j + 2}</div>${richText(a)}</div>`).join('')}</div>
             <button class="linkbtn more-btn">Show ${plural(rest.length, 'more answer')}</button>` : ''}`
        : `<div class="answer none">No answer shown on ${esc(site)}</div>${aiAnswerFor(q) ? aiAnswerBlock(q, site) : ''}`}
      ${qaActions(q, site, !first)}
      ${practiceLinks(q)}
    </article>`;
}

function reviewHtml(r) {
  return `
    <div class="result">
      <div class="title">${esc(r.title || r.job_title || 'Review')}${r.rating ? ` · ${r.rating}/5` : ''}</div>
      ${r.pros ? `<div class="pros"><b>Pros</b>${esc(tidyText(r.pros))}</div>` : ''}
      ${r.cons ? `<div class="cons"><b>Cons</b>${esc(tidyText(r.cons))}</div>` : ''}
      ${r.body ? richText(r.body) : ''}
      <div class="meta">${r.job_title ? esc(r.job_title) + ' · ' : ''}${r.review_date ? esc(r.review_date) + ' · ' : ''}Pulled ${fmtDate(r.created_at)}</div>
    </div>`;
}

// ---------- side panel (signed in) ----------
function renderPanel(name, d) {
  $('#panel').innerHTML = `
    <div class="panel">
      ${jdPanelHtml()}
      ${aiPanelHtml()}
      <div class="panel-sep"></div>
      <h3>This session</h3>
      ${hasExtension() ? '' : '<p class="note warn">The Prepify Capture extension isn\'t connected, so sources can\'t be pulled.</p>'}
      <button class="linkbtn" id="panel-check">Run source check</button>
      <button class="linkbtn danger" id="panel-clear">Clear this session's data</button>
      <p class="note">Pulled data lives only in this browser tab. Closing the tab or signing out erases it.</p>
    </div>`;
  wireAiPanel();
  wireJdPanel(d);
  $('#panel-check').onclick = () => runSourceCheck(name);
  confirmClick($('#panel-clear'), () => { clearStore(); Object.keys(pulls).forEach(k => delete pulls[k]); rerender(); });
}

// ---------- wiring ----------
$('#home-form').onsubmit = (e) => { e.preventDefault(); go($('#home-q').value); };
$('#top-form').onsubmit = (e) => { e.preventDefault(); go($('#top-q').value); };
$('#logo-home').onclick = (e) => { e.preventDefault(); history.pushState({}, '', '/'); showHome(); };
$$('.example').forEach(c => c.onclick = () => { $('#home-q').value = c.textContent; go(c.textContent); });

$('#home-research').onclick = async () => {
  const q = $('#home-q').value.trim();
  if (!q) { $('#home-q').focus(); return; }
  await go(q);
  if (signedIn() && lastData && lastData.parsed.company) pullSources(companyName(lastData));
};

// "/" focuses the search box
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if ($('#ai-modal')) { closeAiConsent(); return; }     // the top dialog only
    $('#signin-modal').classList.add('hidden');
    closeJdModal();
    if (loginQueue[0]) hideLoginPrompt(loginQueue[0].site);
  }
  if (e.key !== '/' || ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  e.preventDefault();
  const box = $('#results').classList.contains('hidden') ? $('#home-q') : $('#top-q');
  box.focus(); box.select();
});

// initial load: auth first, so the first render knows guest vs signed in
(async () => {
  await loadAuth();
  const params = new URLSearchParams(location.search);
  params.get('q') ? go(params.get('q'), false, params.get('src')) : showHome();
})();
