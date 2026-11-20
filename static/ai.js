/* Prepify: AI assist (the server's AI provider, Groq by default; see ai.py).
   Off until the signed-in user turns it on after reading what is sent. When on, it
     - tidies pulled questions: cleans the text, hides non-questions, merges the same question across
       sources and tags each by subject, round and difficulty;
     - reads job descriptions of any layout (see jd.js);
     - reads searches the standard parser can't (see runSearch in search.js).
   Results are kept in this tab with the pulled data. Uses helpers from search.js at call time. */

const AI_PREF_KEY = 'prepify.ai.v1';          // this browser's choice: 'on' | 'off' (a per-viewer convenience)
const AI_BATCH = 40;                          // the server's per-call limit (fits Groq's tokens-per-minute)
const ai = { busy: false, state: {}, showOriginal: false, timer: null };

function aiPref() {
  try { return localStorage.getItem(AI_PREF_KEY); } catch (e) { return ai.memPref || null; }
}
function setAiPref(v) {
  ai.memPref = v;
  try { localStorage.setItem(AI_PREF_KEY, v); } catch (e) { /* storage blocked: remembered until reload */ }
}
const aiAvailable = () => !!(auth.ai && auth.ai.available);
const aiOn = () => signedIn() && aiPref() === 'on';
const aiReady = () => aiOn() && aiAvailable();
const aiOffer = () => signedIn() && aiAvailable() && !aiPref();

const aiModelName = () => (auth.ai && (auth.ai.model_name || auth.ai.model)) || 'AI';
const aiProvider = () => (auth.ai && auth.ai.provider) || 'the AI provider';
const aiFiles = () => aiReady() && !!(auth.ai && auth.ai.files);     // can the provider read scanned PDFs and photos?

function aiNoteStatus(s) {
  if (!s) return;
  auth.ai = s;
  $$('[data-ai-left]').forEach(el => { el.textContent = aiLeftText(); });
  $$('[data-ai-fast-left]').forEach(el => { el.textContent = aiFastLeftText(); });
  $$('[data-ai-bar]').forEach(el => { el.style.width = aiLeftPct() + '%'; });
}
const aiLeftText = () => {
  const t = auth.ai && auth.ai.tokens;
  if (!t || t.user_left === undefined) return '–';
  return `${fmtTokens(t.user_left)} of ${fmtTokens(t.user_budget)}`;
};
const aiFastLeftText = () => {
  const t = auth.ai && auth.ai.tokens && auth.ai.tokens.fast;
  if (!t || t.user_left === undefined) return '–';
  return `${fmtTokens(t.user_left)} of ${fmtTokens(t.user_budget)}`;
};
const aiLeftPct = () => {
  const t = auth.ai && auth.ai.tokens;
  return t && t.user_budget ? Math.round(100 * t.user_left / t.user_budget) : 0;
};

