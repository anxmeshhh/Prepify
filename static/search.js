// Prepify search page
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
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ---------- sources ----------
// The sites Prepify always shows a box for, plus how to open each one for a company.
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

function siteInfo(name) {
  return SITES[name] || { mark: (name || '?')[0].toUpperCase(), color: 'var(--purple)', host: '', url: null };
}

// ---------- pulling data into Prepify (via the Prepify Capture extension) ----------
// The extension opens the site in a background tab of your own signed-in Chrome, reads the
// interview page, saves it to Prepify and closes the tab. Progress comes back as messages.
const pulls = {};                       // `${company}|${site}` -> { status, step, added, detail }
const pullKey = (company, site) => `${company.toLowerCase()}|${site}`;
const hasExtension = () => !!document.documentElement.dataset.prepifyExt;

function pullSources(company, sites = Object.keys(SITES)) {
  if (!hasExtension()) { showExtensionNotice(); return; }
  sites.forEach(site => { pulls[pullKey(company, site)] = { status: 'working', step: 'starting' }; });
  window.postMessage({ source: 'prepify-page', type: 'research:start', company, sites }, location.origin);
  refreshBoxes();
}

function showExtensionNotice() {
  const el = $('#ext-notice');
  if (el) { el.classList.remove('hidden'); return; }
  $('#report').insertAdjacentHTML('afterbegin', `
    <div class="notice" id="ext-notice">
      <b>Prepify Capture extension not detected.</b> It pulls the data into Prepify using your own signed-in Chrome.
      Load it from <code>chrome://extensions</code> → developer mode → load unpacked → the <code>extension</code> folder,
      then reload this page.
    </div>`);
}

let refreshTimer = null;
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.source !== 'prepify-ext' || e.data.type !== 'research:update') return;
  const m = e.data;
  pulls[pullKey(m.company, m.site)] = { status: m.status, step: m.step, added: m.added, detail: m.detail };
  if (m.status === 'done') {
    // new data saved: re-run the search so boxes and the combined report include it
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { if (lastData) { const q = lastData.query; lastData = null; runSearch(q, currentSrc()); } }, 300);
  } else {
    refreshBoxes();
  }
});

function currentSrc() { return new URLSearchParams(location.search).get('src'); }

// re-render just the boxes (keeps scroll position and open sections)
function refreshBoxes() {
  if (!lastData || currentSrc()) return;
  const grid = $('#report .source-grid');
  if (!grid) return;
  grid.innerHTML = groupBySource(lastData).map(g => sourceCard(g, companyName(lastData))).join('');
  wireCards(companyName(lastData));
}

const companyName = (d) => d.company ? d.company.name : d.parsed.company;

// ---------- routing ----------
function showHome() {
  $('#home').classList.remove('hidden');
  $('#results').classList.add('hidden');
  document.title = 'Prepify';
  $('#home-q').focus();
}

function urlFor(q, src) {
  return '/?q=' + encodeURIComponent(q) + (src ? '&src=' + encodeURIComponent(src) : '');
}

function go(q, push = true, src = null) {
  q = q.trim();
  if (!q) return;
  if (push) history.pushState({ q, src }, '', urlFor(q, src));
  runSearch(q, src);
}

window.addEventListener('popstate', () => {
  const params = new URLSearchParams(location.search);
  const q = params.get('q');
  q ? go(q, false, params.get('src')) : showHome();
});

// ---------- search ----------
let lastData = null;

async function runSearch(q, src) {
  $('#home').classList.add('hidden');
  $('#results').classList.remove('hidden');
  $('#top-q').value = q;
  document.title = q + ' - Prepify';
  try {
    if (!lastData || lastData.query !== q) {
      $('#understood').textContent = 'searching…';
      $('#report').innerHTML = '';
      $('#panel').innerHTML = '';
      lastData = await getJson('/api/search?q=' + encodeURIComponent(q));
    }
    src ? renderSource(lastData, src) : render(lastData);
    window.scrollTo(0, 0);
  } catch (e) {
    $('#understood').textContent = '';
    $('#report').innerHTML = `<div class="empty"><h3>search failed</h3>${esc(e.message)}</div>`;
  }
}

