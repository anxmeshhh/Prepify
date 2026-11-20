/* Prepify: job description analysis.
   The JD (and optional resume) is analysed by the server and the result kept in this tab only,
   next to the pulled interview data. Uses helpers from search.js ($, esc, store, go...) at call time. */

const JD_LEVEL = { required: 'Required', expected: 'Expected', preferred: 'Nice to have', mentioned: 'Mentioned' };
const JD_TABS = [
  ['overview', 'Overview'],
  ['skills', 'Skills'],
  ['rounds', 'Likely rounds'],
  ['plan', 'Prep plan'],
  ['matches', 'Matching questions'],
  ['resume', 'Resume match'],
  ['ask', 'Questions to ask']
];
const JD_ACCEPT = '.pdf,.docx,.txt,.md';

function jdNow() {
  if (!store || !store.jd) return null;
  store.jd.done = store.jd.done || {};
  return store.jd;
}

// ---------- matching text against the JD's skills ----------
const RX_CACHE = new Map();
function rxFor(pattern) {
  if (!RX_CACHE.has(pattern)) {
    try { RX_CACHE.set(pattern, new RegExp(pattern, 'i')); } catch (e) { RX_CACHE.set(pattern, /(?!)/); }
  }
  return RX_CACHE.get(pattern);
}

function jdSkillsIn(text) {
  const jd = jdNow();
  if (!jd || !text) return [];
  return jd.analysis.skills.filter(s => rxFor(s.pattern).test(text)).map(s => s.name);
}

// every pulled question for the company (Q&A lists and questions inside experiences), once each
function pulledQuestions(d) {
  if (!d) return [];
  const seen = new Map();
  const add = (q, source, url) => {
    if (!q || !q.text) return;
    const k = qKey(q);
    const have = seen.get(k);
    if (have) { have.sources.add(source); return; }
    seen.set(k, { text: q.text, answers: q.answers || [], sources: new Set([source]), url });
  };
  (d.questions || []).forEach(q => add(q, q.source, q.url));
  (d.experiences || []).forEach(x => (x.questions || []).forEach(q => add(q, x.source, x.url)));
  return [...seen.values()];
}

function skillCoverage(d) {
  const jd = jdNow();
  const qs = pulledQuestions(d);
  const out = {};
  jd.analysis.skills.forEach(s => {
    const rx = rxFor(s.pattern);
    out[s.name] = qs.filter(q => rx.test(q.text));
  });
  return out;
}

// ---------- the prep plan ----------
function jdPlan(d) {
  const jd = jdNow();
  const cover = skillCoverage(d);
  const weight = { required: 3, expected: 2, preferred: 1, mentioned: 0 };
  const items = jd.analysis.skills
    .filter(s => s.level !== 'mentioned' && s.category !== 'Soft skills')
    .map(s => ({ ...s, reported: cover[s.name] || [], score: weight[s.level] * 2 + Math.min(s.mentions, 4) + Math.min((cover[s.name] || []).length, 5) * 2 }))
    .sort((a, b) => b.score - a.score);
  const tiers = [['Must cover', []], ['Should cover', []], ['If time allows', []]];
  items.forEach(it => {
    const t = it.level === 'preferred' ? 2 : (it.reported.length || it.mentions >= 2 || it.level === 'expected') ? 0 : 1;
    tiers[t][1].push(it);
  });
  // behavioural prep always belongs in the plan
  const soft = jd.analysis.skills.filter(s => s.category === 'Soft skills');
  return { tiers: tiers.filter(([, list]) => list.length), soft };
}

function planProgress(d) {
  const jd = jdNow();
  const { tiers } = jdPlan(d);
  const keys = tiers.flatMap(([, list]) => list.flatMap(s => s.topics.map(t => `${s.name}|${t}`)));
  const done = keys.filter(k => jd.done && jd.done[k]).length;
  return { done, total: keys.length };
}