// ---------- consent: what AI assist does and what it sends ----------
function openAiConsent(then) {
  closeAiConsent();
  const el = document.createElement('div');
  el.id = 'ai-modal';
  el.className = 'modal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'ai-title');
  el.innerHTML = `
    <div class="modal-box ai-box">
      <div class="login-head">
        <span class="mark big" style="--c:var(--link)">AI</span>
        <div>
          <h2 id="ai-title">Turn on AI assist</h2>
          <p class="modal-sub">Uses ${esc(aiModelName())} on ${esc(aiProvider())}, through the Prepify server.</p>
        </div>
      </div>
      <div class="ai-does">
        <div class="xp-label">What it does</div>
        <ul class="jd-list">
          <li>Tidies pulled questions: fixes messy text, hides things that aren't questions, merges the same question across sources and tags each by round and difficulty.</li>
          <li>Reads job descriptions in any layout${auth.ai && auth.ai.files ? ', including scanned PDFs and photos' : ''}, and lists points worth checking.</li>
          <li>Understands searches the standard reading can't.</li>
        </ul>
      </div>
      <div class="ai-sends">
        <div class="xp-label">What is sent</div>
        <p>The questions you pull, any job description you add, and searches Prepify can't read are sent to
          ${esc(aiProvider())}'s API to be processed. Your resume is sent only when you ask for the deeper resume match. The results come straight back to this tab,
          and Prepify stores nothing on its server.${auth.ai && auth.ai.guard ? ' Text is screened first, and anything that tries to give the AI instructions is left out.' : ''}</p>
      </div>
      <p class="modal-note">AI assist works within a daily budget (${esc(auth.ai && auth.ai.tokens && auth.ai.tokens.user_budget ? fmtTokens(auth.ai.tokens.user_budget) : '50K')} tokens for you) and stops before the provider's limit.
        Only the question tidy-up runs on its own, and it pauses when less than 40% of your budget is left; everything else runs when you click, with its cost shown.
        Turn it off any time in the side panel.</p>
      <div class="login-actions">
        <button class="btn primary" data-ai-accept>Turn on AI assist</button>
        <button class="linkbtn" data-ai-decline>Not now</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', (e) => { if (e.target === el) closeAiConsent(); });
  el.querySelector('[data-ai-accept]').onclick = () => {
    setAiPref('on');
    closeAiConsent();
    toast('AI assist is on.');
    if (then) then(); else rerender();
  };
  el.querySelector('[data-ai-decline]').onclick = () => { setAiPref('off'); closeAiConsent(); rerender(); };
  setTimeout(() => el.querySelector('[data-ai-accept]').focus(), 0);
}
function closeAiConsent() {
  const el = $('#ai-modal');
  if (el) el.remove();
}

function aiTurnOff() {
  setAiPref('off');
  toast('AI assist is off. Showing the standard reading.');
  rerender();
}

// ---------- side panel ----------
function aiPanelHtml() {
  if (!aiAvailable()) {
    return signedIn() ? `
      <div class="panel-sep"></div>
      <h3>AI assist</h3>
      <div class="row"><span>Status</span><span class="off">Not set up</span></div>
      <p class="note">Add GROQ_API_KEY to the server's .env file and restart Prepify to use AI assist.</p>` : '';
  }
  if (!signedIn()) {
    return `
      <div class="panel-sep"></div>
      <h3>AI assist</h3>
      <div class="kind">${esc(aiModelName())} · ${esc(aiProvider())}</div>
      <p class="note">Sign in to tidy questions, read any job description and understand any search with AI.</p>`;
  }
  const on = aiOn();
  return `
    <div class="panel-sep"></div>
    <h3>AI assist</h3>
    <div class="kind">${esc(aiModelName())} · ${esc(aiProvider())}</div>
    <div class="row"><span>Status</span><span class="${on ? 'ok' : 'off'}">${on ? 'On' : 'Off'}</span></div>
    <div class="row" title="For the brief, model answers, job descriptions and search reading"><span>AI tokens left</span><span data-ai-left>${aiLeftText()}</span></div>
    <div class="ai-budget" title="Prepify stops before the AI provider's daily limit"><span data-ai-bar style="width:${aiLeftPct()}%"></span></div>
    <div class="row" title="Question tidying has its own daily budget, on a faster model"><span>Tidying tokens left</span><span data-ai-fast-left>${aiFastLeftText()}</span></div>
    <button class="btn" data-ai-toggle>${on ? 'Turn off AI assist' : 'Turn on AI assist'}</button>`;
}

function wireAiPanel() {
  $$('[data-ai-toggle]').forEach(b => b.onclick = () => aiOn() ? aiTurnOff() : openAiConsent());
}

// ---------- applying AI tags to pulled questions ----------
// entry.ai.tags: norm(original text) -> { t: clean text, s: subject, r: round, d: difficulty, g: group key, k: keep }
const qKey = (q) => q.group || norm(q.text);

function aiApply(entry, list, mergeSameSource = true) {
  if (!aiOn() || ai.showOriginal || !entry || !entry.ai || !list) return list || [];
  const tags = entry.ai.tags;
  const out = [];
  const seen = new Map();
  list.forEach(q => {
    const a = tags[norm(q.text)];
    if (!a) { out.push(q); return; }
    if (a.k === false) return;
    const key = (q.source || '') + '|' + a.g;
    if (mergeSameSource && seen.has(key)) {
      const have = seen.get(key);
      (q.answers || []).forEach(x => { if (!have.answers.includes(x)) have.answers.push(x); });
      return;
    }
    const item = { ...q, text: a.t || q.text, original: q.text, answers: [...(q.answers || [])], group: a.g,
                   category: a.s || q.category, round_type: a.r || q.round_type, difficulty: a.d || q.difficulty };
    seen.set(key, item);
    out.push(item);
  });
  return out;
}

// every distinct question text for a company (Q&A lists and questions inside experiences)
function aiAllTexts(c) {
  const seen = new Map();
  const add = (q) => { const k = norm((q && q.text) || ''); if (k && !seen.has(k)) seen.set(k, q.text); };
  (c.questions || []).forEach(add);
  (c.experiences || []).forEach(x => (x.questions || []).forEach(add));
  return [...seen.entries()].map(([k, text]) => ({ k, text }));
}
const aiTodo = (c) => aiAllTexts(c).filter(x => !(c.ai && c.ai.tags[x.k]));