// Groups everything saved for the company by the site it came from.
function groupBySource(d) {
  const groups = new Map();
  Object.keys(SITES).forEach(s => groups.set(s, { name: s, questions: [], reviews: [], pages: new Map() }));
  const add = (x, kind) => {
    const s = x.source || 'Manual entry';
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

function understoodLine(p) {
  $('#understood').innerHTML = p.company
    ? `<span class="k">company:</span> <b>${esc(p.company)}</b> &nbsp; <span class="k">role:</span> <b>${esc(p.role || 'any')}</b> &nbsp; <span class="k">looking for:</span> <b>${esc(p.intents.join(', '))}</b>`
    : '';
}

// ---------- results: source boxes + combined summary ----------
function render(d) {
  const p = d.parsed;
  understoodLine(p);
  $('#filters').classList.remove('hidden');
  setFilter('all');

  if (!p.company) {
    $('#panel').innerHTML = '';
    $('#report').innerHTML = `<div class="empty"><h3>which company do you mean?</h3>
      try naming it, for example <i>Infosys interview questions</i> or <i>Accenture ASE interview process</i>.</div>`;
    return;
  }

  const name = d.company ? d.company.name : p.company;
  const groups = groupBySource(d);
  renderPanel(name, d);

  // --- source boxes ---
  const withData = groups.filter(g => g.questions.length || g.reviews.length).length;
  let html = `<div class="sources-head">
      <span>results from <b>${withData}</b> of ${groups.length} sources</span>
      <span class="hint">click a box to see everything from that site</span>
    </div>
    <div class="source-grid">${groups.map(g => sourceCard(g, name)).join('')}</div>`;

  if (!d.questions.length && !d.reviews.length) {
    html += `<div class="empty" style="margin-top:24px;">
      <h3>nothing saved for ${esc(name)} yet</h3>
      click a box to pull that site into Prepify, or pull everything at once. Prepify reads the pages
      in the background using your own signed-in Chrome, so you stay on this page.
      <div><button class="btn primary" id="empty-research">pull all sources for ${esc(name)}</button></div>
    </div>`;
    $('#report').innerHTML = html;
    $('#empty-research').onclick = () => pullSources(name);
    wireCards(name);
    return;
  }

  html += combinedReport(d, groups);
  $('#report').innerHTML = html;
  wireCards(name);
}

const STATUS_TEXT = {
  working: 'reading in the background…',
  login: 'sign in to this site in Chrome, then click to retry',
  'not-found': 'couldn\'t find an interview page · click to retry',
  empty: 'page had no questions · click to retry',
  timeout: 'took too long · click to retry',
  error: 'couldn\'t save · click to retry',
  cancelled: 'cancelled · click to retry'
};

function sourceCard(g, company) {
  const s = siteInfo(g.name);
  const has = g.questions.length || g.reviews.length;
  const pull = company ? pulls[pullKey(company, g.name)] : null;
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
        <div class="sc-foot">${plural(g.pages.size, 'page')} · saved ${fmtDate(g.newest)}</div>`
      : `
        <div class="sc-stats muted">nothing pulled yet</div>
        ${statusLine}
        <div class="sc-foot">${SITES[g.name] && !statusLine ? `click to pull from ${esc(g.name)}` : ''}</div>`}
    </button>`;
}

function wireCards(name) {
  $$('.source-card').forEach(card => card.onclick = () => {
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

function combinedReport(d, groups) {
  const p = d.parsed;
  // merge the same question across sites and count how many sites/reports carry it
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
  questions.forEach(q => { const r = q.round_type || 'Unspecified'; rounds[r] = (rounds[r] || 0) + 1; });
  html += sec('questions', 'interview rounds', 'rounds that the saved questions came from',
    `<div class="rounds">${Object.entries(rounds).sort((a, b) => b[1] - a[1])
      .map(([r, c]) => `<div class="round"><b>${esc(r)}</b><span>${plural(c, 'question')}</span></div>`).join('')}</div>`);

  const roleNote = p.role && d.role_matched === false
    ? `no questions saved for the ${esc(p.role)} role yet, so all roles are shown · ` : '';
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
              ${[...q.sites].map(s => esc(s)).join(' + ')} · saved ${fmtDate(q.created_at)}
            </div>
          </div>`).join('')}
      </details>`).join(''));

  return html;
}

// ---------- one source: everything saved from that site ----------
function renderSource(d, src) {
  understoodLine(d.parsed);
  $('#filters').classList.add('hidden');
  const name = d.company ? d.company.name : d.parsed.company;
  renderPanel(name, d);
  const g = groupBySource(d).find(x => x.name === src);
  const s = siteInfo(src);

  if (!g || (!g.questions.length && !g.reviews.length)) {
    $('#report').innerHTML = `<button class="back" id="back">← all sources</button>
      <div class="empty"><h3>nothing saved from ${esc(src)} yet</h3></div>`;
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
        <div class="sub">${plural(g.questions.length, 'question')} · ${plural(g.answers, 'answer')} · ${plural(g.reviews.length, 'review')} · ${plural(g.pages.size, 'page')} saved</div>
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
              : `<div class="answer none">no answers were shown on the saved page</div>`}
            <div class="meta">${esc(q.role_title || '')} · saved ${fmtDate(q.created_at)}${q.url ? ` · <a href="${esc(q.url)}" target="_blank" rel="noopener noreferrer">open on ${esc(src)}</a>` : ''}</div>
          </div>
        </details>`;
      }).join(''));
  }

  if (g.reviews.length) {
    html += sec('reviews', '',
      g.reviews.map(r => `
        <div class="result">
          <div class="title">${esc(r.title || r.job_title || 'Review')}${r.rating ? ` · ${r.rating}/5` : ''}</div>
          ${r.pros ? `<div class="pros"><b>pros</b>${esc(r.pros)}</div>` : ''}
          ${r.cons ? `<div class="cons"><b>cons</b>${esc(r.cons)}</div>` : ''}
          ${r.body ? `<div class="pros">${esc(r.body)}</div>` : ''}
          <div class="meta">${r.job_title ? esc(r.job_title) + ' · ' : ''}${r.review_date ? esc(r.review_date) + ' · ' : ''}saved ${fmtDate(r.created_at)}</div>
        </div>`).join(''));
  }

  html += sec('pages saved', 'every item above links back to one of these pages',
    [...g.pages.values()].map(pg => `
      <div class="result">
        <div class="title"><a href="${esc(pg.url)}" target="_blank" rel="noopener noreferrer">${esc(pg.url)}</a></div>
        <div class="meta">${plural(pg.items, 'item')} · saved ${fmtDate(pg.saved)}</div>
      </div>`).join(''));

  $('#report').innerHTML = html;
  $('#back').onclick = () => go(d.query, true);
  const rb = $('#refresh-src');
  if (rb) rb.onclick = () => { pullSources(name, [src]); rb.textContent = 'pulling…'; rb.disabled = true; };
}

// ---------- side panel ----------
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
      <p class="note">reads Glassdoor and AmbitionBox in the background with your own signed-in Chrome · results appear here</p>
    </div>`;
  $('#panel-research').onclick = () => pullSources(name);
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
  history.pushState({ q }, '', urlFor(q));
  await runSearch(q, null);
  if (lastData && lastData.parsed.company) pullSources(companyName(lastData));
};

// "/" focuses the search box, like a terminal command palette
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  e.preventDefault();
  const box = $('#results').classList.contains('hidden') ? $('#home-q') : $('#top-q');
  box.focus(); box.select();
});

// initial load
const params = new URLSearchParams(location.search);
params.get('q') ? go(params.get('q'), false, params.get('src')) : showHome();
