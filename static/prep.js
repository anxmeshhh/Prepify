/* Prepify: prep content (part B).
   - Company brief: how the company interviews, written by AI from the pulled experiences, a source on every point.
   - Model answers: AI-written answers for questions that came without one, clearly labelled.
   - Resume coach: a deeper resume match; the resume is sent only when the user asks for this.
   - Prep schedule: a day-by-day plan up to the interview date. Built here in the browser, no AI, no tokens.
   Every AI action runs only on a click, shows its rough cost first, and is kept in the tab so it's never paid twice.
   Uses helpers from search.js, jd.js and ai.js at call time. */

// Typical token cost of each action, for the labels on the buttons (the server enforces the real budget).
const AI_COST = { brief: 2500, answer: 500, answerBase: 400, resume: 2500 };   // measured on Groq, rounded up
const fmtTokens = (n) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}K` : String(n);
const costLabel = (n) => `~${fmtTokens(n)} tokens`;

function aiEntry() {
  const k = aiCompanyKey();
  const c = k && store.companies[k];
  if (!c) return null;
  c.ai = c.ai || { tags: {} };
  return c;
}

// The button for an AI action: runs it when AI assist is on, otherwise offers to turn AI assist on.
function aiActionButton(attr, label, cost, cls = 'btn') {
  if (!signedIn() || !aiAvailable() || aiPref() === 'off') return '';     // turned off on purpose: no offers
  if (!aiOn()) return `<button class="${cls}" type="button" data-ai-turn-on>Turn on AI assist to ${label.charAt(0).toLowerCase() + label.slice(1)}</button>`;
  const left = auth.ai && auth.ai.tokens && auth.ai.tokens.user_left;
  const short = left !== undefined && left !== null && left < cost * 1.5;
  return `<button class="${cls}" type="button" ${attr} ${short ? 'disabled title="Not enough of today\'s AI budget left"' : ''}>${esc(label)} <span class="cost">· ${costLabel(cost)}</span></button>`;
}

function wireAiTurnOn() {
  $$('[data-ai-turn-on]').forEach(b => b.onclick = () => openAiConsent());
}

async function aiPost(url, body) {
  try {
    const r = await getJson(url, { method: 'POST', body: JSON.stringify(body) });
    aiNoteStatus(r.ai);
    return r;
  } catch (e) {
    aiNoteStatus(e.body && e.body.ai);
    throw e;
  }
}

function busyButton(btn, text) {
  if (!btn) return () => {};
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>${esc(text)}`;
  return () => { btn.disabled = false; btn.innerHTML = html; };
}

// =====================================================================================================
// Company brief
// =====================================================================================================
function briefInput(d) {
  const refs = {};
  const xs = [...(d.experiences || [])].sort(byDateDesc).slice(0, 40).map((x, i) => {
    const id = 'X' + (i + 1);
    const text = [x.application && 'Applied: ' + x.application, x.process,
      ...(x.rounds || []).map(r => `${r.name}${r.detail ? ': ' + r.detail : ''}`),
      (x.questions || []).length ? 'Asked: ' + x.questions.map(q => q.text).join(' | ') : '',
      x.tips && 'Tips: ' + x.tips].filter(Boolean).map(tidyText).join('\n');
    refs[id] = { src: x.source, tab: 'experiences', label: [x.source, x.date, cleanRole(x.role)].filter(Boolean).join(' · ') };
    return { id, source: x.source, role: cleanRole(x.role), date: x.date || '', outcome: x.outcome || '', text };
  });
  const qs = pulledQuestions(d).slice(0, 80).map((q, i) => {
    const id = 'Q' + (i + 1);
    const src = [...q.sources][0];
    refs[id] = { src, tab: 'questions', label: `${q.text} (${[...q.sources].join(', ')})` };
    return { id, text: q.text, sources: [...q.sources] };
  });
  return { experiences: xs, questions: qs, refs };
}

function briefCounts(d) {
  return { x: (d.experiences || []).length, q: pulledQuestions(d).length };
}

