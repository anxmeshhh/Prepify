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
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

// ---------- sources ----------
// linkOnly: Prepify never reads that site automatically (LinkedIn bans automated access); it only links.
const SITES = {
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
  LinkedIn: {
    mark: 'in', color: '#4a90d9', host: 'linkedin.com', linkOnly: true,
    url: (n) => `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(n + ' interview experience')}`
  }
};
const PULLABLE = Object.keys(SITES).filter(k => !SITES[k].linkOnly);
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
  try { sessionStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
}

// Tidy data saved by older versions (glued questions, "Interview" titles) so nothing needs re-pulling.
function normalizeStore() {
  Object.values(store.companies).forEach(c => {
    const merged = [];
    cleanQuestions(c.questions).forEach(q => {
      const have = merged.find(m => m.source === q.source && m.text === q.text);
      if (have) (q.answers || []).forEach(a => { if (!have.answers.includes(a)) have.answers.push(a); });
      else merged.push(q);
    });
    c.questions = merged;
    (c.experiences || []).forEach(x => { x.role = cleanRole(x.role); x.questions = cleanQuestions(x.questions); });
  });
  saveStore();
}
normalizeStore();

// Adds what the extension captured; the same question is kept once per site, answers merged.
function addCapture(payload, fallbackCompany) {
  const name = (payload.company_name || fallbackCompany || '').trim();
  if (!name) return 0;
  const key = name.toLowerCase();
  const c = store.companies[key] || (store.companies[key] = { name, questions: [], reviews: [] });
  c.experiences = c.experiences || [];
  const src = payload.source || 'Unknown';
  const now = new Date().toISOString();
  let added = 0;

  cleanQuestions(payload.questions).forEach(it => {
    const text = it.text;
    const answers = [].concat(it.answers || []).filter(a => typeof a === 'string' && a.trim()).map(a => a.trim());
    const existing = c.questions.find(q => q.source === src && q.text === text);
    if (existing) {
      answers.forEach(a => { if (!existing.answers.includes(a)) existing.answers.push(a); });
      return;
    }
    c.questions.push({
      text, answers, source: src, url: payload.url,
      round_type: it.round_type || null, category: it.category || 'Other',
      difficulty: it.difficulty || null, role_title: it.role || 'General', created_at: now
    });
    added += 1;
  });

  (payload.reviews || []).forEach(r => {
    const k = [r.title, r.pros, r.cons, r.body].map(x => (x || '').trim()).join('|');
    if (k === '|||' || c.reviews.some(x => x.source === src && x._k === k)) return;
    c.reviews.push({ ...r, review_date: r.date || null, source: src, url: payload.url, created_at: now, _k: k });
    added += 1;
  });

  (payload.experiences || []).forEach(raw => {
    const xp = { ...raw, role: cleanRole(raw.role), questions: cleanQuestions(raw.questions) };
    const k = [xp.role, xp.date, (xp.process || xp.application || '').slice(0, 80), (xp.rounds || []).length,
               xp.questions.map(q => q.text).join('|').slice(0, 120)].join('#');
    if (c.experiences.some(x => x.source === src && x._k === k)) return;
    c.experiences.push({ ...xp, source: src, url: xp.url || payload.url, created_at: now, _k: k });
    added += 1;
  });

  saveStore();
  return added;
}

// ---------- auth (optional Google sign-in) ----------
const auth = { clientId: null, user: null, ready: false, sources: {} };
const signedIn = () => !!auth.user;