// ---------- the JD dialog: paste or upload, optional resume, then confirm company and role ----------
function openJdModal(step = 'input') {
  let el = $('#jd-modal');
  if (!el) {
    el = document.createElement('div');
    el.id = 'jd-modal';
    el.className = 'modal';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'jd-title');
    document.body.appendChild(el);
    el.addEventListener('click', (e) => { if (e.target === el) closeJdModal(); });
  }
  el.classList.remove('hidden');
  if (step === 'confirm') return renderJdConfirm(el);
  const jd = jdNow();
  el.innerHTML = `
    <form class="modal-box jd-box" id="jd-form">
      <h2 id="jd-title">${jd ? 'Replace the job description' : 'Add a job description'}</h2>
      <p class="modal-sub">Prepify reads the JD to work out the skills it asks for, the rounds you'll probably face and a
        prep plan, then matches it against the interview questions you pull. It's analysed and sent straight back;
        nothing is stored on the server.</p>

      <div class="field">
        <div class="field-head"><label for="jd-text">Job description</label>
          <label class="file-btn"><input type="file" id="jd-file" accept="${aiFiles() ? JD_ACCEPT_AI : JD_ACCEPT}" /><span id="jd-file-label">${aiFiles() ? 'Upload PDF, DOCX, TXT or image' : 'Upload PDF, DOCX or TXT'}</span></label></div>
        <div class="file-name hidden" id="jd-file-name"></div>
        <textarea id="jd-text" rows="9" placeholder="Paste the job description here, or upload the file"></textarea>
      </div>

      <details class="field resume-opt" ${jd && jd.resumeText ? 'open' : ''}>
        <summary>Compare with my resume <span>(optional)</span></summary>
        <div class="field-head"><label for="resume-text">Resume</label>
          <label class="file-btn"><input type="file" id="resume-file" accept="${JD_ACCEPT}" />Upload resume</label></div>
        <div class="file-name hidden" id="resume-file-name"></div>
        <textarea id="resume-text" rows="5" placeholder="Paste your resume text here, or upload the file">${esc((jd && jd.resumeText) || '')}</textarea>
        <p class="note">Used only to show which JD skills your resume covers. Kept in this tab, like everything else.</p>
      </details>
      ${aiJdNoteHtml()}

      <div class="form-error hidden" id="jd-error" role="alert"></div>
      <div class="login-actions">
        <button class="btn primary" type="submit" id="jd-go">Analyse</button>
        <button class="linkbtn" type="button" data-jd-close>Cancel</button>
      </div>
    </form>`;
  const showName = (input, label) => input.onchange = () => {
    const f = input.files[0];
    label.textContent = f ? `${f.name} · ${(f.size / 1024).toFixed(0)} KB` : '';
    label.classList.toggle('hidden', !f);
  };
  showName($('#jd-file'), $('#jd-file-name'));
  showName($('#resume-file'), $('#resume-file-name'));
  el.querySelector('[data-jd-close]').onclick = closeJdModal;
  wireAiJdNote();
  $('#jd-form').onsubmit = (e) => { e.preventDefault(); submitJd(); };
  setTimeout(() => $('#jd-text').focus(), 0);
}

function closeJdModal() {
  const el = $('#jd-modal');
  if (el) el.classList.add('hidden');
}

async function submitJd() {
  const err = $('#jd-error');
  const btn = $('#jd-go');
  const fd = new FormData();
  const jdFile = $('#jd-file').files[0];
  const jdText = $('#jd-text').value.trim();
  if (!jdFile && !jdText) {
    err.textContent = 'Paste the job description or upload the file.';
    err.classList.remove('hidden');
    return;
  }
  if (jdFile) fd.append('jd_file', jdFile); else fd.append('jd_text', jdText);
  const rFile = $('#resume-file').files[0];
  const rText = $('#resume-text').value.trim();
  if (rFile) fd.append('resume_file', rFile); else if (rText) fd.append('resume_text', rText);
  const withAi = aiReady();
  if (withAi) fd.append('use_ai', '1');
  err.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = withAi ? 'Reading with AI…' : 'Analysing…';
  try {
    const res = await fetch('/api/jd', { method: 'POST', body: fd });
    const body = await res.json().catch(() => ({}));
    aiNoteStatus(body.ai);
    if (!res.ok) throw new Error(body.error || `The server said ${res.status}`);
    if (body.ai_error) toast(`AI assist couldn't read the JD, so Prepify used the standard reading. ${body.ai_error}`);
    store.jd = {
      analysis: body.analysis,
      text: jdFile ? (body.text || null) : jdText,
      resumeText: rFile ? null : (rText || null),
      created_at: new Date().toISOString(),
      done: {}
    };
    saveStore();
    renderJdConfirm($('#jd-modal'));
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Analyse';
  }
}

