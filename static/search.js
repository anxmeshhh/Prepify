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

async function getJson(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function sourceLinks(name) {
  const q = encodeURIComponent(name);
  return [
    { label: 'Glassdoor', url: `https://www.glassdoor.co.in/Search/results.htm?keyword=${q}` },
    { label: 'AmbitionBox', url: `https://www.ambitionbox.com/search?q=${q}` },
    { label: 'Google', url: `https://www.google.com/search?q=${encodeURIComponent(name + ' interview questions experience')}` }
  ];
}

// Opens the source sites for a company and makes it the capture target for the extension.
// Tabs must be opened synchronously inside the click, so pass pre-opened windows when the name isn't known yet.
async function researchSources(name, wins) {
  const links = sourceLinks(name);
  if (wins) links.forEach((l, i) => { if (wins[i]) wins[i].location = l.url; });
  else links.forEach(l => window.open(l.url, '_blank', 'noopener'));
  await getJson('/api/active', { method: 'POST', body: JSON.stringify({ name }) });
}

// ---------- routing ----------
function showHome() {
  $('#home').classList.remove('hidden');
  $('#results').classList.add('hidden');
  document.title = 'Prepify';
  $('#home-q').focus();
}

function go(q, push = true) {
  q = q.trim();
  if (!q) return;
  if (push) history.pushState({ q }, '', '/?q=' + encodeURIComponent(q));
  runSearch(q);
}

window.addEventListener('popstate', () => {
  const q = new URLSearchParams(location.search).get('q');
  q ? go(q, false) : showHome();
});

// ---------- search + render ----------
let lastData = null;

async function runSearch(q) {
  $('#home').classList.add('hidden');
  $('#results').classList.remove('hidden');
  $('#top-q').value = q;
  document.title = q + ' - Prepify';
  $('#understood').textContent = 'Searching…';
  $('#report').innerHTML = '';
  $('#panel').innerHTML = '';
  setFilter('all');
  try {
    lastData = await getJson('/api/search?q=' + encodeURIComponent(q));
    render(lastData);
  } catch (e) {
    $('#understood').textContent = '';
    $('#report').innerHTML = `<div class="empty"><h3>Search failed</h3>${esc(e.message)}</div>`;
  }
}

function render(d) {
  const p = d.parsed;
  const wants = p.intents.join(', ');
  $('#understood').innerHTML = p.company
    ? `Company <b>${esc(p.company)}</b> · Role <b>${esc(p.role || 'any')}</b> · Looking for <b>${esc(wants)}</b>`
    : '';

  if (!p.company) {
    $('#report').innerHTML = `<div class="empty"><h3>Which company do you mean?</h3>
      Try naming it, for example <i>Infosys interview questions</i> or <i>Accenture Associate Software Engineer interview process</i>.</div>`;
    return;
  }

  const name = d.company ? d.company.name : p.company;
  const uniqueQuestions = new Set(d.questions.map(q => q.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())).size;
  renderPanel(name, d, uniqueQuestions);

  if (!d.questions.length && !d.reviews.length) {
    $('#report').innerHTML = `<div class="empty">
      <h3>Nothing saved for ${esc(name)} yet</h3>
      Prepify only shows interview reports it has evidence for. Open the sources, sign in, and click
      <b>Save to Prepify</b> on any interview or review page. The results will appear here.
      <div><button class="btn primary" id="empty-research">Research sources for ${esc(name)}</button></div>
    </div>`;
    $('#empty-research').onclick = () => researchSources(name);
    return;
  }

  // de-duplicate questions by normalised text
  const seen = new Map();
  d.questions.forEach(q => {
    const key = q.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!seen.has(key)) seen.set(key, { ...q, reports: 1 });
    else seen.get(key).reports += 1;
  });
  const questions = [...seen.values()];

  const sources = new Map();
  [...d.questions, ...d.reviews].forEach(x => {
    const k = x.url || x.source || 'Manual entry';
    const s = sources.get(k) || { url: x.url, source: x.source || 'Manual entry', items: 0, newest: '' };
    s.items += 1;
    if ((x.created_at || '') > s.newest) s.newest = x.created_at;
    sources.set(k, s);
  });

  const ratings = d.reviews.map(r => r.rating).filter(Boolean);
  const avg = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : '–';
  const newest = [...d.questions, ...d.reviews].map(x => x.created_at).sort().at(-1);

  let n = 0;
  const sec = (kind, title, sub, body) =>
    `<section class="section" data-kind="${kind}"><h2><span class="num">${++n}.</span>${title}</h2>${sub ? `<p class="sub">${sub}</p>` : ''}${body}</section>`;

  let html = '';

  // 1. Overview
  html += sec('all', 'Overview', `Based on ${sources.size} source${sources.size === 1 ? '' : 's'}, last updated ${fmtDate(newest)}.`,
    `<div class="stats">
      <div class="stat"><div class="v">${questions.length}</div><div class="l">Questions</div></div>
      <div class="stat"><div class="v">${d.reviews.length}</div><div class="l">Reviews</div></div>
      <div class="stat"><div class="v">${avg}</div><div class="l">Avg rating</div></div>
      <div class="stat"><div class="v">${sources.size}</div><div class="l">Sources</div></div>
    </div>`);

  // 2. Interview rounds
  const rounds = {};
  questions.forEach(q => { const r = q.round_type || 'Unspecified'; rounds[r] = (rounds[r] || 0) + 1; });
  html += sec('questions', 'Interview rounds', 'Rounds that the saved questions came from.',
    `<div class="rounds">${Object.entries(rounds).sort((a, b) => b[1] - a[1])
      .map(([r, c]) => `<div class="round"><b>${esc(r)}</b><span>${c} question${c === 1 ? '' : 's'}</span></div>`).join('')}</div>`);

  // 3. Questions by category
  const roleNote = p.role && d.role_matched === false
    ? `No questions saved for the ${esc(p.role)} role yet, so all roles are shown. ` : '';
  const cats = {};
  questions.forEach(q => { const c = q.category || 'Other'; (cats[c] = cats[c] || []).push(q); });
  const catHtml = Object.entries(cats).sort((a, b) => b[1].length - a[1].length).map(([c, list], i) => `
    <details class="group" ${i === 0 ? 'open' : ''}>
      <summary>${esc(c)}<span class="count">${list.length}</span></summary>
      ${list.sort((a, b) => b.reports - a.reports).map(q => `
        <div class="q">
          <div class="text">${esc(q.text)}</div>
          <div class="meta">
            ${q.reports > 1 ? `<span class="tag good">reported ${q.reports}×</span>` : ''}
            ${q.difficulty ? `<span class="tag">${esc(q.difficulty)}</span>` : ''}
            ${esc(q.role_title || '')}
            ${q.url ? ` · <a href="${esc(q.url)}" target="_blank" rel="noopener noreferrer">${esc(q.source || 'source')}</a>` : (q.source ? ` · ${esc(q.source)}` : '')}
            · saved ${fmtDate(q.created_at)}
          </div>
        </div>`).join('')}
    </details>`).join('');
  html += sec('questions', 'Reported questions', roleNote + 'Grouped by subject. Every question comes from a saved report, not AI.', catHtml);

  // 4. Candidate experience
  if (d.reviews.length) {
    html += sec('reviews', 'Candidate and employee experience', `${d.reviews.length} review${d.reviews.length === 1 ? '' : 's'} saved.`,
      d.reviews.map(r => `
        <div class="result">
          <div class="title">${esc(r.title || r.job_title || 'Review')}${r.rating ? ` · ${r.rating}/5` : ''}</div>
          ${r.pros ? `<div class="pros"><b>Pros</b> ${esc(r.pros)}</div>` : ''}
          ${r.cons ? `<div class="cons"><b>Cons</b> ${esc(r.cons)}</div>` : ''}
          ${r.body ? `<div class="pros">${esc(r.body)}</div>` : ''}
          <div class="meta">${esc(r.source || '')}${r.review_date ? ' · ' + esc(r.review_date) : ''}${r.url ? ` · <a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">open</a>` : ''}</div>
        </div>`).join(''));
  }

  // 5. Sources
  html += sec('sources', 'Sources', 'Where every item above came from.',
    [...sources.values()].map(s => `
      <div class="result">
        <div class="title">${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.source)}</a>` : esc(s.source)}</div>
        <div class="meta">${s.items} item${s.items === 1 ? '' : 's'} · saved ${fmtDate(s.newest)}${s.url ? ' · ' + esc(s.url) : ''}</div>
      </div>`).join(''));

  $('#report').innerHTML = html;
}