function briefHtml(d) {
  const c = aiEntry();
  if (!c || !signedIn() || !aiAvailable()) return '';
  if (aiPref() === 'off' && !(c.ai && c.ai.brief)) return '';
  const counts = briefCounts(d);
  if (!counts.x && !counts.q) return '';
  const name = companyName(d);
  const b = c.ai.brief;
  if (!b) {
    return `<section class="section brief" id="brief">
      <h2>Company brief</h2>
      <p class="sub">How ${esc(name)} interviews, summarised by AI from the ${plural(counts.x, 'experience')} and
        ${plural(counts.q, 'question')} you pulled, with a source on every point.</p>
      ${aiActionButton('data-brief-make', 'Write the brief', AI_COST.brief)}
    </section>`;
  }
  const a = b.data;
  const cite = (ids) => (ids || []).map(id => {
    const r = b.refs[id];
    return r ? `<button class="cite" type="button" data-cite="${esc(id)}" title="${esc(r.label)}">${esc(id)}</button>` : '';
  }).join('');
  const stale = counts.x !== b.counts.x || counts.q !== b.counts.q;
  return `<section class="section brief" id="brief">
    <div class="section-head">
      <h2>Company brief <span class="tag ai">AI</span></h2>
      <button class="btn small" type="button" data-pdf="BRIEF">Download brief PDF</button>
    </div>
    ${a.overview ? `<p class="brief-overview">${esc(a.overview)}</p>` : ''}
    <div class="brief-grid">
      ${a.process.length ? `<div class="jd-card"><h3>How the process usually goes</h3>
        <ol class="jd-steps brief-list">${a.process.map(p => `<li><b>${esc(p.step)}</b> ${esc(p.detail)} ${cite(p.sources)}</li>`).join('')}</ol></div>` : ''}
      ${a.focus.length ? `<div class="jd-card"><h3>What they ask most</h3>
        <ul class="jd-list brief-list">${a.focus.map(p => `<li><b>${esc(p.topic)}</b> ${esc(p.detail)} ${cite(p.sources)}</li>`).join('')}</ul></div>` : ''}
    </div>
    ${a.tips.length ? `<h3 class="brief-h">Tips from candidates</h3>
      <ul class="jd-list brief-list">${a.tips.map(p => `<li>${esc(p.tip)} ${cite(p.sources)}</li>`).join('')}</ul>` : ''}
    <p class="brief-foot">${a.caveat ? esc(a.caveat) + ' ' : ''}Written by ${esc(a.model_name || 'AI')} on ${fmtDate(b.at)} from
      ${plural(a.based_on.experiences, 'experience')} and ${plural(a.based_on.questions, 'question')}. Click a source code to open it.
      ${stale ? `<span class="brief-stale">New data has been pulled since.</span> ${aiActionButton('data-brief-make', 'Update the brief', AI_COST.brief, 'linkbtn accent')}` : ''}</p>
  </section>`;
}

function hasBrief() {
  const c = aiEntry();
  return !!(c && c.ai && c.ai.brief);
}

function wireBrief(d) {
  wireAiTurnOn();
  $$('[data-brief-make]').forEach(btn => btn.onclick = async () => {
    const c = aiEntry();
    const input = briefInput(d);
    const done = busyButton(btn, 'Writing the brief…');
    try {
      const r = await aiPost('/api/ai/brief', { company: companyName(d), role: d.parsed.role || '',
                                                 experiences: input.experiences, questions: input.questions });
      c.ai.brief = { data: r, refs: input.refs, counts: briefCounts(d), at: new Date().toISOString() };
      saveStore();
      rerender();
    } catch (e) {
      done();
      toast(`The brief wasn't written: ${e.message}`);
    }
  });
  $$('[data-cite]').forEach(b => b.onclick = () => {
    const c = aiEntry();
    const r = c && c.ai.brief && c.ai.brief.refs[b.dataset.cite];
    if (r && r.src) openSource(r.src, r.tab);
  });
}

// =====================================================================================================
// Model answers
// =====================================================================================================
function aiAnswerFor(q) {
  const c = aiEntry();
  return c && c.ai.answers ? c.ai.answers[qKey(q)] : null;
}

function aiAnswerHtml(a, site) {
  return `<div class="answer ai-answer">
    <div class="a-label">AI-written model answer · not from ${esc(site || 'the source')}</div>
    ${richText(a.answer)}
    ${a.code ? `<pre class="code">${esc(a.code)}</pre>` : ''}
    ${(a.key_points || []).length || (a.follow_ups || []).length ? `<details class="ai-more"><summary>What the interviewer listens for</summary>
      ${(a.key_points || []).length ? `<ul class="jd-list">${a.key_points.map(k => `<li>${esc(k)}</li>`).join('')}</ul>` : ''}
      ${(a.follow_ups || []).length ? `<div class="xp-label">Likely follow-ups</div><ul class="jd-list">${a.follow_ups.map(k => `<li>${esc(k)}</li>`).join('')}</ul>` : ''}
    </details>` : ''}
  </div>`;
}