function renderJdConfirm(el) {
  const a = jdNow().analysis;
  const req = a.skills.filter(s => s.level === 'required').length;
  el.innerHTML = `
    <form class="modal-box jd-box" id="jd-confirm">
      <h2 id="jd-title">Job description read</h2>
      <p class="modal-sub">Found <b>${plural(a.skills.length, 'skill')}</b> (${req} required) and
        <b>${plural(a.rounds.length, 'likely round')}</b>${a.resume ? `, and your resume covers <b>${a.resume.score ?? 0}%</b> of the required skills` : ''}.
        Check the company and role so Prepify can pull the right interviews.</p>
      <div class="field two">
        <label>Company<input id="jd-company" value="${esc(a.company || '')}" placeholder="Company name" required /></label>
        <label>Role<input id="jd-role" value="${esc(a.title || '')}" placeholder="Role" /></label>
      </div>
      ${a.company_source === 'mentioned' ? '<p class="note">The company was guessed from names mentioned in the JD. Please check it.</p>' : ''}
      ${a.ai ? `<p class="note">Read with AI assist (${esc(a.ai.model_name || a.ai.model)}).</p>` : ''}
      <div class="form-error hidden" id="jd-error" role="alert"></div>
      <div class="login-actions">
        <button class="btn primary" type="submit">Show the analysis</button>
        <button class="linkbtn" type="button" data-jd-back>Change the JD</button>
      </div>
    </form>`;
  el.querySelector('[data-jd-back]').onclick = () => openJdModal('input');
  $('#jd-confirm').onsubmit = async (e) => {
    e.preventDefault();
    const company = $('#jd-company').value.trim();
    const role = $('#jd-role').value.trim();
    if (!company) {
      $('#jd-error').textContent = 'Add the company name so Prepify can find its interviews.';
      $('#jd-error').classList.remove('hidden');
      return;
    }
    const jd = jdNow();
    jd.company = company;
    jd.role = role;
    saveStore();
    closeJdModal();
    await go(await queryFor(company, role), true, 'JD');
  };
}

// A natural query ("Razorpay Software Engineer II interview questions") when the parser reads it
// back correctly, otherwise the explicit company:"..." role:"..." form.
async function queryFor(company, role) {
  const natural = `${company}${role ? ' ' + role : ''} interview questions`;
  try {
    const r = await getJson('/api/parse?q=' + encodeURIComponent(natural));
    const p = r.parsed;
    const same = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();
    if (same(p.company, company) && (!role || same(p.role, role))) return natural;
  } catch (e) { /* fall through */ }
  return `company:"${company}"${role ? ` role:"${role}"` : ''} interview questions`;
}

// ---------- the JD page ----------
function renderJdPage(d) {
  const jd = jdNow();
  const a = jd.analysis;
  layoutEl().classList.add('wide');
  $('#panel').innerHTML = '';
  understoodLine(d.parsed);
  const name = jd.company || a.company || companyName(d) || 'this company';
  const cover = skillCoverage(d);
  const qs = pulledQuestions(d);
  const matched = qs.filter(q => jdSkillsIn(q.text).length);
  const prog = planProgress(d);
  const counts = {
    overview: null, skills: a.skills.length, rounds: a.rounds.length, plan: prog.total ? `${prog.done}/${prog.total}` : null,
    matches: matched.length, resume: a.resume ? `${a.resume.score ?? 0}%` : null, ask: a.ask.length
  };
  const wanted = new URLSearchParams(location.search).get('tab');
  const tab = JD_TABS.some(([k]) => k === wanted) ? wanted : 'overview';
  const companyMismatch = d.parsed.company && jd.company && d.parsed.company.toLowerCase() !== jd.company.toLowerCase();

  $('#report').innerHTML = `
    <nav class="crumbs" aria-label="Breadcrumb">
      <button class="btn small" data-back>← Back to results</button>
      <span class="crumb-path"><button class="linkbtn" data-back>${esc(companyName(d) || name)}</button><span>›</span><b>Job description</b></span>
    </nav>

    <header class="source-hero">
      <span class="mark big" style="--c:var(--purple)">JD</span>
      <div class="hero-text">
        <h1>${esc(jd.role || a.title || 'Job description')} <span class="dim">· ${esc(name)}</span></h1>
        <div class="sub">${[a.seniority, a.experience && a.experience.label, a.facts.work_mode, (a.facts.locations || []).join(', ')]
          .filter(Boolean).map(esc).join(' · ') || 'Analysed job description'} · added ${fmtDate(jd.created_at)}${a.ai ? ' · read with AI' : ''}</div>
      </div>
      <div class="head-actions">
        <button class="btn primary" data-pdf="JD">Download PDF</button>
        <button class="btn" data-jd-replace>Replace JD</button>
      </div>
    </header>
    ${companyMismatch ? `<div class="notice">This JD is for <b>${esc(jd.company)}</b>, but you're looking at ${esc(d.parsed.company)}.
      <button class="linkbtn accent" data-jd-search>Search ${esc(jd.company)} instead</button></div>` : ''}

    <nav class="tabs" role="tablist">
      ${JD_TABS.map(([k, label]) => `<button class="tab ${k === tab ? 'active' : ''}" role="tab" aria-selected="${k === tab}" data-tab="${k}">${label}${counts[k] !== null && counts[k] !== undefined ? `<span>${esc(counts[k])}</span>` : ''}</button>`).join('')}
    </nav>
    <div id="tab-body" role="tabpanel"></div>

    <div class="page-foot">
      <button class="btn" data-back>← Back to results</button>
      <button class="linkbtn" id="to-top">Back to top ↑</button>
    </div>`;

  const showTab = (k) => {
    $$('.tabs .tab').forEach(t => { t.classList.toggle('active', t.dataset.tab === k); t.setAttribute('aria-selected', t.dataset.tab === k); });
    history.replaceState({ q: d.query, src: 'JD', tab: k }, '', urlFor(d.query, 'JD', k));
    $('#tab-body').innerHTML = jdTabBody(k, d, { cover, qs, matched });
    wireJdTab(k, d);
  };
  $$('.tabs .tab').forEach(t => t.onclick = () => showTab(t.dataset.tab));
  $$('[data-back]').forEach(b => b.onclick = () => { go(d.query, true); window.scrollTo(0, 0); });
  $('#to-top').onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  $('[data-jd-replace]').onclick = () => openJdModal('input');
  const js = $('[data-jd-search]');
  if (js) js.onclick = async () => go(await queryFor(jd.company, jd.role), true, 'JD');
  showTab(tab);
  wirePdf();
}