function aiSummary(c) {
  const tags = (c && c.ai && c.ai.tags) || {};
  const all = aiAllTexts(c || {});
  let tidied = 0, merged = 0, hidden = 0;
  all.forEach(({ k }) => {
    const a = tags[k];
    if (!a) return;
    tidied += 1;
    if (a.k === false) hidden += 1;
    else if (a.g !== k) merged += 1;
  });
  return { total: all.length, tidied, merged, hidden };
}

// ---------- running the tidy-up (automatic while AI assist is on) ----------
function aiSchedule() {
  clearTimeout(ai.timer);
  if (!aiReady()) return;
  ai.timer = setTimeout(aiAutoTidy, 600);
}

function aiCompanyKey() {
  return lastData && lastData.parsed && lastData.parsed.company ? lastData.parsed.company.toLowerCase() : null;
}

async function aiAutoTidy() {
  const key = aiCompanyKey();
  if (!aiReady() || ai.busy || !key || !store.companies[key]) return;
  const todo = aiTodo(store.companies[key]);
  if (!todo.length) return;
  const st = ai.state[key];
  if (st && (st.status === 'error' || st.status === 'paused') && st.todoCount === todo.length) return;   // by hand, or when more arrive
  await aiTidy(key);
}

async function aiTidy(key, manual = false) {
  const c = store.companies[key];
  if (!c) return;
  const todo = aiTodo(c);
  if (!todo.length) return;
  c.ai = c.ai || { tags: {} };
  const st = ai.state[key] = { status: 'running', total: todo.length, done: 0 };
  ai.busy = true;
  aiRefreshStrip();
  try {
    for (let i = 0; i < todo.length; i += AI_BATCH) {
      const chunk = todo.slice(i, i + AI_BATCH);
      const reps = Object.entries(c.ai.tags).filter(([k, a]) => a.k !== false && a.g === k).slice(-150);
      const r = await getJson('/api/ai/questions', {
        method: 'POST',
        body: JSON.stringify({
          company: c.name,
          background: !manual,                        // automatic work stops early to keep the user's budget
          items: chunk.map((x, j) => ({ id: 'n' + j, text: x.text })),
          known: reps.map(([, a], j) => ({ id: 'k' + j, text: a.t }))
        })
      });
      aiNoteStatus(r.ai);
      const byId = new Map((r.items || []).map(it => [it.id, it]));
      chunk.forEach((x, j) => {
        const it = byId.get('n' + j);
        if (!it) { c.ai.tags[x.k] = { t: x.text, k: true, g: x.k }; return; }   // not returned: keep it as it was
        let g = x.k;
        const ref = it.same_as || '';
        if (ref[0] === 'k' && reps[+ref.slice(1)]) g = reps[+ref.slice(1)][0];
        else if (ref[0] === 'n' && chunk[+ref.slice(1)]) {
          const other = chunk[+ref.slice(1)];
          g = (c.ai.tags[other.k] && c.ai.tags[other.k].g) || other.k;
        }
        c.ai.tags[x.k] = {
          t: (it.text || '').trim() || x.text, k: it.keep !== false, g,
          s: it.subject && it.subject !== 'General' ? it.subject : '', r: it.round || '', d: it.difficulty || ''
        };
      });
      st.done = Math.min(todo.length, i + chunk.length);
      saveStore();
      // show each batch as it lands, unless the user is typing somewhere (a re-render would take their input)
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((document.activeElement || {}).tagName);
      if (i + AI_BATCH < todo.length && !typing) rerender(); else aiRefreshStrip();
    }
    st.status = 'done';
  } catch (e) {
    aiNoteStatus(e.body && e.body.ai);
    Object.assign(st, { status: e.body && e.body.paused ? 'paused' : 'error', error: e.message, todoCount: aiTodo(c).length });
  }
  ai.busy = false;
  rerender();
}