// Under a question card with no answer: the AI answer if there is one, or the button to write it.
function aiAnswerBlock(q, site) {
  const a = aiAnswerFor(q);
  if (a) return aiAnswerHtml(a, site);
  return aiActionButton(`data-ai-answer="${esc(qKey(q))}" data-q="${esc(q.text)}"`, 'Write a model answer',
                        AI_COST.answerBase + AI_COST.answer, 'linkbtn accent');
}

// "Write answers for the unanswered ones", five at a time.
function aiAnswerBatchButton(qs) {
  const todo = qs.filter(q => !(q.answers || []).length && !aiAnswerFor(q));
  if (todo.length < 2) return '';
  const n = Math.min(todo.length, 5);
  return aiActionButton('data-ai-answer-batch', `Write model answers for ${n} unanswered`, AI_COST.answerBase + AI_COST.answer * n);
}

async function writeAnswers(items, btn) {
  const c = aiEntry();
  if (!c || !items.length) return;
  const done = busyButton(btn, items.length > 1 ? `Writing ${items.length} answers…` : 'Writing…');
  try {
    const r = await aiPost('/api/ai/answers', { company: c.name, role: (lastData && lastData.parsed.role) || '',
                                                items: items.map((q, i) => ({ id: 'a' + i, text: q.text })) });
    c.ai.answers = c.ai.answers || {};
    (r.items || []).forEach(it => {
      const q = items[+it.id.slice(1)];
      if (q) c.ai.answers[q.key] = { answer: it.answer, code: it.code, key_points: it.key_points, follow_ups: it.follow_ups,
                                      model_name: r.model_name, at: new Date().toISOString() };
    });
    if ((r.flagged || []).length) toast("Some questions looked like instructions aimed at an AI, so they weren't sent.");
    saveStore();
    rerender();
  } catch (e) {
    done();
    toast(`No answer written: ${e.message}`);
  }
}

function wireAiAnswers() {
  wireAiTurnOn();
  $$('[data-ai-answer]').forEach(b => b.onclick = () => writeAnswers([{ key: b.dataset.aiAnswer, text: b.dataset.q }], b));
  $$('[data-ai-answer-batch]').forEach(b => b.onclick = () => {
    const items = [...$$('[data-ai-answer]')].filter(x => !x.closest('.hidden')).slice(0, 5)
      .map(x => ({ key: x.dataset.aiAnswer, text: x.dataset.q }));
    writeAnswers(items, b);
  });
}

// =====================================================================================================
// Resume coach (JD page, Resume match tab)
// =====================================================================================================
function strHash(t) {
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
  return String(h);
}
const resumeHash = (jd) => strHash((jd.resumeText || '') + '|' + (jd.analysis.title || '') + '|' + jd.analysis.skills.length);

function resumeCoachHtml() {
  const jd = jdNow();
  if (!jd || !signedIn() || !aiAvailable()) return '';
  if (aiPref() === 'off' && !jd.aiResume) return '';
  const r = jd.aiResume;
  if (!jd.resumeText) {
    return `<section class="section coach"><h2>Deeper match with AI</h2>
      <p class="sub">Add your resume (Update resume) to get talking points, interview stories from your own experience and sharper resume lines.</p></section>`;
  }
  if (!r) {
    return `<section class="section coach">
      <h2>Deeper match with AI</h2>
      <p class="sub">Talking points for each skill you share with the JD, interview stories built from your own experience,
        sharper resume lines, and an honest plan for the gaps.</p>
      <p class="coach-privacy">This sends your resume and the JD's skills to ${esc(aiProvider())} once. Nothing is stored.</p>
      ${aiActionButton('data-coach-make', 'Get the deeper match', AI_COST.resume, 'btn primary')}
    </section>`;
  }
  const a = r.data;
  const stale = r.hash !== resumeHash(jd);
  return `<section class="section coach">
    <h2>Deeper match with AI <span class="tag ai">AI</span></h2>
    ${a.fit_summary ? `<p class="brief-overview">${esc(a.fit_summary)}</p>` : ''}
    ${a.talking_points.length ? `<h3 class="brief-h">Talking points</h3>
      <div class="coach-grid">${a.talking_points.map(t => `<div class="jd-card"><b>${esc(t.skill)}</b><p>${esc(t.point)}</p>
        <p class="evidence">From your resume: “${esc(t.evidence)}”</p></div>`).join('')}</div>` : ''}
    ${a.stories.length ? `<h3 class="brief-h">Stories to prepare</h3>
      <div class="plan-list">${a.stories.map(s => `<details class="plan-item"><summary><b>${esc(s.question)}</b></summary>
        <div class="plan-body"><dl class="star">
          <dt>Situation</dt><dd>${esc(s.situation)}</dd><dt>Task</dt><dd>${esc(s.task)}</dd>
          <dt>Action</dt><dd>${esc(s.action)}</dd><dt>Result</dt><dd>${esc(s.result)}</dd></dl>
          <p class="evidence">Built on: “${esc(s.evidence)}”</p></div></details>`).join('')}</div>` : ''}
    ${a.rewrites.length ? `<h3 class="brief-h">Sharper resume lines</h3>
      <div class="plan-list">${a.rewrites.map(w => `<div class="rewrite"><div class="before">${esc(w.before)}</div>
        <div class="after">${esc(w.after)}</div><div class="why">${esc(w.why)}</div></div>`).join('')}</div>` : ''}
    ${a.gaps.length ? `<h3 class="brief-h">Plan for the gaps</h3>
      <div class="plan-list">${a.gaps.map(g => `<div class="gap-card"><b>${esc(g.skill)}</b><span>${esc(g.plan)}</span></div>`).join('')}</div>` : ''}
    <p class="brief-foot">Written by ${esc(a.model_name || 'AI')} on ${fmtDate(r.at)} from your resume. Quotes are checked against your resume.
      ${stale ? `<span class="brief-stale">Your resume or JD changed since.</span> ${aiActionButton('data-coach-make', 'Run it again', AI_COST.resume, 'linkbtn accent')}` : ''}</p>
  </section>`;
}