const jdList = (items, cls = '') => items && items.length ? `<ul class="jd-list ${cls}">${items.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : '';
const levelTag = (lvl) => `<span class="tag lvl-${lvl}">${JD_LEVEL[lvl] || lvl}</span>`;

function jdTabBody(k, d, ctx) {
  const jd = jdNow();
  const a = jd.analysis;
  const f = a.facts || {};

  if (k === 'overview') {
    const facts = [
      ['Role', jd.role || a.title], ['Company', jd.company || a.company], ['Seniority', a.seniority],
      ['Experience', a.experience && a.experience.label], ['Role type', a.family !== 'General' ? a.family : null],
      ['Work mode', f.work_mode], ['Employment', f.employment], ['Location', (f.locations || []).join(', ')],
      ['Salary in the JD', f.salary], ['Education', (f.education || []).join(' ')],
      ['Academic cut-off', f.academic_cutoff], ['Backlogs', f.backlogs], ['Bond', f.bond], ['Shifts', f.shifts],
      ['Relocation', f.relocation], ['Travel', f.travel]
    ].filter(([, v]) => v);
    const req = a.skills.filter(s => s.level === 'required' && s.category !== 'Soft skills');
    return `
      <div class="jd-grid">
        <section class="jd-card">
          <h3>At a glance</h3>
          <dl class="facts">${facts.map(([kk, v]) => `<dt>${esc(kk)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
          ${a.experience && a.experience.evidence ? `<p class="evidence">“${esc(a.experience.evidence)}”</p>` : ''}
        </section>
        <section class="jd-card">
          <h3>What to focus on</h3>
          <p class="sub">The required skills, most mentioned first.</p>
          <div class="chips static">${req.slice(0, 12).map(s => `<span class="chip-btn">${esc(s.name)}${s.mentions > 1 ? ` <span>×${s.mentions}</span>` : ''}</span>`).join('') || '<span class="muted">No specific technical skills found.</span>'}</div>
          <h3 class="mt">Likely rounds</h3>
          <ol class="jd-steps">${a.rounds.map(r => `<li>${esc(r.name)}</li>`).join('')}</ol>
        </section>
      </div>
      ${(a.watch_outs || []).length ? `<section class="section"><h2>Worth checking</h2>
        <p class="sub">Points in this JD to clarify before you accept an offer.</p>${jdList(a.watch_outs, 'watch')}</section>` : ''}
      ${a.process && a.process.length ? `<section class="section"><h2>Hiring process stated in the JD</h2>${jdList(a.process)}</section>` : ''}
      ${a.responsibilities.length ? `<section class="section"><h2>What you'll do</h2>${jdList(a.responsibilities)}</section>` : ''}
      ${a.requirements.length ? `<section class="section"><h2>What they ask for</h2>${jdList(a.requirements)}</section>` : ''}
      ${a.preferred.length ? `<section class="section"><h2>Nice to have</h2>${jdList(a.preferred)}</section>` : ''}`;
  }

  if (k === 'skills') {
    const byCat = {};
    a.skills.forEach(s => (byCat[s.category] = byCat[s.category] || []).push(s));
    const levels = ['required', 'expected', 'preferred', 'mentioned'].filter(l => a.skills.some(s => s.level === l));
    return `
      <div class="qa-tools">
        <div class="chips">
          <button class="chip-btn active" data-level="">All <span>${a.skills.length}</span></button>
          ${levels.map(l => `<button class="chip-btn" data-level="${l}">${JD_LEVEL[l]} <span>${a.skills.filter(s => s.level === l).length}</span></button>`).join('')}
        </div>
      </div>
      ${Object.entries(byCat).map(([cat, skills]) => `
        <section class="section skill-cat">
          <h2>${esc(cat)}</h2>
          <div class="skill-grid">${skills.map(s => {
            const n = (ctx.cover[s.name] || []).length;
            return `<article class="skill-card" data-level="${s.level}">
              <header><b>${esc(s.name)}</b>${levelTag(s.level)}</header>
              <div class="skill-meta">${s.mentions ? `Mentioned ${s.mentions === 1 ? 'once' : s.mentions + ' times'} in the JD` : 'Not in the JD'}${n ? ` · <span class="good">asked in ${plural(n, 'pulled question')}</span>` : ''}</div>
              ${s.evidence ? `<p class="evidence">“${esc(s.evidence)}”</p>` : ''}
              ${s.topics.length ? `<div class="skill-topics">${s.topics.map(t => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
            </article>`;
          }).join('')}</div>
        </section>`).join('')}`;
  }

  if (k === 'rounds') {
    const reported = {};
    (d.experiences || []).forEach(x => (x.rounds || []).forEach(r => {
      const n = sentence((r.name || '').replace(/^round\s*\d+\s*[:\-–]?\s*/i, '').trim());
      if (n && n.length < 60) reported[n] = (reported[n] || 0) + 1;
    }));
    const rep = Object.entries(reported).sort((x, y) => y[1] - x[1]).slice(0, 8);
    return `
      <p class="sub">Predicted from the JD's role, seniority and skills, not reported by candidates. ${rep.length ? 'What candidates actually reported is further down.' : ''}</p>
      ${a.process && a.process.length ? `<div class="notice"><b>The JD describes the process:</b> ${esc(a.process.join(' '))}</div>` : ''}
      <ol class="round-list">${a.rounds.map((r, i) => `
        <li class="round-card">
          <div class="round-num">${i + 1}</div>
          <div>
            <h3>${esc(r.name)}</h3>
            <p class="why">${esc(r.why)}</p>
            <ul class="jd-list">${r.focus.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
          </div>
        </li>`).join('')}</ol>
      ${rep.length ? `<section class="section"><h2>Rounds candidates reported at ${esc(companyName(d))}</h2>
        <p class="sub">From the interview experiences you pulled.</p>
        <div class="chips static">${rep.map(([n, c]) => `<span class="chip-btn">${esc(n)} <span>${c}</span></span>`).join('')}</div></section>` : ''}`;
  }

  if (k === 'plan') {
    const { tiers, soft } = jdPlan(d);
    const prog = planProgress(d);
    const pct = prog.total ? Math.round(100 * prog.done / prog.total) : 0;
    return `
      <div class="plan-progress">
        <div class="bar"><span style="width:${pct}%"></span></div>
        <span><b>${prog.done}</b> of ${plural(prog.total, 'topic')} done</span>
        ${prog.done ? '<button class="linkbtn" data-plan-reset>Reset</button>' : ''}
      </div>
      <p class="sub">Ordered by what the JD stresses and what candidates were actually asked. Tick topics off as you go; progress stays in this tab.</p>
      ${tiers.map(([tier, items]) => `
        <section class="section">
          <h2>${esc(tier)}</h2>
          <div class="plan-list">${items.map(s => `
            <details class="plan-item" ${tier === 'Must cover' ? 'open' : ''}>
              <summary>
                <b>${esc(s.name)}</b>${levelTag(s.level)}
                <span class="plan-why">${s.reported.length ? `asked in ${plural(s.reported.length, 'pulled question')}` : s.mentions > 1 ? `mentioned ${s.mentions} times` : ''}</span>
                <span class="plan-count">${s.topics.filter(t => jd.done[`${s.name}|${t}`]).length}/${s.topics.length}</span>
              </summary>
              <div class="plan-body">
                <div class="xp-label">Revise</div>
                <ul class="checklist">${s.topics.map(t => {
                  const key = `${s.name}|${t}`;
                  return `<li><label><input type="checkbox" data-done="${esc(key)}" ${jd.done[key] ? 'checked' : ''} /> ${esc(t)}</label></li>`;
                }).join('')}</ul>
                ${s.reported.length ? `<div class="xp-label">Asked at ${esc(companyName(d))}</div>
                  <ol class="xp-questions">${s.reported.slice(0, 4).map(q => `<li><span>${esc(q.text)}</span> <small class="muted">${[...q.sources].map(esc).join(', ')}</small></li>`).join('')}</ol>` : ''}
                ${s.questions.length ? `<div class="xp-label">Practise these</div>
                  <ol class="xp-questions">${s.questions.map(q => `<li><span>${esc(q)}</span>${practiceLinks({ text: q })}</li>`).join('')}</ol>` : ''}
              </div>
            </details>`).join('')}</div>
        </section>`).join('')}
      ${`<section class="section">
        <h2>Behavioural stories</h2>
        <p class="sub">Prepare one short STAR story (situation, task, action, result) for each.</p>
        <ol class="xp-questions">${[...soft.flatMap(s => s.questions), 'Tell me about yourself.', `Why do you want to join ${esc(jd.company || 'this company')}?`,
          'Tell me about a project you are proud of and what you would change.', 'Tell me about a time you failed and what you learned.']
          .map(q => `<li><span>${esc(q)}</span></li>`).join('')}</ol>
      </section>`}`;
  }

  if (k === 'matches') {
    if (!ctx.qs.length) {
      return `<div class="empty"><h3>No interview questions pulled yet</h3>
        Pull ${esc(companyName(d) || 'the company')}'s sources and Prepify will show which reported questions touch this JD's skills.
        <div><button class="btn primary" data-jd-pull>${signedIn() ? 'Pull all sources' : 'Sign in to pull sources'}</button></div></div>`;
    }
    const groups = {};
    ctx.matched.forEach(q => jdSkillsIn(q.text).forEach(sn => (groups[sn] = groups[sn] || []).push(q)));
    const order = a.skills.map(s => s.name).filter(n => groups[n]);
    return `
      <p class="sub">${plural(ctx.matched.length, 'pulled question')} of ${ctx.qs.length} touch skills in this JD, grouped by skill.
        Questions that touch several skills appear under each.</p>
      ${order.length ? order.map(sn => `
        <section class="section">
          <h2>${esc(sn)} <span class="dim">· ${groups[sn].length}</span></h2>
          <div class="qa-list">${groups[sn].map((q, i) => `
            <article class="qa-card">
              <div class="qa-q"><span class="qnum">Q${i + 1}</span><span>${esc(q.text)}</span></div>
              <div class="qa-tags">${[...q.sources].map(s => `<span class="tag">${esc(s)}</span>`).join('')}</div>
              ${q.answers[0] ? `<div class="answer"><div class="a-label">Answer</div>${richText(q.answers[0])}</div>` : ''}
              ${practiceLinks(q)}
            </article>`).join('')}</div>
        </section>`).join('') : '<div class="empty"><h3>No overlap yet</h3>None of the pulled questions mention this JD\'s skills. The prep plan has practice questions for each skill.</div>'}`;
  }

  if (k === 'resume') {
    const r = a.resume;
    if (!r) {
      return `<div class="empty"><h3>Add your resume to see the gaps</h3>
        Prepify checks which of the JD's skills your resume shows, which are missing, and what to prepare for each.
        <div><button class="btn primary" data-jd-resume>Add resume</button></div></div>`;
    }
    const pill = (n, cls) => `<span class="chip-btn ${cls || ''}">${esc(n)}</span>`;
    return `
      <div class="jd-grid">
        <section class="jd-card score-card">
          <div class="score ${r.score >= 70 ? 'good' : r.score >= 40 ? 'mid' : 'low'}">${r.score ?? 0}<small>%</small></div>
          <p>of the required skills appear on your resume.</p>
          <p class="note">A keyword check, not a judgement: if you have a skill but it isn't on your resume, add it.</p>
        </section>
        <section class="jd-card">
          <h3>On your resume</h3>
          <div class="chips static">${r.matched.map(n => pill(n, 'ok')).join('') || '<span class="muted">None of the JD\'s skills.</span>'}</div>
          ${r.extra.length ? `<h3 class="mt">Also on your resume</h3><div class="chips static">${r.extra.map(n => pill(n)).join('')}</div>` : ''}
        </section>
      </div>
      ${r.missing_required.length ? `<section class="section">
        <h2>Required but missing</h2>
        <p class="sub">Expect questions on these. Either prepare the basics or have an honest answer about adjacent experience.</p>
        <div class="plan-list">${r.missing_required.map(n => {
          const s = a.skills.find(x => x.name === n) || { topics: [] };
          return `<div class="gap-card"><b>${esc(n)}</b><span>${s.topics.slice(0, 4).map(esc).join(' · ')}</span></div>`;
        }).join('')}</div></section>` : ''}
      ${r.missing_preferred.length ? `<section class="section"><h2>Nice to have, not on your resume</h2>
        <div class="chips static">${r.missing_preferred.map(n => pill(n)).join('')}</div></section>` : ''}
      ${r.matched.length ? `<section class="section"><h2>Talking points</h2>
        <p class="sub">For each skill you share with the JD, prepare one concrete example: what you built, the decision you made and the result.</p>
        ${jdList(r.matched.slice(0, 8).map(n => `${n}: where did you use it, and what would you do differently now?`))}</section>` : ''}
      <button class="btn" data-jd-resume>Update resume</button>`;
  }

  // ask
  return `
    <section class="section">
      <h2>Questions to ask the interviewer</h2>
      <p class="sub">Built from this JD. Asking two or three thoughtful ones at the end makes a difference.</p>
      <ol class="xp-questions">${a.ask.map(q => `<li><span>${esc(q)}</span></li>`).join('')}</ol>
    </section>
    ${a.keywords.length ? `<section class="section">
      <h2>Keywords for your resume</h2>
      <p class="sub">The JD's main skills, most mentioned first. Applicant tracking systems often look for these words.</p>
      <div class="chips static">${a.keywords.map(n => `<span class="chip-btn">${esc(n)}</span>`).join('')}</div>
    </section>` : ''}`;
}

function wireJdTab(k, d) {
  if (k === 'skills') {
    $$('#tab-body [data-level].chip-btn').forEach(b => b.onclick = () => {
      const lvl = b.dataset.level;
      $$('#tab-body .chip-btn[data-level]').forEach(x => x.classList.toggle('active', x === b));
      $$('#tab-body .skill-card').forEach(c => c.classList.toggle('hidden', !!lvl && c.dataset.level !== lvl));
      $$('#tab-body .skill-cat').forEach(sec => sec.classList.toggle('hidden', !sec.querySelector('.skill-card:not(.hidden)')));
    });
  }
  if (k === 'plan') {
    $$('#tab-body [data-done]').forEach(cb => cb.onchange = () => {
      const jd = jdNow();
      if (cb.checked) jd.done[cb.dataset.done] = true; else delete jd.done[cb.dataset.done];
      saveStore();
      const item = cb.closest('.plan-item');
      const boxes = item.querySelectorAll('[data-done]');
      item.querySelector('.plan-count').textContent = `${[...boxes].filter(x => x.checked).length}/${boxes.length}`;
      const prog = planProgress(d);
      $('.plan-progress .bar span').style.width = (prog.total ? Math.round(100 * prog.done / prog.total) : 0) + '%';
      $('.plan-progress b').textContent = prog.done;
      const tabCount = $('.tabs .tab[data-tab="plan"] span');
      if (tabCount) tabCount.textContent = `${prog.done}/${prog.total}`;
    });
    const reset = $('[data-plan-reset]');
    if (reset) reset.onclick = () => { jdNow().done = {}; saveStore(); renderJdPage(d); };
  }
  const pull = $('[data-jd-pull]');
  if (pull) pull.onclick = () => signedIn() ? pullSources(companyName(d)) : openSignin();
  $$('[data-jd-resume]').forEach(b => b.onclick = () => {
    openJdModal('input');
    const jd = jdNow();
    if (jd && jd.text) $('#jd-text').value = jd.text;
    const det = $('#jd-modal .resume-opt');
    if (det) det.open = true;
    if (jd && !jd.text) {
      $('#jd-error').textContent = 'The JD was uploaded as a file, so upload it again along with your resume.';
      $('#jd-error').classList.remove('hidden');
    }
  });
}

// ---------- small pieces used by the results pages ----------
function jdBanner(d) {
  const jd = jdNow();
  if (!jd) {
    return `<div class="jd-banner empty-jd">
      <div><b>Got the job description?</b> Add it to see the skills it asks for, the rounds you'll probably face,
        a prep plan, and which of these questions match it.</div>
      <button class="btn small" data-jd-add>Add job description</button>
    </div>`;
  }
  const a = jd.analysis;
  const qs = pulledQuestions(d);
  const matched = qs.filter(q => jdSkillsIn(q.text).length).length;
  const prog = planProgress(d);
  return `<button class="jd-banner" data-jd-open type="button">
      <span class="mark" style="--c:var(--purple)">JD</span>
      <span class="jd-banner-text">
        <b>${esc(jd.role || a.title || 'Job description')}${jd.company ? ` · ${esc(jd.company)}` : ''}</b>
        <span>${plural(a.skills.filter(s => s.level === 'required').length, 'required skill')} · ${plural(a.rounds.length, 'likely round')}
          ${qs.length ? ` · ${matched} of ${plural(qs.length, 'pulled question')} match` : ''}${prog.total ? ` · plan ${prog.done}/${prog.total}` : ''}${a.resume ? ` · resume ${a.resume.score ?? 0}%` : ''}</span>
      </span>
      <span class="glance-open">Open analysis →</span>
    </button>`;
}

function wireJdBanner(d) {
  $$('[data-jd-add]').forEach(b => b.onclick = () => openJdModal('input'));
  $$('[data-jd-open]').forEach(b => b.onclick = () => { go(d.query, true, 'JD'); window.scrollTo(0, 0); });
}

function jdPanelHtml() {
  const jd = jdNow();
  if (!jd) return `
    <div class="panel-sep"></div>
    <h3>Job description</h3>
    <p class="note">Add the JD for a skills breakdown, likely rounds, a prep plan and a resume check.</p>
    <button class="btn" data-jd-add>Add job description</button>`;
  return `
    <div class="panel-sep"></div>
    <h3>Job description</h3>
    <div class="kind">${esc(jd.role || jd.analysis.title || 'Role')}${jd.company ? ' · ' + esc(jd.company) : ''}</div>
    <button class="btn" data-jd-open>Open JD analysis</button>
    <button class="linkbtn" data-jd-add>Replace</button>
    <button class="linkbtn" data-jd-remove>Remove</button>`;
}

function wireJdPanel(d) {
  wireJdBanner(d);
  $$('[data-jd-remove]').forEach(b => b.onclick = () => { delete store.jd; saveStore(); rerender(); });
}

// tags on question cards: which JD skills a question touches
function jdTagsHtml(text) {
  const hits = jdSkillsIn(text).slice(0, 2);
  return hits.map(n => `<span class="tag jd">JD · ${esc(n)}</span>`).join('');
}

// ---------- PDF section ----------
function writeJdPdf(api, d) {
  const { write, writeRich, rule, ensure, accent, muted } = api;
  const jd = jdNow();
  if (!jd) return;
  const a = jd.analysis;
  const f = a.facts || {};
  write('Job description analysis', { size: 16, bold: true, color: accent, after: 6 });
  write(`${jd.role || a.title || 'Role'}${jd.company ? ' at ' + jd.company : ''}`, { size: 12, bold: true, after: 4 });
  const facts = [['Seniority', a.seniority], ['Experience', a.experience && a.experience.label], ['Work mode', f.work_mode],
    ['Employment', f.employment], ['Location', (f.locations || []).join(', ')], ['Salary in the JD', f.salary],
    ['Education', (f.education || []).join(' ')], ['Academic cut-off', f.academic_cutoff], ['Bond', f.bond], ['Shifts', f.shifts]]
    .filter(([, v]) => v);
  facts.forEach(([k, v]) => write(`${k}: ${v}`, { size: 9, color: muted, indent: 6, after: 1 }));
  ensure(30); write('', { after: 4 });

  if ((a.watch_outs || []).length) {
    write('Worth checking', { size: 13, bold: true, after: 4 });
    a.watch_outs.forEach(w => write('- ' + w, { indent: 6, after: 2 }));
    write('', { after: 2 });
  }

  write('Skills', { size: 13, bold: true, after: 4 });
  ['required', 'expected', 'preferred'].forEach(l => {
    const names = a.skills.filter(s => s.level === l).map(s => s.name);
    if (names.length) write(`${JD_LEVEL[l]}: ${names.join(', ')}`, { indent: 6, after: 3 });
  });
  ensure(30); write('', { after: 2 });

  write('Likely interview rounds (predicted from the JD)', { size: 13, bold: true, after: 4 });
  a.rounds.forEach((r, i) => {
    write(`${i + 1}. ${r.name}`, { bold: true, indent: 6, after: 1 });
    write(r.why, { size: 9, color: muted, indent: 20, after: 1 });
    writeRich(null, r.focus.map(x => '- ' + x).join('\n'), { indent: 14 });
  });

  const { tiers } = jdPlan(d);
  if (tiers.length) {
    ensure(40);
    write('Prep plan', { size: 13, bold: true, after: 4 });
    tiers.forEach(([tier, items]) => {
      write(tier, { size: 11, bold: true, color: accent, indent: 6, after: 3 });
      items.forEach(s => {
        ensure(30);
        write(`${s.name} (${JD_LEVEL[s.level]}${s.reported.length ? `, asked in ${plural(s.reported.length, 'pulled question')}` : ''})`, { bold: true, indent: 14, after: 1 });
        write('Revise: ' + s.topics.map(t => (jd.done[`${s.name}|${t}`] ? '[x] ' : '[ ] ') + t).join('   '), { size: 9, indent: 24, after: 2 });
        s.reported.slice(0, 3).forEach(q => write('Asked: ' + q.text, { size: 9, indent: 24, after: 1 }));
        s.questions.forEach(q => write('Practise: ' + q, { size: 9, color: muted, indent: 24, after: 1 }));
        write('', { after: 2 });
      });
    });
  }

  if (a.resume) {
    ensure(40);
    write(`Resume match: ${a.resume.score ?? 0}% of required skills`, { size: 13, bold: true, after: 4 });
    if (a.resume.matched.length) write('On your resume: ' + a.resume.matched.join(', '), { indent: 6, after: 2 });
    if (a.resume.missing_required.length) write('Required but missing: ' + a.resume.missing_required.join(', '), { indent: 6, after: 2 });
    if (a.resume.missing_preferred.length) write('Nice to have, missing: ' + a.resume.missing_preferred.join(', '), { indent: 6, after: 2 });
  }

  ensure(40);
  write('Questions to ask the interviewer', { size: 13, bold: true, after: 4 });
  a.ask.forEach((q, i) => write(`${i + 1}. ${q}`, { indent: 6, after: 2 }));
  rule();
}

// home page button
document.addEventListener('DOMContentLoaded', () => {
  const b = document.getElementById('home-jd');
  if (b) b.onclick = () => openJdModal('input');
});