async function loadAuth() {
  try {
    const r = await getJson('/api/auth/config');
    auth.clientId = r.google_client_id;
    auth.user = r.user;
    auth.sources = r.sources || {};
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
    ? `Signed in as <b>${esc(auth.user.name)}</b>. Pulled data stays in this tab only and is gone when you close it.`
    : `Guest mode shows links only. <button class="linkbtn accent" data-signin>Sign in with Google</button> to pull questions, answers and experiences into Prepify.`;
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

function pullSources(company, sites = PULLABLE) {
  if (!signedIn()) { openSignin(); return; }
  sites = sites.filter(s => SITES[s] && !SITES[s].linkOnly);
  const viaServer = sites.filter(s => s === 'Reddit' && auth.sources.reddit_api);
  const viaExtension = sites.filter(s => !viaServer.includes(s));
  viaServer.forEach(s => pullFromServer(company, s));
  if (!viaExtension.length) return;
  if (!hasExtension()) { showExtensionNotice(); return; }
  viaExtension.forEach(site => { pulls[pullKey(company, site)] = { status: 'working', step: 'starting' }; });
  window.postMessage({ source: 'prepify-page', type: 'research:start', company, sites: viaExtension }, location.origin);
  refreshBoxes();
}

// Sources the Prepify server reads through an official API (nothing is stored there).
async function pullFromServer(company, site) {
  const key = pullKey(company, site);
  pulls[key] = { status: 'working', step: 'searching ' + site };
  refreshBoxes();
  try {
    const payload = await getJson(`/api/sources/${site.toLowerCase()}?company=${encodeURIComponent(company)}`);
    const added = addCapture(payload, company);
    const any = (payload.experiences || []).length || (payload.questions || []).length;
    pulls[key] = { status: any ? 'done' : 'empty', added };
    rerender();
  } catch (e) {
    pulls[key] = { status: 'error', detail: e.message };
    refreshBoxes();
  }
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
  if (m.type === 'capture') {                       // "Save to Prepify" pressed on a site page
    if (!signedIn()) return;
    addCapture(m.payload, lastData && companyName(lastData));
    rerender();
    return;
  }
  if (m.type !== 'research:update') return;
  let added = 0;
  if (m.status === 'done' && m.payload) added = addCapture(m.payload, m.company);
  pulls[pullKey(m.company, m.site)] = { status: m.status, step: m.step, added };
  m.status === 'done' ? rerender() : refreshBoxes();
});

// ---------- routing ----------
function showHome() {
  $('#home').classList.remove('hidden');
  $('#results').classList.add('hidden');
  document.title = 'Prepify';
  $('#home-q').focus();
}

const urlFor = (q, src, tab) => '/?q=' + encodeURIComponent(q) + (src ? '&src=' + encodeURIComponent(src) : '') + (src && tab ? '&tab=' + encodeURIComponent(tab) : '');
const currentSrc = () => new URLSearchParams(location.search).get('src');

function go(q, push = true, src = null, tab = null) {
  q = q.trim();
  if (!q) return;
  if (push) history.pushState({ q, src, tab }, '', urlFor(q, src, tab));
  return runSearch(q, src);
}

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
  let questions = entry ? entry.questions : [];
  let roleMatched;
  if (p.role && questions.length) {
    const f = questions.filter(q => (q.role_title || '').toLowerCase().includes(p.role.toLowerCase()));
    roleMatched = f.length > 0;
    if (f.length) questions = f;
  }
  return { query: lastParsed.query, parsed: p, company: entry ? { name: entry.name } : null,
           questions, reviews: entry ? entry.reviews : [], experiences: entry ? (entry.experiences || []) : [],
           role_matched: roleMatched };
}