function wireResumeCoach(d) {
  wireAiTurnOn();
  $$('[data-coach-make]').forEach(btn => btn.onclick = async () => {
    const jd = jdNow();
    const a = jd.analysis;
    const done = busyButton(btn, 'Reading your resume…');
    try {
      const r = await aiPost('/api/ai/resume', {
        jd: { title: jd.role || a.title, company: jd.company || a.company,
              skills: a.skills.filter(s => s.level !== 'mentioned').map(s => ({ name: s.name, level: s.level })),
              responsibilities: a.responsibilities },
        resume_text: jd.resumeText });
      jd.aiResume = { data: r, hash: resumeHash(jd), at: new Date().toISOString() };
      saveStore();
      renderJdPage(d);
    } catch (e) {
      done();
      toast(`The deeper match didn't run: ${e.message}`);
    }
  });
}

// =====================================================================================================
// Prep schedule: day by day up to the interview (no AI)
// =====================================================================================================
const DAY_MS = 86400000;
const TASK_HOURS = { topic: 0.5, practice: 1, stories: 1, mock: 2, final: 1.5 };
const dayStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function scheduleTasks(d) {
  const jd = jdNow();
  const { tiers } = jdPlan(d);
  const tasks = [];
  tiers.forEach(([tier, items]) => items.forEach(s => {
    s.topics.forEach(t => tasks.push({ key: `${s.name}|${t}`, text: `${s.name}: ${t}`, hours: TASK_HOURS.topic, tier }));
    if (s.reported.length) {
      tasks.push({ key: `practice|${s.name}`, hours: TASK_HOURS.practice, tier,
                   text: `Practise the ${plural(s.reported.length, 'question')} asked at ${companyName(d) || 'the company'} on ${s.name}` });
    }
  }));
  const stories = { key: 'stories', hours: TASK_HOURS.stories, tier: 'Must cover',
                    text: `Prepare STAR stories: tell me about yourself, why ${jd.company || 'this company'}, a project you're proud of, a failure` };
  // behavioural prep goes after the "Must cover" topics, before the rest
  const at = tasks.findIndex(t => t.tier !== 'Must cover');
  tasks.splice(at < 0 ? tasks.length : at, 0, stories);
  return tasks;
}

