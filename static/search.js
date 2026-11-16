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
  return isNaN(d) ? esc(iso) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
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
const SITES = {
  Glassdoor: {
    mark: 'G', color: 'var(--good)', host: 'glassdoor.co.in',
    url: (n) => `https://www.glassdoor.co.in/Search/results.htm?keyword=${encodeURIComponent(n)}`
  },
  AmbitionBox: {
    mark: 'A', color: 'var(--link)', host: 'ambitionbox.com',
    url: (n) => `https://www.ambitionbox.com/search?q=${encodeURIComponent(n)}`
  }
};
const GOOGLE = {
  mark: 'g', color: 'var(--purple)', host: 'google.com',
  url: (n) => `https://www.google.com/search?q=${encodeURIComponent(n + ' interview questions experience')}`
};
const siteInfo = (name) => SITES[name] || { mark: (name || '?')[0].toUpperCase(), color: 'var(--purple)', host: '', url: null };

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

// Adds what the extension captured; the same question is kept once per site, answers merged.
function addCapture(payload, fallbackCompany) {
  const name = (payload.company_name || fallbackCompany || '').trim();
  if (!name) return 0;
  const key = name.toLowerCase();
  const c = store.companies[key] || (store.companies[key] = { name, questions: [], reviews: [] });
  const src = payload.source || 'Unknown';
  const now = new Date().toISOString();
  let added = 0;

  (payload.questions || []).forEach(it => {
    const text = (it.text || '').trim();
    if (!text) return;
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

  saveStore();
  return added;
}

// ---------- auth (optional Google sign-in) ----------
const auth = { clientId: null, user: null, ready: false };
const signedIn = () => !!auth.user;

async function loadAuth() {
  try {
    const r = await getJson('/api/auth/config');
    auth.clientId = r.google_client_id;
    auth.user = r.user;
  } catch (e) { /* server offline: stay guest */ }
  auth.ready = true;
  renderAuth();
}

function renderAuth() {
  $$('[data-auth]').forEach(el => {
    el.innerHTML = auth.user
      ? `<span class="user" title="${esc(auth.user.email)}">${esc(auth.user.name)}</span><button class="linkbtn" data-signout>sign out</button>`
      : `<span class="guest-tag">guest</span><button class="btn small" data-signin>sign in</button>`;
  });
  $$('[data-signin]').forEach(b => b.onclick = openSignin);
  $$('[data-signout]').forEach(b => b.onclick = signOut);
  $('#mode-line').innerHTML = auth.user
    ? `signed in as <b>${esc(auth.user.name)}</b> · pulled data stays in this tab only and is gone when you close it`
    : `guest mode: links only · <button class="linkbtn accent" data-signin>sign in with Google</button> to pull questions, answers and reviews into Prepify`;
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

function pullSources(company, sites = Object.keys(SITES)) {
  if (!signedIn()) { openSignin(); return; }
  if (!hasExtension()) { showExtensionNotice(); return; }
  sites.forEach(site => { pulls[pullKey(company, site)] = { status: 'working', step: 'starting' }; });
  window.postMessage({ source: 'prepify-page', type: 'research:start', company, sites }, location.origin);
  refreshBoxes();
}

function showExtensionNotice() {
  if ($('#ext-notice')) return;
  $('#report').insertAdjacentHTML('afterbegin', `
    <div class="notice" id="ext-notice">
      <b>Prepify Capture extension not detected.</b> It reads the sites with your own signed-in Chrome.
      Load it from <code>chrome://extensions</code> → developer mode → load unpacked → the <code>extension</code> folder,
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

const urlFor = (q, src) => '/?q=' + encodeURIComponent(q) + (src ? '&src=' + encodeURIComponent(src) : '');
const currentSrc = () => new URLSearchParams(location.search).get('src');

function go(q, push = true, src = null) {
  q = q.trim();
  if (!q) return;
  if (push) history.pushState({ q, src }, '', urlFor(q, src));
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
           questions, reviews: entry ? entry.reviews : [], role_matched: roleMatched };
}

async function runSearch(q, src) {
  $('#home').classList.add('hidden');
  $('#results').classList.remove('hidden');
  $('#top-q').value = q;
  document.title = q + ' - Prepify';
  try {
    if (!lastParsed || lastParsed.query !== q) {
      $('#understood').textContent = 'searching…';
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
    $('#report').innerHTML = `<div class="empty"><h3>search failed</h3>${esc(e.message)}</div>`;
  }
}

function rerender(src = currentSrc()) {
  if (!lastParsed || $('#results').classList.contains('hidden')) return;
  lastData = buildData();
  if (!signedIn()) return renderGuest(lastData);
  src ? renderSource(lastData, src) : render(lastData);
}

const companyName = (d) => d.company ? d.company.name : d.parsed.company;

function understoodLine(p) {
  $('#understood').innerHTML = p.company
    ? `<span class="k">company:</span> <b>${esc(p.company)}</b> &nbsp; <span class="k">role:</span> <b>${esc(p.role || 'any')}</b> &nbsp; <span class="k">looking for:</span> <b>${esc(p.intents.join(', '))}</b>`
    : '';
}

function noCompany() {
  $('#panel').innerHTML = '';
  $('#report').innerHTML = `<div class="empty"><h3>which company do you mean?</h3>
    try naming it, for example <i>Infosys interview questions</i> or <i>Accenture ASE interview process</i>.</div>`;
}

// ---------- guest view: links only ----------
function renderGuest(d) {
  understoodLine(d.parsed);
  $('#filters').classList.add('hidden');
  if (!d.parsed.company) return noCompany();
  const name = companyName(d);
  const links = [['Glassdoor', SITES.Glassdoor], ['AmbitionBox', SITES.AmbitionBox], ['Google', GOOGLE]];
  $('#report').innerHTML = `
    <div class="notice guest">
      <b>you're browsing as a guest.</b> Guests get links to the sources only. Sign in with Google to pull
      questions, answers and reviews from Glassdoor and AmbitionBox straight into Prepify. Pulled data stays
      in your browser tab and is never stored on a server.
      <div><button class="btn primary" data-signin>sign in with Google</button></div>
    </div>
    <div class="sources-head"><span>sources for <b>${esc(name)}</b></span><span class="hint">opens the site in a new tab</span></div>
    <div class="source-grid">${links.map(([label, s]) => `
      <a class="source-card link-card" href="${s.url(name)}" target="_blank" rel="noopener noreferrer">
        <div class="sc-head">
          <span class="mark" style="--c:${s.color}">${esc(s.mark)}</span>
          <span class="sc-name">${esc(label)}</span>
          <span class="sc-arrow">↗</span>
        </div>
        <div class="sc-host">${esc(s.host)}</div>
        <div class="sc-stats muted">${label === 'Google' ? 'web results for interview experiences' : `${esc(name)} on ${esc(label)}`}</div>
        <div class="sc-foot">open in a new tab</div>
      </a>`).join('')}
    </div>`;
  $$('#report [data-signin]').forEach(b => b.onclick = openSignin);
  $('#panel').innerHTML = `
    <div class="panel">
      <h3>${esc(name)}</h3>
      <div class="kind">company</div>
      <div class="row"><span>mode</span><span class="off">guest · links only</span></div>
      <button class="btn" data-signin>sign in to pull sources</button>
      <p class="note">signed in, Prepify reads Glassdoor and AmbitionBox in the background with your own Chrome and shows everything here</p>
    </div>`;
  $$('#panel [data-signin]').forEach(b => b.onclick = openSignin);
}

// ---------- signed-in results: source boxes + combined summary ----------
function groupBySource(d) {
  const groups = new Map();
  Object.keys(SITES).forEach(s => groups.set(s, { name: s, questions: [], reviews: [], pages: new Map() }));
  const add = (x, kind) => {
    const s = x.source || 'Unknown';
    if (!groups.has(s)) groups.set(s, { name: s, questions: [], reviews: [], pages: new Map() });
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
  groups.forEach(g => {
    g.answers = g.questions.reduce((n, q) => n + (q.answers || []).length, 0);
    g.newest = [...g.questions, ...g.reviews].map(x => x.created_at).sort().at(-1);
  });
  return [...groups.values()];
}

function render(d) {
  const p = d.parsed;
  understoodLine(p);
  $('#filters').classList.remove('hidden');
  if (!p.company) return noCompany();

  const name = companyName(d);
  const groups = groupBySource(d);
  renderPanel(name, d);

  const withData = groups.filter(g => g.questions.length || g.reviews.length).length;
  let html = `<div class="sources-head">
      <span>results from <b>${withData}</b> of ${groups.length} sources</span>
      <span class="hint">click a box to see everything from that site</span>
    </div>
    <div class="source-grid">${groups.map(g => sourceCard(g, name)).join('')}</div>`;

  if (!d.questions.length && !d.reviews.length) {
    html += `<div class="empty" style="margin-top:24px;">
      <h3>nothing pulled for ${esc(name)} yet</h3>
      click a box to pull that site into Prepify, or pull everything at once. Prepify reads the pages
      in the background using your own signed-in Chrome, so you stay on this page.
      <div><button class="btn primary" id="empty-research">pull all sources for ${esc(name)}</button></div>
    </div>`;
    $('#report').innerHTML = html;
    $('#empty-research').onclick = () => pullSources(name);
  } else {
    $('#report').innerHTML = html + combinedReport(d);
  }
  wireCards(name);
  setFilter('all');
}

const STATUS_TEXT = {
  working: 'reading in the background…',
  login: 'sign in to this site in Chrome, then click to retry',
  'not-found': 'couldn\'t find an interview page · click to retry',
  empty: 'page had no questions · click to retry',
  timeout: 'took too long · click to retry',
  error: 'couldn\'t read the page · click to retry',
  cancelled: 'cancelled · click to retry'
};

function sourceCard(g, company) {
  const s = siteInfo(g.name);
  const has = g.questions.length || g.reviews.length;
  const pull = pulls[pullKey(company, g.name)];
  const busy = pull && pull.status === 'working';
  const statusLine = pull && STATUS_TEXT[pull.status]
    ? `<div class="sc-status ${pull.status}">${busy ? '<span class="spinner"></span>' : ''}${esc(busy && pull.step && pull.step !== 'starting' ? pull.step + '…' : STATUS_TEXT[pull.status])}</div>`
    : (pull && pull.status === 'done' && !pull.added ? '<div class="sc-status done">up to date</div>' : '');
  const preview = g.questions[0] ? `<div class="sc-preview">“${esc(g.questions[0].text)}”</div>` : '';
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
          <span><b>${g.questions.length}</b> questions</span>
          <span><b>${g.answers}</b> answers</span>
          <span><b>${g.reviews.length}</b> reviews</span>
        </div>
        ${preview}
        ${statusLine}
        <div class="sc-foot">${plural(g.pages.size, 'page')} · pulled ${fmtDate(g.newest)}</div>`
      : `
        <div class="sc-stats muted">nothing pulled yet</div>
        ${statusLine}
        <div class="sc-foot">${SITES[g.name] && !statusLine ? `click to pull from ${esc(g.name)}` : ''}</div>`}
    </button>`;
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
    go(lastData.query, true, src);
  });
}

// re-render just the boxes (keeps scroll position and open sections)
function refreshBoxes() {
  if (!lastData || currentSrc() || !signedIn()) return;
  const grid = $('#report .source-grid');
  if (!grid) return;
  const name = companyName(lastData);
  grid.innerHTML = groupBySource(lastData).map(g => sourceCard(g, name)).join('');
  wireCards(name);
}

function combinedReport(d) {
  const p = d.parsed;
  const seen = new Map();
  d.questions.forEach(q => {
    const key = norm(q.text);
    if (!seen.has(key)) seen.set(key, { ...q, reports: 1, sites: new Set([q.source]) });
    else { const m = seen.get(key); m.reports += 1; m.sites.add(q.source); }
  });
  const questions = [...seen.values()];

  let n = 0;
  const sec = (kind, title, sub, body) =>
    `<section class="section" data-kind="${kind}"><h2><span class="num">${String(++n).padStart(2, '0')}</span>${title}</h2>${sub ? `<p class="sub">${sub}</p>` : ''}${body}</section>`;

  let html = '<div class="combined-head">all sources combined</div>';

  const rounds = {};
  questions.forEach(q => { const r = q.round_type || 'unspecified'; rounds[r] = (rounds[r] || 0) + 1; });
  html += sec('questions', 'interview rounds', 'rounds that the pulled questions came from',
    `<div class="rounds">${Object.entries(rounds).sort((a, b) => b[1] - a[1])
      .map(([r, c]) => `<div class="round"><b>${esc(r)}</b><span>${plural(c, 'question')}</span></div>`).join('')}</div>`);

  const roleNote = p.role && d.role_matched === false
    ? `no questions pulled for the ${esc(p.role)} role yet, so all roles are shown · ` : '';
  const cats = {};
  questions.forEach(q => { const c = q.category || 'Other'; (cats[c] = cats[c] || []).push(q); });
  html += sec('questions', 'most reported questions', roleNote + 'merged across sites · open a source box for the answers',
    Object.entries(cats).sort((a, b) => b[1].length - a[1].length).map(([c, list], i) => `
      <details class="group" ${i === 0 ? 'open' : ''}>
        <summary>${esc(c)}<span class="count">${list.length}</span></summary>
        ${list.sort((a, b) => b.reports - a.reports).map(q => `
          <div class="q">
            <div class="text">${esc(q.text)}</div>
            <div class="meta">
              ${q.reports > 1 ? `<span class="tag good">reported ${q.reports}×</span>` : ''}
              ${q.difficulty ? `<span class="tag">${esc(q.difficulty)}</span>` : ''}
              ${[...q.sites].map(s => esc(s)).join(' + ')} · pulled ${fmtDate(q.created_at)}
            </div>
          </div>`).join('')}
      </details>`).join(''));

  if (d.reviews.length) {
    html += sec('reviews', 'candidate and employee experience', plural(d.reviews.length, 'review') + ' across sources',
      d.reviews.map(r => reviewHtml(r, true)).join(''));
  }
  return html;
}

function reviewHtml(r, showSource) {
  return `
    <div class="result">
      <div class="title">${esc(r.title || r.job_title || 'Review')}${r.rating ? ` · ${r.rating}/5` : ''}</div>
      ${r.pros ? `<div class="pros"><b>pros</b>${esc(r.pros)}</div>` : ''}
      ${r.cons ? `<div class="cons"><b>cons</b>${esc(r.cons)}</div>` : ''}
      ${r.body ? `<div class="pros">${esc(r.body)}</div>` : ''}
      <div class="meta">${showSource ? esc(r.source) + ' · ' : ''}${r.job_title ? esc(r.job_title) + ' · ' : ''}${r.review_date ? esc(r.review_date) + ' · ' : ''}pulled ${fmtDate(r.created_at)}</div>
    </div>`;
}

// ---------- one source: everything pulled from that site ----------
function renderSource(d, src) {
  understoodLine(d.parsed);
  $('#filters').classList.add('hidden');
  const name = companyName(d);
  renderPanel(name, d);
  const g = groupBySource(d).find(x => x.name === src);
  const s = siteInfo(src);

  if (!g || (!g.questions.length && !g.reviews.length)) {
    $('#report').innerHTML = `<button class="back" id="back">← all sources</button>
      <div class="empty"><h3>nothing pulled from ${esc(src)} yet</h3></div>`;
    $('#back').onclick = () => go(d.query, true);
    return;
  }

  let n = 0;
  const sec = (title, sub, body) =>
    `<section class="section"><h2><span class="num">${String(++n).padStart(2, '0')}</span>${title}</h2>${sub ? `<p class="sub">${sub}</p>` : ''}${body}</section>`;

  let html = `<button class="back" id="back">← all sources</button>
    <div class="source-title">
      <span class="mark big" style="--c:${s.color}">${esc(s.mark)}</span>
      <div>
        <h1>${esc(src)} <span class="dim">· ${esc(name)}</span></h1>
        <div class="sub">${plural(g.questions.length, 'question')} · ${plural(g.answers, 'answer')} · ${plural(g.reviews.length, 'review')} · ${plural(g.pages.size, 'page')}</div>
      </div>
      ${SITES[src] ? `<button class="btn" id="refresh-src">pull again</button>` : ''}
    </div>`;

  if (g.questions.length) {
    html += sec('interview questions and answers', 'click a question to see the answers shown on ' + esc(src),
      g.questions.map((q, i) => {
        const answers = q.answers || [];
        return `
        <details class="qa" ${i === 0 && answers.length ? 'open' : ''}>
          <summary>
            <span class="qa-text">${esc(q.text)}</span>
            <span class="qa-meta">
              ${q.round_type ? `<span class="tag">${esc(q.round_type)}</span>` : ''}
              ${q.difficulty ? `<span class="tag">${esc(q.difficulty)}</span>` : ''}
              <span class="tag ${answers.length ? 'good' : ''}">${plural(answers.length, 'answer')}</span>
            </span>
          </summary>
          <div class="answers">
            ${answers.length
              ? answers.map((a, j) => `<div class="answer"><div class="a-label">answer ${j + 1}</div>${esc(a)}</div>`).join('')
              : `<div class="answer none">no answers were shown on the page</div>`}
            <div class="meta">${esc(q.role_title || '')} · pulled ${fmtDate(q.created_at)}${q.url ? ` · <a href="${esc(q.url)}" target="_blank" rel="noopener noreferrer">source page</a>` : ''}</div>
          </div>
        </details>`;
      }).join(''));
  }

  if (g.reviews.length) {
    html += sec('reviews', '', g.reviews.map(r => reviewHtml(r, false)).join(''));
  }

  html += sec('source pages', 'every item above came from one of these pages',
    [...g.pages.values()].map(pg => `
      <div class="result">
        <div class="title"><a href="${esc(pg.url)}" target="_blank" rel="noopener noreferrer">${esc(pg.url)}</a></div>
        <div class="meta">${plural(pg.items, 'item')} · pulled ${fmtDate(pg.saved)}</div>
      </div>`).join(''));

  $('#report').innerHTML = html;
  $('#back').onclick = () => go(d.query, true);
  const rb = $('#refresh-src');
  if (rb) rb.onclick = () => { pullSources(name, [src]); rb.textContent = 'pulling…'; rb.disabled = true; };
}

// ---------- side panel (signed in) ----------
function renderPanel(name, d) {
  const ratings = d.reviews.map(r => r.rating).filter(Boolean);
  const avg = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) + ' / 5' : '–';
  const unique = new Set(d.questions.map(q => norm(q.text))).size;
  $('#panel').innerHTML = `
    <div class="panel">
      <h3>${esc(name)}</h3>
      <div class="kind">company</div>
      <div class="row"><span>questions</span><span>${unique}</span></div>
      <div class="row"><span>reviews</span><span>${d.reviews.length}</span></div>
      <div class="row"><span>avg rating</span><span>${avg}</span></div>
      <div class="row"><span>extension</span><span class="${hasExtension() ? 'ok' : 'off'}">${hasExtension() ? 'connected' : 'not detected'}</span></div>
      <button class="btn" id="panel-research">pull all sources</button>
      <button class="linkbtn" id="panel-clear">clear this session's data</button>
      <p class="note">pulled data lives only in this browser tab · closing the tab or signing out erases it</p>
    </div>`;
  $('#panel-research').onclick = () => pullSources(name);
  $('#panel-clear').onclick = () => { clearStore(); Object.keys(pulls).forEach(k => delete pulls[k]); rerender(); };
}

function setFilter(f) {
  $$('.filter').forEach(b => b.classList.toggle('active', b.dataset.filter === f));
  $$('#report .section').forEach(s => s.classList.toggle('hidden', f !== 'all' && s.dataset.kind !== f));
  $$('#report .source-grid, #report .sources-head').forEach(el =>
    el.classList.toggle('hidden', f !== 'all' && f !== 'sources'));
}

// ---------- wiring ----------
$('#home-form').onsubmit = (e) => { e.preventDefault(); go($('#home-q').value); };
$('#top-form').onsubmit = (e) => { e.preventDefault(); go($('#top-q').value); };
$('#logo-home').onclick = (e) => { e.preventDefault(); history.pushState({}, '', '/'); showHome(); };
$$('.example').forEach(c => c.onclick = () => { $('#home-q').value = c.textContent; go(c.textContent); });
$$('.filter').forEach(b => b.onclick = () => setFilter(b.dataset.filter));

$('#home-research-pill').onclick = () => $('#home-research').click();
$('#home-research').onclick = async () => {
  const q = $('#home-q').value.trim();
  if (!q) { $('#home-q').focus(); return; }
  await go(q);
  if (signedIn() && lastData && lastData.parsed.company) pullSources(companyName(lastData));
};

// "/" focuses the search box, like a terminal command palette
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