function renderPanel(name, d, uniqueQuestions) {
  const ratings = d.reviews.map(r => r.rating).filter(Boolean);
  const avg = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) + ' / 5' : '–';
  $('#panel').innerHTML = `
    <div class="panel">
      <h3>${esc(name)}</h3>
      <div class="kind">Company</div>
      <div class="row"><span>Questions saved</span><span>${uniqueQuestions}</span></div>
      <div class="row"><span>Reviews saved</span><span>${d.reviews.length}</span></div>
      <div class="row"><span>Average rating</span><span>${avg}</span></div>
      <div class="links">${sourceLinks(name).map(l =>
        `<a href="${l.url}" target="_blank" rel="noopener noreferrer">${l.label} →</a>`).join('')}</div>
      <button class="btn" id="panel-research">Research sources</button>
      <p class="note">Opens the sites in new tabs. Pages you save with the Prepify extension land under ${esc(name)}.</p>
    </div>`;
  $('#panel-research').onclick = () => researchSources(name);
}

function setFilter(f) {
  $$('.filter').forEach(b => b.classList.toggle('active', b.dataset.filter === f));
  $$('#report .section').forEach(s => {
    s.classList.toggle('hidden', f !== 'all' && s.dataset.kind !== f);
  });
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
  // open placeholder tabs now (inside the click) so the popup blocker allows them
  const wins = [0, 1, 2].map(() => window.open('about:blank', '_blank'));
  try {
    const d = await getJson('/api/search?q=' + encodeURIComponent(q));
    if (!d.parsed.company) { wins.forEach(w => w && w.close()); go(q); return; }
    await researchSources(d.company ? d.company.name : d.parsed.company, wins);
    go(q);
  } catch (e) {
    wins.forEach(w => w && w.close());
  }
};

// initial load
const initial = new URLSearchParams(location.search).get('q');
initial ? go(initial, false) : showHome();