function buildSchedule(d) {
  const jd = jdNow();
  const s = jd.schedule;
  if (!s || !s.date) return null;
  const today = dayStart(new Date());
  const interview = dayStart(s.date + 'T00:00:00');
  const days = Math.round((interview - today) / DAY_MS);
  if (days < 1) return { past: days < 0, today: days === 0, days: [] };
  const hours = Math.max(1, Math.min(8, +s.hours || 2));
  const open = scheduleTasks(d).filter(t => !jd.done[t.key]);        // unfinished work moves forward each day
  const plan = [];
  for (let i = 0; i < days; i++) plan.push({ date: new Date(+today + i * DAY_MS), tasks: [], hours: 0 });
  const last = plan[plan.length - 1];
  if (!jd.done.final) { last.tasks.push({ key: 'final', hours: TASK_HOURS.final, text: 'Light revision only, your questions for the interviewer, and the logistics (time, place or link, documents)' }); last.hours += TASK_HOURS.final; }
  if (days >= 3 && !jd.done.mock) {
    const m = plan[plan.length - 2];
    m.tasks.push({ key: 'mock', hours: TASK_HOURS.mock, text: 'Mock interview: one technical and one behavioural round, timed, out loud' });
    m.hours += TASK_HOURS.mock;
  }
  // the day before keeps half its time free; mock and final already take their share
  const cap = (p) => Math.max(0, hours * (p === last ? 0.5 : 1) - p.hours);
  const caps = plan.map(cap);
  const work = open.reduce((n, t) => n + t.hours, 0);
  const free = caps.reduce((n, c) => n + c, 0);
  const share = Math.min(1, work / Math.max(free, 0.5));    // use the same share of every day: no front-loading
  const left = [...open];
  const place = (p, room) => {
    while (left.length && left[0].hours <= room + 1e-9) {
      const t = left.shift();
      p.tasks.push(t);
      p.hours += t.hours;
      room -= t.hours;
    }
  };
  plan.forEach((p, i) => place(p, caps[i] * share));               // pass 1: spread evenly, most important first
  plan.forEach((p, i) => place(p, cap(p)));                         // pass 2: whatever is left, into spare time
  return { days: plan, unscheduled: left, hours, total: days };
}

function scheduleHtml(d) {
  const jd = jdNow();
  const s = jd.schedule || {};
  const minDate = isoDay(new Date(Date.now() + DAY_MS));
  const sch = buildSchedule(d);
  const label = (date, i) => i === 0 ? 'Today' : i === 1 ? 'Tomorrow'
    : date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  let body = '';
  if (sch && sch.days.length) {
    body = `<div class="sched">${sch.days.map((p, i) => `
      <div class="sched-day ${i === 0 ? 'today' : ''}">
        <div class="sched-head"><b>${esc(label(p.date, i))}</b><span>${p.tasks.length ? `${p.hours.toFixed(1).replace(/\.0$/, '')} h` : 'Rest or revise'}</span></div>
        ${p.tasks.length ? `<ul class="checklist sched-list">${p.tasks.map(t => `<li><label><input type="checkbox" data-done="${esc(t.key)}" ${jd.done[t.key] ? 'checked' : ''} /> ${esc(t.text)}</label></li>`).join('')}</ul>` : ''}
      </div>`).join('')}</div>
      ${sch.unscheduled.length ? (() => {
        const must = sch.unscheduled.filter(t => t.tier === 'Must cover').length;
        const need = Math.ceil((sch.days.reduce((n, p) => n + p.hours, 0) + sch.unscheduled.reduce((n, t) => n + t.hours, 0)) / sch.total);
        return `<p class="notice"><b>${plural(sch.unscheduled.length, 'item')} didn't fit</b> in ${sch.hours} h a day${must ? `, including ${must} you must cover` : ', all of them lower priority'}.
          About ${need} h a day would fit everything; the plan already puts the most important first.</p>`;
      })() : ''}`;
  } else if (sch && sch.today) {
    body = '<p class="notice"><b>The interview is today.</b> Skim your notes, read your questions for the interviewer and keep calm.</p>';
  } else if (sch && sch.past) {
    body = '<p class="sub">That date has passed. Pick the next interview date.</p>';
  }
  return `<section class="section schedule">
    <h2>Schedule up to the interview</h2>
    <p class="sub">A day-by-day plan from the topics below, most important first, with a mock interview two days before and light revision the day before.
      Unfinished topics move forward each day. Made in your browser, no AI.</p>
    <form class="sched-form" id="sched-form">
      <label>Interview date<input type="date" id="sched-date" name="interview-date" autocomplete="off" min="${minDate}" value="${esc(s.date || '')}" required /></label>
      <label>Hours a day<select id="sched-hours" name="hours">${[1, 2, 3, 4, 5, 6].map(h => `<option ${+(s.hours || 2) === h ? 'selected' : ''}>${h}</option>`).join('')}</select></label>
      <button class="btn small primary" type="submit">${sch ? 'Update schedule' : 'Make schedule'}</button>
      ${sch ? '<button class="linkbtn danger" type="button" data-sched-clear>Remove</button>' : ''}
    </form>
    ${body}
  </section>`;
}

function wireSchedule(d) {
  const f = $('#sched-form');
  if (!f) return;
  f.onsubmit = (e) => {
    e.preventDefault();
    jdNow().schedule = { date: $('#sched-date').value, hours: +$('#sched-hours').value };
    saveStore();
    renderJdPage(d);
  };
  const clear = $('[data-sched-clear]');
  confirmClick(clear, () => { delete jdNow().schedule; saveStore(); renderJdPage(d); });
}