async function runSearch(q, src) {
  $('#home').classList.add('hidden');
  $('#results').classList.remove('hidden');
  $('#top-q').value = q;
  document.title = q + ' - Prepify';
  try {
    if (!lastParsed || lastParsed.query !== q) {
      $('#understood').textContent = 'Searching…';
      $('#report').innerHTML = '';
      $('#panel').innerHTML = '';
      const known = Object.values(store.companies).map(c => c.name);
      const qs = 'q=' + encodeURIComponent(q) + known.map(k => '&known=' + encodeURIComponent(k)).join('');
      lastParsed = await getJson('/api/parse?' + qs);
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
  if (!signedIn()) return renderGuest(lastData);
  render(lastData, src);
}

const companyName = (d) => d.company ? d.company.name : d.parsed.company;
const INTENT_LABEL = { questions: 'Questions', process: 'Process', technical: 'Technical', hr: 'HR', reviews: 'Reviews' };

function understoodLine(p) {
  $('#understood').innerHTML = p.company
    ? `<span class="k">Company</span> <b>${esc(p.company)}</b> <span class="k">Role</span> <b>${esc(p.role || 'Any')}</b> <span class="k">Looking for</span> <b>${esc(p.intents.map(i => INTENT_LABEL[i] || i).join(', '))}</b>`
    : '';
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
  const links = [...Object.entries(SITES), ['Google', GOOGLE]];
  $('#report').innerHTML = `
    <div class="notice guest">
      <b>You're browsing as a guest.</b> Guests get links to the sources only. Sign in with Google to pull
      interview experiences, questions and answers from Glassdoor and AmbitionBox straight into Prepify.
      Pulled data stays in your browser tab and is never stored on a server.
      <div><button class="btn primary" data-signin>Sign in with Google</button></div>
    </div>
    <div class="sources-head"><span>Sources for <b>${esc(name)}</b></span><span class="hint">Opens the site in a new tab</span></div>
    <div class="source-grid">${links.map(([label, s]) => `
      <a class="source-card link-card" href="${s.url(name)}" target="_blank" rel="noopener noreferrer">
        <div class="sc-head">
          <span class="mark" style="--c:${s.color}">${esc(s.mark)}</span>
          <span class="sc-name">${esc(label)}</span>
          <span class="sc-arrow">↗</span>
        </div>
        <div class="sc-host">${esc(s.host)}</div>
        <div class="sc-stats muted">${label === 'Google' ? 'Web results for interview experiences' : `${esc(name)} on ${esc(label)}`}</div>
        <div class="sc-foot">Open in a new tab</div>
      </a>`).join('')}
    </div>`;
  $$('#report [data-signin]').forEach(b => b.onclick = openSignin);
  $('#panel').innerHTML = `
    <div class="panel">
      <h3>${esc(name)}</h3>
      <div class="kind">Company</div>
      <div class="row"><span>Mode</span><span class="off">Guest · links only</span></div>
      <button class="btn" data-signin>Sign in to pull sources</button>
      <p class="note">When you're signed in, Prepify reads Glassdoor and AmbitionBox in the background with your own Chrome and shows everything here.</p>
    </div>`;
  $$('#panel [data-signin]').forEach(b => b.onclick = openSignin);
}

// ---------- signed-in results: source boxes + a dedicated area per site ----------
function groupBySource(d) {
  const groups = new Map();
  const blank = (s) => ({ name: s, questions: [], reviews: [], experiences: [], pages: new Map() });
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
  groups.forEach(g => {
    g.answers = g.questions.reduce((n, q) => n + (q.answers || []).length, 0);
    g.newest = [...g.questions, ...g.reviews, ...g.experiences].map(x => x.created_at).sort().at(-1);
  });
  return [...groups.values()];
}
const hasData = (g) => g.questions.length || g.reviews.length || g.experiences.length;

// Subject of a question, from its wording (sites rarely label it). First match wins,
// so specific technical subjects come before broad ones like HR.
const SUBJECTS = [
  ['SQL & DBMS', /\b(sql|dbms|rdbms|databases?|normali[sz]ation|primary key|foreign key|acid propert|inner join|outer join|left join|right join|sql joins?|stored procedure|indexing|nosql|mongodb|mysql|postgres(ql)?)\b/i],
  ['OOP', /\b(oops?|object[- ]oriented|inheritance|polymorphism|encapsulation|abstraction|overloading|overriding|abstract class)\b/i],
  ['System Design', /\b(system design|design (a|an|the) |architecture|scalab|high[- ]level design|low[- ]level design|microservices?|load balanc|distributed system|concurrent users)/i],
  ['Data & ML', /\b(machine learning|ml model|data science|forecast|regression|classification|neural|deep learning|llm|nlp|statistic|a\/b test)/i],
  ['Coding & DSA', /\b(array|string|linked ?list|binary tree|tree|graph|sort(ing)?|binary search|dynamic programming|recursion|stack|queue|hash ?map|palindrome|fibonacci|reverse|algorithm|time complexity|leetcode|coding|write a (function|program|code))\b/i],
  ['OS & Networks', /\b(operating system|multithreading|threads?|deadlock|semaphore|paging|virtual memory|computer networks?|networking|tcp|udp|osi model|ip address|dns)\b/i],
  ['Cloud & DevOps', /\b(cloud|aws|azure|gcp|docker|kubernetes|devops|ci\/?cd|git|jenkins|linux)\b/i],
  ['Languages & Frameworks', /\b(java|python|c\+\+|javascript|typescript|react|angular|spring|node(\.js)?|\.net|html|css|django|flask)\b/i],
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
  login: 'Sign-in needed. A tab for this site is open in Chrome: sign in there, then click to retry.',
  blocked: 'The site asked to verify you\'re human. Finish it in the open tab, then click to retry.',
  'not-found': 'Couldn\'t find an interview page. Click to retry.',
  empty: 'The page had no questions. Click to retry.',
  timeout: 'Took too long. Click to retry.',
  error: 'Couldn\'t read the page. Click to retry.',
  cancelled: 'Cancelled. Click to retry.'
};

function sourceCard(g, company) {
  const s = siteInfo(g.name);
  const has = hasData(g);
  const pull = pulls[pullKey(company, g.name)];
  const busy = pull && pull.status === 'working';
  const stepText = busy && pull.step && pull.step !== 'starting' ? pull.step.charAt(0).toUpperCase() + pull.step.slice(1) + '…' : null;
  const statusLine = pull && STATUS_TEXT[pull.status]
    ? `<div class="sc-status ${pull.status}">${busy ? '<span class="spinner"></span>' : ''}${esc(stepText || STATUS_TEXT[pull.status])}</div>`
    : (pull && pull.status === 'done' && !pull.added ? '<div class="sc-status done">Up to date</div>' : '');
  const firstQ = g.questions[0] || (g.experiences[0] && (g.experiences[0].questions || [])[0]);
  const preview = firstQ ? `<div class="sc-preview">“${esc(firstQ.text)}”</div>` : '';
  return `
    <button class="source-card ${has ? '' : 'empty-card'} ${busy ? 'busy' : ''}" data-src="${esc(g.name)}" type="button">
      <div class="sc-head">
        <span class="mark" style="--c:${s.color}">${esc(s.mark)}</span>
        <span class="sc-name">${esc(g.name)}</span>
        <span class="sc-arrow">${busy ? '' : has ? '→' : '+'}</span>
      </div>
      ${s.host ? `<div class="sc-host">${esc(s.host)}</div>` : ''}
      ${has ? `
        <div class="sc-stats">
          <span><b>${g.experiences.length}</b> ${g.experiences.length === 1 ? 'experience' : 'experiences'}</span>
          <span><b>${g.questions.length}</b> ${g.questions.length === 1 ? 'question' : 'questions'}</span>
          <span><b>${g.answers}</b> ${g.answers === 1 ? 'answer' : 'answers'}</span>
          <span><b>${g.reviews.length}</b> ${g.reviews.length === 1 ? 'review' : 'reviews'}</span>
        </div>
        ${preview}
        ${statusLine}
        <div class="sc-foot">Pulled ${fmtDate(g.newest)} · ${plural(g.pages.size, 'page')}</div>`
      : `
        <div class="sc-stats muted">Nothing pulled yet</div>
        ${statusLine}
        <div class="sc-foot">${SITES[g.name] && !statusLine ? `Click to pull from ${esc(g.name)}` : ''}</div>`}
    </button>`;
}

// Sites Prepify only links to (never reads automatically).
function linkCards(name) {
  return Object.entries(SITES).filter(([, s]) => s.linkOnly).map(([label, s]) => `
    <a class="source-card link-card" href="${s.url(name)}" target="_blank" rel="noopener noreferrer">
      <div class="sc-head">
        <span class="mark" style="--c:${s.color}">${esc(s.mark)}</span>
        <span class="sc-name">${esc(label)}</span>
        <span class="sc-arrow">↗</span>
      </div>
      <div class="sc-host">${esc(s.host)}</div>
      <div class="sc-stats muted">Links only. ${esc(label)} doesn't allow automated reading.</div>
      <div class="sc-foot">Open posts about ${esc(name)} in a new tab</div>
    </a>`).join('');
}

// ---------- results dashboard + one full page per source ----------
const TABS = [
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

// ----- dashboard: the source boxes, plus what stands out across sources -----
function renderDashboard(d, groups) {
  const name = companyName(d);
  const withData = groups.filter(hasData);
  const anything = withData.length > 0;
  let html = `<div class="sources-head">
      <span>Results from <b>${withData.length}</b> of ${groups.length} sources <span class="hint">· Click a box to open its page</span></span>
      ${anything ? '<button class="btn small" data-pdf="">Download PDF</button>' : ''}
    </div>
    <div class="source-grid">${groups.map(g => sourceCard(g, name)).join('')}${linkCards(name)}</div>`;

  if (!anything) {
    html += `<div class="empty" style="margin-top:24px;">
      <h3>Nothing pulled for ${esc(name)} yet</h3>
      Click a box to pull that site into Prepify, or pull everything at once. Prepify reads the pages
      in the background using your own signed-in Chrome, so you stay on this page.
      <div><button class="btn primary" id="empty-research">Pull all sources for ${esc(name)}</button></div>
    </div>`;
    $('#report').innerHTML = html;
    $('#empty-research').onclick = () => pullSources(name);
  } else {
    html += glance(d, withData);
    $('#report').innerHTML = html;
    $$('#report [data-open-src]').forEach(b => b.onclick = () => openSource(b.dataset.openSrc));
  }
  wireCards(name);
  wirePdf();
}

// Cross-source highlights shown under the boxes.
function glance(d, withData) {
  const subjects = {};
  d.questions.forEach(q => { const s = subjectOf(q); subjects[s] = (subjects[s] || 0) + 1; });
  const sites = new Map();
  d.questions.forEach(q => {
    const k = norm(q.text);
    const e = sites.get(k) || { text: q.text, sites: new Set() };
    e.sites.add(q.source);
    sites.set(k, e);
  });
  const repeated = [...sites.values()].filter(e => e.sites.size > 1);

  let html = '<div class="glance">';
  html += `<section class="section">
      <h2>At a glance</h2>
      <div class="glance-grid">
        ${withData.map(g => `
          <button class="glance-card" data-open-src="${esc(g.name)}">
            <span class="mark" style="--c:${siteInfo(g.name).color}">${esc(siteInfo(g.name).mark)}</span>
            <span class="glance-name">${esc(g.name)}</span>
            <span class="glance-nums">${plural(g.experiences.length, 'experience')} · ${plural(g.questions.length, 'question')}${g.reviews.length ? ' · ' + plural(g.reviews.length, 'review') : ''}</span>
            <span class="glance-open">Open page →</span>
          </button>`).join('')}
      </div>
    </section>`;
  if (Object.keys(subjects).length) {
    html += `<section class="section">
        <h2>Subjects asked</h2>
        <p class="sub">Across all sources, worked out from each question's wording.</p>
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
  $$('.source-card[data-src]').forEach(card => card.onclick = () => {
    const src = card.dataset.src;
    if (card.classList.contains('busy')) return;
    const pull = pulls[pullKey(name, src)];
    const failed = pull && pull.status !== 'working' && pull.status !== 'done';
    if (card.classList.contains('empty-card') || failed) {
      if (SITES[src]) pullSources(name, [src]);
      return;
    }
    openSource(src);
  });
}

// re-render just the boxes (keeps scroll position)
function refreshBoxes() {
  if (!lastData || !signedIn()) return;
  const grid = $('#report .source-grid');
  if (!grid) return;
  const name = companyName(lastData);
  grid.innerHTML = groupBySource(lastData).map(g => sourceCard(g, name)).join('') + linkCards(name);
  wireCards(name);
}

// ----- one source's own page: breadcrumb, source switcher, header, tabs -----
function renderSourcePage(d, g, groups) {
  layoutEl().classList.add('wide');
  $('#panel').innerHTML = '';
  const name = companyName(d);
  const s = siteInfo(g.name);
  const counts = {
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
      <button class="btn small" data-back>← Back to results</button>
      <span class="crumb-path"><button class="linkbtn" data-back>${esc(name)}</button><span>›</span><b>${esc(g.name)}</b></span>
      <div class="switcher" role="tablist" aria-label="Sources">
        ${groups.filter(hasData).map(o => `
          <button class="switch ${o.name === g.name ? 'active' : ''}" data-switch="${esc(o.name)}" ${o.name === g.name ? 'aria-current="page"' : ''}>
            <span class="mark tiny" style="--c:${siteInfo(o.name).color}">${esc(siteInfo(o.name).mark)}</span>${esc(o.name)}
          </button>`).join('')}
      </div>
    </nav>

    <header class="source-hero">
      <span class="mark big" style="--c:${s.color}">${esc(s.mark)}</span>
      <div class="hero-text">
        <h1>${esc(g.name)} <span class="dim">· ${esc(name)}</span></h1>
        <div class="sub">${plural(counts.experiences, 'experience')} · ${plural(counts.questions, 'question')} · ${plural(g.answers, 'answer')}${counts.reviews ? ' · ' + plural(counts.reviews, 'review') : ''} · pulled ${fmtDate(g.newest)}</div>
      </div>
      <div class="head-actions">
        <button class="btn primary" data-pdf="${esc(g.name)}">Download PDF</button>
        ${SITES[g.name] && !SITES[g.name].linkOnly ? `<button class="btn" id="refresh-src" data-src="${esc(g.name)}">Pull again</button>` : ''}
        ${s.url ? `<a class="btn" href="${s.url(name)}" target="_blank" rel="noopener noreferrer">Open ${esc(g.name)} ↗</a>` : ''}
      </div>
    </header>

    <nav class="tabs" role="tablist">
      ${tabs.map(([k, label]) => `<button class="tab ${k === tab ? 'active' : ''}" role="tab" aria-selected="${k === tab}" data-tab="${k}">${label}<span>${counts[k]}</span></button>`).join('')}
    </nav>
    <div id="tab-body" role="tabpanel"></div>

    <div class="page-foot">
      <button class="btn" data-back>← Back to results</button>
      <button class="linkbtn" id="to-top">Back to top ↑</button>
    </div>`;

  const showTab = (k) => {
    $$('.tabs .tab').forEach(t => { t.classList.toggle('active', t.dataset.tab === k); t.setAttribute('aria-selected', t.dataset.tab === k); });
    history.replaceState({ q: d.query, src: g.name, tab: k }, '', urlFor(d.query, g.name, k));
    $('#tab-body').innerHTML = tabBody(k, g, groups);
    wireTab(k, name);
  };
  $$('.tabs .tab').forEach(t => t.onclick = () => showTab(t.dataset.tab));
  $$('[data-back]').forEach(b => b.onclick = () => { go(d.query, true); window.scrollTo(0, 0); });
  $$('[data-switch]').forEach(b => b.onclick = () => openSource(b.dataset.switch));
  $('#to-top').onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  const rb = $('#refresh-src');
  if (rb) rb.onclick = () => { pullSources(name, [rb.dataset.src]); rb.textContent = 'Pulling…'; rb.disabled = true; };
  showTab(tab);
  wirePdf();
}

function tabBody(k, g, groups) {
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
    groups.filter(o => o.name !== g.name).forEach(o => o.questions.forEach(q => elsewhere.set(norm(q.text), o.name)));
    const subjects = {};
    const qs = g.questions.map(q => { const subject = subjectOf(q); subjects[subject] = (subjects[subject] || 0) + 1; return { ...q, subject }; });
    return `
      <div class="qa-tools">
        <div class="chips">
          <button class="chip-btn active" data-subject="">All <span>${qs.length}</span></button>
          ${Object.entries(subjects).sort((a, b) => b[1] - a[1]).map(([c, n]) => `<button class="chip-btn" data-subject="${esc(c)}">${esc(c)} <span>${n}</span></button>`).join('')}
        </div>
        <input class="qa-filter" id="qa-filter" placeholder="Filter questions…" aria-label="Filter questions" />
      </div>
      <div class="qa-list">${qs.map((q, i) => qaCard(q, i, g.name, elsewhere.get(norm(q.text)))).join('')}</div>
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
        ${x.process ? `<details class="thread-post"><summary>Original post</summary><p>${esc(x.process)}</p></details>` : ''}
        <ul class="xp-discussion">${x.discussion.map(c => `<li><span class="score">▲ ${esc(c.score)}</span><p>${esc(c.text)}</p></li>`).join('')}</ul>
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
        const ok = (!subject || c.dataset.subject === subject) && (!f || c.dataset.text.includes(f));
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
  const para = (t) => t ? `<p>${esc(t)}</p>` : '';
  const rounds = (x.rounds || []).length
    ? `<ol class="xp-rounds">${x.rounds.map(r => `<li><b>${esc(r.name)}</b>${r.detail ? `<span>${esc(r.detail)}</span>` : ''}</li>`).join('')}</ol>` : '';
  const qs = (x.questions || []).length
    ? `<ol class="xp-questions">${x.questions.map(q => `<li><span>${esc(q.text)}</span>${(q.answers || []).map((a, j) =>
        `<div class="answer"><div class="a-label">Answer${q.answers.length > 1 ? ' ' + (j + 1) : ''}</div>${esc(a)}</div>`).join('')}</li>`).join('')}</ol>` : '';
  const preview = x.process || x.application || (x.rounds && x.rounds[0] && `${x.rounds[0].name}: ${x.rounds[0].detail}`) || '';
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
          `<ul class="xp-discussion">${x.discussion.map(c => `<li><span class="score">▲ ${esc(c.score)}</span><p>${esc(c.text)}</p></li>`).join('')}</ul>`) : ''}
        ${x.url ? `<div class="meta">Pulled ${fmtDate(x.created_at)} · <a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">Source page</a></div>` : ''}
      </div>
    </details>`;
}

function qaCard(q, i, site, alsoOn) {
  const answers = q.answers || [];
  const first = answers[0];
  const rest = answers.slice(1);
  return `
    <article class="qa-card" data-subject="${esc(q.subject)}" data-text="${esc(q.text.toLowerCase())}">
      <div class="qa-q"><span class="qnum">Q${i + 1}</span><span>${esc(q.text)}</span></div>
      <div class="qa-tags">
        <span class="tag">${esc(q.subject)}</span>
        ${q.round_type ? `<span class="tag">${esc(q.round_type)}</span>` : ''}
        ${q.difficulty ? `<span class="tag">${esc(q.difficulty)}</span>` : ''}
        ${alsoOn ? `<span class="tag good">Also on ${esc(alsoOn)}</span>` : ''}
      </div>
      ${first
        ? `<div class="answer"><div class="a-label">Answer${answers.length > 1 ? ' 1' : ''}</div>${esc(first)}</div>
           ${rest.length ? `
             <div class="more-answers hidden">${rest.map((a, j) =>
               `<div class="answer"><div class="a-label">Answer ${j + 2}</div>${esc(a)}</div>`).join('')}</div>
             <button class="linkbtn more-btn">Show ${plural(rest.length, 'more answer')}</button>` : ''}`
        : `<div class="answer none">No answer shown on ${esc(site)}</div>`}
    </article>`;
}

function reviewHtml(r) {
  return `
    <div class="result">
      <div class="title">${esc(r.title || r.job_title || 'Review')}${r.rating ? ` · ${r.rating}/5` : ''}</div>
      ${r.pros ? `<div class="pros"><b>Pros</b>${esc(r.pros)}</div>` : ''}
      ${r.cons ? `<div class="cons"><b>Cons</b>${esc(r.cons)}</div>` : ''}
      ${r.body ? `<div class="pros">${esc(r.body)}</div>` : ''}
      <div class="meta">${r.job_title ? esc(r.job_title) + ' · ' : ''}${r.review_date ? esc(r.review_date) + ' · ' : ''}Pulled ${fmtDate(r.created_at)}</div>
    </div>`;
}

// ---------- side panel (signed in) ----------
function renderPanel(name, d) {
  const ratings = d.reviews.map(r => r.rating).filter(Boolean);
  const avg = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) + ' / 5' : '–';
  const unique = new Set(d.questions.map(q => norm(q.text))).size;
  const anything = d.questions.length || d.reviews.length || d.experiences.length;
  $('#panel').innerHTML = `
    <div class="panel">
      <h3>${esc(name)}</h3>
      <div class="kind">Company</div>
      <div class="row"><span>Experiences</span><span>${(d.experiences || []).length}</span></div>
      <div class="row"><span>Questions</span><span>${unique}</span></div>
      <div class="row"><span>Reviews</span><span>${d.reviews.length}</span></div>
      <div class="row"><span>Average rating</span><span>${avg}</span></div>
      <div class="row"><span>Extension</span><span class="${hasExtension() ? 'ok' : 'off'}">${hasExtension() ? 'Connected' : 'Not detected'}</span></div>
      <button class="btn" id="panel-research">Pull all sources</button>
      ${anything ? '<button class="btn primary" data-pdf>Download PDF</button>' : ''}
      <button class="linkbtn" id="panel-clear">Clear this session's data</button>
      <p class="note">Pulled data lives only in this browser tab. Closing the tab or signing out erases it.</p>
    </div>`;
  $('#panel-research').onclick = () => pullSources(name);
  $('#panel-clear').onclick = () => { clearStore(); Object.keys(pulls).forEach(k => delete pulls[k]); rerender(); };
}

// ---------- PDF export (built in the browser; nothing is uploaded) ----------
const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
function loadJsPdf() {
  if (window.jspdf) return Promise.resolve(window.jspdf.jsPDF);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = JSPDF_URL;
    s.onload = () => resolve(window.jspdf.jsPDF);
    s.onerror = () => reject(new Error('Could not load the PDF library (are you offline?)'));
    document.head.appendChild(s);
  });
}

// jsPDF's built-in fonts cover Latin-1 only: swap smart punctuation, drop the rest.
const pdfText = (t) => String(t || '')
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
  .replace(/…/g, '...').replace(/•/g, '-').replace(/[→↗]/g, '->')
  .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');

function wirePdf() {
  $$('[data-pdf]').forEach(b => b.onclick = async () => {
    const label = b.textContent;
    b.disabled = true; b.textContent = 'Preparing PDF…';
    try { await downloadPdf(lastData, b.dataset.pdf || null); }
    catch (e) { alertInline(e.message); }
    finally { b.disabled = false; b.textContent = label; }
  });
}

function alertInline(msg) {
  const old = $('#pdf-error');
  if (old) old.remove();
  $('#report').insertAdjacentHTML('afterbegin', `<div class="notice" id="pdf-error"><b>PDF not created.</b> ${esc(msg)}</div>`);
}

async function downloadPdf(d, only = null) {
  const JsPDF = await loadJsPdf();
  const doc = new JsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 50;
  let y = M;

  const ensure = (h) => { if (y + h > H - M) { doc.addPage(); y = M; } };
  const write = (text, o = {}) => {
    const size = o.size || 10;
    doc.setFont('helvetica', o.bold ? 'bold' : (o.italic ? 'italic' : 'normal'));
    doc.setFontSize(size);
    doc.setTextColor(...(o.color || [30, 30, 30]));
    const lines = doc.splitTextToSize(pdfText(text), W - 2 * M - (o.indent || 0));
    lines.forEach(line => {
      ensure(size * 1.4);
      doc.text(line, M + (o.indent || 0), y + size);
      y += size * 1.4;
    });
    y += o.after === undefined ? 4 : o.after;
  };
  const rule = (color = [220, 220, 220]) => { ensure(10); doc.setDrawColor(...color); doc.line(M, y, W - M, y); y += 10; };

  const name = companyName(d);
  const groups = groupBySource(d).filter(hasData).filter(g => !only || g.name === only);
  const muted = [110, 110, 110];
  const accent = [196, 110, 50];

  write(`${name}: interview preparation`, { size: 20, bold: true, after: 6 });
  write(`Prepared with Prepify on ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}` +
        ` for "${d.query}"`, { size: 9, color: muted, after: 2 });
  write('Sources: ' + groups.map(g => `${g.name} (${plural(g.experiences.length, 'experience')}, ${plural(g.questions.length, 'question')})`).join(', '),
        { size: 9, color: muted, after: 14 });
  rule();

  groups.forEach((g, gi) => {
    if (gi > 0) { y += 10; }
    write(g.name, { size: 16, bold: true, color: accent, after: 8 });

    if (g.experiences.length) {
      write('Interview experiences', { size: 13, bold: true, after: 6 });
      [...g.experiences].sort(byDateDesc).forEach((x, i) => {
        ensure(40);
        const title = cleanRole(x.role) || `Interview experience ${i + 1}`;
        write(`${i + 1}. ${title}${x.date ? '  -  ' + x.date : ''}${x.location ? ', ' + x.location : ''}`, { size: 11, bold: true, after: 2 });
        const facts = [x.outcome, x.experience, x.difficulty].filter(Boolean).map(sentence).join(' | ');
        if (facts) write(facts, { size: 9, color: muted, indent: 14, after: 4 });
        if (x.application) write('How they applied: ' + x.application, { indent: 14 });
        if (x.process) write('Interview process: ' + x.process, { indent: 14 });
        (x.rounds || []).forEach(r => write(`${r.name}${r.detail ? ': ' + r.detail : ''}`, { indent: 14 }));
        if ((x.questions || []).length) {
          write('Questions asked:', { bold: true, indent: 14, after: 2 });
          x.questions.forEach((q, qi) => {
            write(`${qi + 1}. ${q.text}`, { indent: 24, after: 2 });
            (q.answers || []).forEach(a => write('Answer: ' + a, { indent: 36, color: muted, after: 2 }));
          });
          y += 2;
        }
        if (x.tips) write('Tips: ' + x.tips, { indent: 14 });
        if ((x.discussion || []).length) {
          write('Discussion (top comments):', { bold: true, indent: 14, after: 2 });
          x.discussion.slice(0, 3).forEach(c => write(`- ${c.text.slice(0, 600)}`, { indent: 24, color: muted, after: 3 }));
        }
        y += 6;
      });
    }

    if (g.questions.length) {
      ensure(40);
      write('Interview questions and answers', { size: 13, bold: true, after: 6 });
      const bySubject = {};
      g.questions.forEach(q => { const s = subjectOf(q); (bySubject[s] = bySubject[s] || []).push(q); });
      let num = 0;
      Object.entries(bySubject).sort((a, b) => b[1].length - a[1].length).forEach(([subject, list]) => {
        ensure(30);
        write(`${subject} (${list.length})`, { size: 11, bold: true, color: accent, after: 4 });
        list.forEach(q => {
          num += 1;
          write(`Q${num}. ${q.text}`, { bold: true, indent: 10, after: 2 });
          const answers = q.answers || [];
          if (answers.length) answers.forEach((a, ai) => write(`Answer${answers.length > 1 ? ' ' + (ai + 1) : ''}: ${a}`, { indent: 26, color: muted, after: 3 }));
          else write(`No answer shown on ${g.name}.`, { indent: 26, color: [160, 160, 160], italic: true, after: 3 });
          y += 3;
        });
      });
    }

    if (g.reviews.length) {
      ensure(40);
      write('Reviews', { size: 13, bold: true, after: 6 });
      g.reviews.forEach(r => {
        write(`${r.title || r.job_title || 'Review'}${r.rating ? ' (' + r.rating + '/5)' : ''}`, { bold: true, after: 2 });
        if (r.pros) write('Pros: ' + r.pros, { indent: 14, after: 2 });
        if (r.cons) write('Cons: ' + r.cons, { indent: 14, after: 2 });
        y += 4;
      });
    }

    write('Source pages: ' + [...g.pages.keys()].join(', '), { size: 8, color: muted, after: 8 });
    rule();
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(pdfText(`${name} - interview preparation`), M, H - 24);
    doc.text(`Page ${i} of ${pages}`, W - M, H - 24, { align: 'right' });
  }

  const file = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company';
  doc.save(`${file}${only ? '-' + only.toLowerCase() : ''}-interview-preparation.pdf`);
}

// ---------- wiring ----------
$('#home-form').onsubmit = (e) => { e.preventDefault(); go($('#home-q').value); };
$('#top-form').onsubmit = (e) => { e.preventDefault(); go($('#top-q').value); };
$('#logo-home').onclick = (e) => { e.preventDefault(); history.pushState({}, '', '/'); showHome(); };
$$('.example').forEach(c => c.onclick = () => { $('#home-q').value = c.textContent; go(c.textContent); });

$('#home-research-pill').onclick = () => $('#home-research').click();
$('#home-research').onclick = async () => {
  const q = $('#home-q').value.trim();
  if (!q) { $('#home-q').focus(); return; }
  await go(q);
  if (signedIn() && lastData && lastData.parsed.company) pullSources(companyName(lastData));
};

// "/" focuses the search box
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('#signin-modal').classList.add('hidden');
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