// ---------- the strip on the results dashboard ----------
function aiStripHtml(d) {
  const key = aiCompanyKey();
  const c = key && store.companies[key];
  if (!signedIn() || !aiAvailable() || !c) return '';
  const sum = aiSummary(c);
  if (!sum.total) return '';
  const mark = '<span class="mark" style="--c:var(--link)">AI</span>';
  if (aiOffer()) {
    return `<div class="ai-strip" id="ai-strip">${mark}
      <div class="ai-strip-text"><b>AI assist can tidy these ${plural(sum.total, 'question')}</b>
        <span>Fix messy text, merge the same question across sources and tag each by round and difficulty.</span></div>
      <div class="ai-strip-actions"><button class="btn small primary" data-ai-offer>Turn on</button><button class="linkbtn" data-ai-later>Not now</button></div>
    </div>`;
  }
  if (!aiOn()) return '';
  const st = ai.state[key] || {};
  if (st.status === 'running' || (!st.status && sum.tidied < sum.total)) {
    return `<div class="ai-strip" id="ai-strip" role="status">${mark}
      <div class="ai-strip-text"><b><span class="spinner"></span>Tidying ${plural(st.total || sum.total - sum.tidied, 'question')} with AI…</b>
        <span>${st.total > AI_BATCH ? `${st.done} of ${st.total} done. ` : ''}Fixing the text, merging duplicates and tagging rounds and difficulty.</span></div>
    </div>`;
  }
  if (st.status === 'paused' && sum.tidied < sum.total) {
    const n = sum.total - sum.tidied;
    return `<div class="ai-strip" id="ai-strip">${mark}
      <div class="ai-strip-text"><b>Tidying paused to save your AI budget</b><span>${plural(n, 'question')} not tidied yet. Automatic tidying stops when less than 40% of today's budget is left.</span></div>
      <div class="ai-strip-actions"><button class="btn small" data-ai-retry>Tidy now <span class="cost">· ~${fmtTokens(500 + 70 * n)} tokens</span></button></div>
    </div>`;
  }
  if (st.status === 'error' && sum.tidied < sum.total) {
    return `<div class="ai-strip error" id="ai-strip" role="alert">${mark}
      <div class="ai-strip-text"><b>AI couldn't tidy the questions</b><span>${esc(st.error)}</span></div>
      <div class="ai-strip-actions"><button class="btn small" data-ai-retry>Retry</button></div>
    </div>`;
  }
  const parts = [plural(sum.tidied, 'question') + ' tidied'];
  if (sum.merged) parts.push(plural(sum.merged, 'duplicate') + ' merged');
  if (sum.hidden) parts.push(sum.hidden + (sum.hidden === 1 ? ' non-question' : ' non-questions') + ' hidden');
  return `<div class="ai-strip done" id="ai-strip">${mark}
    <div class="ai-strip-text"><b>${ai.showOriginal ? 'Showing the questions as pulled' : 'Questions tidied with AI'}</b><span>${parts.join(' · ')}</span></div>
    <div class="ai-strip-actions"><button class="linkbtn accent" data-ai-original>${ai.showOriginal ? 'Show tidied' : 'Show as pulled'}</button></div>
  </div>`;
}

function wireAiStrip() {
  const b = (sel, fn) => $$(sel).forEach(x => x.onclick = fn);
  b('[data-ai-offer]', () => openAiConsent());
  b('[data-ai-later]', () => { setAiPref('off'); rerender(); });
  b('[data-ai-retry]', () => { const k = aiCompanyKey(); if (k) { delete ai.state[k]; aiTidy(k, true); } });
  b('[data-ai-original]', () => { ai.showOriginal = !ai.showOriginal; rerender(); });
}

function aiRefreshStrip() {
  const el = $('#ai-strip');
  if (!el || !lastData) return;
  const html = aiStripHtml(lastData);
  if (!html) { el.remove(); return; }
  el.outerHTML = html;
  wireAiStrip();
}

// ---------- searches the standard reading couldn't place ----------
const aiWantsParse = (p) => !p.company || p.company_source === 'guess';

async function aiParse(parsedResponse) {
  try {
    const r = await getJson('/api/ai/parse', { method: 'POST', body: JSON.stringify({ q: parsedResponse.query }) });
    aiNoteStatus(r.ai);
    return { query: parsedResponse.query, parsed: r.parsed };
  } catch (e) {
    aiNoteStatus(e.body && e.body.ai);
    toast(`AI couldn't read the search: ${e.message}`);
    return parsedResponse;
  }
}

// ---------- the job description dialog ----------
const JD_ACCEPT_AI = '.pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp';

function aiJdNoteHtml() {
  if (aiReady()) {
    return `<div class="ai-note"><span class="mark tiny" style="--c:var(--link)">AI</span>
      <span>AI assist will read this JD${aiFiles() ? ', in any layout, including scanned PDFs and photos' : ' and list points worth checking'}.</span></div>`;
  }
  if (signedIn() && aiAvailable()) {
    return `<div class="ai-note"><span class="mark tiny" style="--c:var(--link)">AI</span>
      <span><button class="linkbtn accent" type="button" data-ai-jd-on>Turn on AI assist</button> for a deeper reading of any layout.</span></div>`;
  }
  return '';
}

function wireAiJdNote() {
  const b = $('[data-ai-jd-on]');
  if (!b) return;
  b.onclick = () => openAiConsent(() => {
    const note = $('#jd-modal .ai-note');
    if (note) note.outerHTML = aiJdNoteHtml();
    const f = $('#jd-file');
    if (f && aiFiles()) f.accept = JD_ACCEPT_AI;
    const label = $('#jd-file-label');
    if (label && aiFiles()) label.textContent = 'Upload PDF, DOCX, TXT or image';
  });
}
