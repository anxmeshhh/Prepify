/* Prepify: practice (part C).
   - Practise a question: write your answer and get feedback the way the interviewer would give it (a verdict
     and score, what worked, what to fix, a stronger answer and the likely follow-up). From any question card.
   - Mock interview: five of the pulled questions, mixed across subjects, one at a time, then a summary.
   - Ask about your results: a question answered only from the experiences and questions you pulled, with a
     source on every point.
   AI runs only when you click, with its rough cost shown, and the server never charges twice for the same
   request. Feedback and answers are kept in this tab. Uses helpers from search.js, ai.js, prep.js and jd.js. */

Object.assign(AI_COST, { feedback: 1000, ask: 3000 });     // measured on Groq (about 860 and 2,800), rounded up
const MOCK_SIZE = 5;
const ASK_KEEP = 5;
const practice = { mock: null };

// ---------- where practice can start ----------
const practiceReady = () => signedIn() && aiAvailable() && aiPref() !== 'off';

function practiseButton(q) {
  if (!practiceReady()) return '';
  return `<button class="linkbtn accent" type="button" data-practise="${esc(qKey(q))}" data-q="${esc(q.text)}">Practise answering</button>`;
}

function findPulled(key, text) {
  const all = pulledQuestions(lastData);
  return all.find(x => qKey(x) === key) || all.find(x => norm(x.text) === norm(text || '')) || { text, answers: [], sources: new Set() };
}

// ---------- the practice dialog ----------
function closePractice() {
  const el = $('#practice-modal');
  if (el) el.remove();
}

function openPractice(q) {
  if (!signedIn()) { openSignin(); return; }
  if (!aiAvailable()) { openGroqKey(false); return; }
  if (!aiOn()) { openAiConsent(() => openPractice(q)); return; }
  const c = aiEntry();
  if (!c) return;
  c.ai.practice = c.ai.practice || {};
  const key = qKey(q);
  const saved = c.ai.practice[key];
  const m = practice.mock;
  closePractice();
  const el = document.createElement('div');
  el.id = 'practice-modal';
  el.className = 'modal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'practice-title');
  const sources = q.sources && q.sources.size ? [...q.sources].join(' + ') : '';
  el.innerHTML = `
    <div class="modal-box practice-box">
      <div class="welcome-head">
        <span class="mark big" style="--c:var(--accent)">${m ? `${m.i + 1}` : 'Q'}</span>
        <div>
          <p class="modal-sub">${m ? `Mock interview · question ${m.i + 1} of ${m.qs.length}` : 'Practise this question'}${sources ? ` · asked on ${esc(sources)}` : ''}</p>
          <h2 id="practice-title">${esc(q.text)}</h2>
        </div>
      </div>
      <div class="field">
        <label for="practice-answer">Your answer</label>
        <textarea id="practice-answer" rows="7" maxlength="4000" placeholder="Answer the way you would in the interview…">${esc((saved && saved.answer) || '')}</textarea>
      </div>
      <p class="modal-note">The feedback judges only what you write, the way this interviewer would. Change your answer and ask again to see it improve.</p>
      <div class="form-error hidden" id="practice-error" role="alert"></div>
      <div class="login-actions">
        <button class="btn primary" type="button" data-practice-go>Get feedback <span class="cost">· ${costLabel(AI_COST.feedback)}</span></button>
        ${m ? '<button class="btn" type="button" data-practice-skip>Skip</button>' : ''}
        <button class="linkbtn" type="button" data-practice-close>${m ? 'End the mock interview' : 'Close'}</button>
      </div>
      <div id="practice-result">${saved && saved.feedback ? feedbackHtml(saved.feedback, !!m) : ''}</div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', (e) => { if (e.target === el && !m) closePractice(); });
  const box = el.querySelector('#practice-answer');
  box.addEventListener('input', () => { c.ai.practice[key] = { ...(c.ai.practice[key] || {}), answer: box.value }; saveStore(); });
  el.querySelector('[data-practice-close]').onclick = () => (m ? finishMock() : closePractice());
  const skip = el.querySelector('[data-practice-skip]');
  if (skip) skip.onclick = () => nextMock(null);
  el.querySelector('[data-practice-go]').onclick = (e) => getFeedback(q, key, e.currentTarget);
  wireFeedback(q);
  setTimeout(() => box.focus(), 0);
}

async function getFeedback(q, key, btn) {
  const c = aiEntry();
  const answer = $('#practice-answer').value.trim();
  const err = $('#practice-error');
  err.classList.add('hidden');
  if (answer.length < 3) { err.textContent = 'Write your answer first.'; err.classList.remove('hidden'); return; }
  const done = busyButton(btn, 'Reading your answer…');
  try {
    const r = await aiPost('/api/ai/feedback', { company: c.name, role: (lastData && lastData.parsed.role) || '',
                                                question: q.text, answer, reference: (q.answers || [])[0] || '' });
    c.ai.practice[key] = { answer, feedback: r, at: new Date().toISOString() };
    saveStore();
    if (practice.mock) practice.mock.results[practice.mock.i] = { q: q.text, key, verdict: r.verdict, score: r.score };
    $('#practice-result').innerHTML = feedbackHtml(r, !!practice.mock);
    wireFeedback(q);
    $('#practice-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
  }
  done();
}

const VERDICT_CLASS = { Strong: 'strong', Good: 'good', 'Needs work': 'weak' };

function feedbackHtml(f, inMock) {
  const last = practice.mock && practice.mock.i >= practice.mock.qs.length - 1;
  return `<div class="feedback" role="status">
    <div class="fb-top">
      <span class="verdict ${VERDICT_CLASS[f.verdict] || 'weak'}">${esc(f.verdict)}</span>
      <span class="fb-score"><b>${esc(f.score)}</b> / 10</span>
      ${f.cached ? '<span class="fb-cached">Same answer as before: no tokens used</span>' : ''}
    </div>
    ${f.strengths.length ? `<div class="fb-block"><div class="xp-label">What worked</div><ul class="jd-list">${f.strengths.map(s => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
    ${f.improve.length ? `<div class="fb-block"><div class="xp-label">What to improve</div><ol class="jd-steps">${f.improve.map(s => `<li>${esc(s)}</li>`).join('')}</ol></div>` : ''}
    ${f.better_answer ? `<details class="ai-more fb-better"><summary>A stronger answer</summary>${richText(f.better_answer)}</details>` : ''}
    ${f.follow_up ? `<div class="fb-follow"><span class="xp-label">Likely follow-up</span><p>${esc(f.follow_up)}</p>
      ${inMock ? '' : `<button class="linkbtn accent" type="button" data-practise-follow="${esc(f.follow_up)}">Practise the follow-up</button>`}</div>` : ''}
    <p class="brief-foot">Feedback by ${esc(f.model_name || 'AI')}.</p>
    ${inMock ? `<div class="login-actions"><button class="btn primary" type="button" data-mock-next>${last ? 'See how you did' : 'Next question'}</button></div>` : ''}
  </div>`;
}

function wireFeedback(q) {
  const follow = $('[data-practise-follow]');
  if (follow) follow.onclick = () => openPractice({ text: follow.dataset.practiseFollow, answers: [], sources: q.sources || new Set() });
  const next = $('[data-mock-next]');
  if (next) next.onclick = () => nextMock();
}

// ---------- mock interview ----------
// Five questions, the most reported first, taking turns across subjects so one topic doesn't fill it.
function mockPick(d, n = MOCK_SIZE) {
  const c = aiEntry();
  const tags = (c && c.ai && c.ai.tags) || {};
  const qs = pulledQuestions(d).filter(q => !(tags[norm(q.text)] && tags[norm(q.text)].k === false))
    .sort((a, b) => b.sources.size - a.sources.size || Math.random() - 0.5);
  const bySubject = new Map();
  qs.forEach(q => { const s = subjectOf(q); if (!bySubject.has(s)) bySubject.set(s, []); bySubject.get(s).push(q); });
  const lists = [...bySubject.values()];
  const out = [];
  for (let round = 0; out.length < n && lists.some(l => l[round]); round++) {
    lists.forEach(l => { if (out.length < n && l[round]) out.push(l[round]); });
  }
  return out;
}

function startMock(d) {
  const qs = mockPick(d);
  if (qs.length < 2) { toast('Pull a few more questions first.'); return; }
  practice.mock = { qs, i: 0, results: [] };
  openPractice(qs[0]);
}

function nextMock() {
  const m = practice.mock;
  if (!m) return;
  if (m.i >= m.qs.length - 1) { finishMock(); return; }
  m.i += 1;
  openPractice(m.qs[m.i]);
}

function finishMock() {
  const m = practice.mock;
  practice.mock = null;
  closePractice();
  const results = (m ? m.results : []).filter(Boolean);
  if (!results.length) { toast('Mock interview ended.'); return; }
  const c = aiEntry();
  c.ai.mock = { at: new Date().toISOString(), asked: m.qs.length, results };
  saveStore();
  rerender();
  const el = $('#practice');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function mockSummaryHtml(mk) {
  const n = mk.results.length;
  const avg = mk.results.reduce((t, r) => t + r.score, 0) / n;
  const count = (v) => mk.results.filter(r => r.verdict === v).length;
  const weak = mk.results.filter(r => r.verdict !== 'Strong').sort((a, b) => a.score - b.score);
  return `<div class="jd-card mock-summary">
    <h3>Last mock interview · ${fmtDate(mk.at)}</h3>
    <div class="mock-stats">
      <div><b>${avg.toFixed(1)}</b><span>average out of 10</span></div>
      <div><b>${count('Strong')}</b><span>strong</span></div>
      <div><b>${count('Good')}</b><span>good</span></div>
      <div><b>${count('Needs work')}</b><span>need work</span></div>
    </div>
    <p class="sub">You answered ${n} of ${mk.asked} questions.${weak.length ? ' Practise these again:' : ' Every answer was strong.'}</p>
    ${weak.length ? `<ul class="mock-weak">${weak.map(r => `<li><span class="verdict small ${VERDICT_CLASS[r.verdict]}">${r.score}/10</span>
      <span>${esc(r.q)}</span><button class="linkbtn accent" type="button" data-practise="${esc(r.key)}" data-q="${esc(r.q)}">Practise again</button></li>`).join('')}</ul>` : ''}
  </div>`;
}

function practiceHtml(d) {
  const c = aiEntry();
  if (!c || !practiceReady()) return '';
  const n = pulledQuestions(d).length;
  if (n < 2) return '';
  return `<section class="section practise-section" id="practice">
    <h2>Practise</h2>
    <p class="sub">Answer questions pulled for ${esc(companyName(d))} and get feedback the way the interviewer would give it: what worked, what to fix and a stronger answer.
      Every question card also has <b>Practise answering</b>.</p>
    <div class="practice-actions">
      ${aiActionButton('data-mock-start', `Start a mock interview (${Math.min(MOCK_SIZE, n)} questions)`, AI_COST.feedback * Math.min(MOCK_SIZE, n))}
    </div>
    ${c.ai.mock ? mockSummaryHtml(c.ai.mock) : ''}
  </section>`;
}

// ---------- ask about your results ----------
const ASK_STOP = new Set('the and for with are you your what how why does did can will would should when which who into from that this have has about is in of to a an on at do they there their them its it be was were'.split(' '));

// The experiences and questions most related to the question (shared words), so only those are sent.
function askMaterial(d, question) {
  const input = briefInput(d);
  const words = [...new Set(norm(question).split(' ').filter(w => w.length > 2 && !ASK_STOP.has(w)))];
  const score = (t) => { const n = ' ' + norm(t) + ' '; return words.filter(w => n.includes(' ' + w)).length; };
  const rank = (list) => list.map((x, i) => ({ x, s: score(x.text + ' ' + (x.role || '')), i }))
    .sort((a, b) => b.s - a.s || a.i - b.i).map(r => r.x);
  return { experiences: rank(input.experiences).slice(0, 12), questions: rank(input.questions).slice(0, 40), refs: input.refs };
}

function askHtml(d) {
  const c = aiEntry();
  if (!c || !practiceReady()) return '';
  const counts = briefCounts(d);
  if (!counts.x && !counts.q) return '';
  const asks = c.ai.asks || [];
  return `<section class="section ask" id="ask">
    <h2>Ask about your results</h2>
    <p class="sub">Ask anything about interviewing at ${esc(companyName(d))}. The answer comes only from the ${plural(counts.x, 'experience')}
      and ${plural(counts.q, 'question')} you pulled, with a source on every point.</p>
    <form class="ask-form" data-ask-form>
      <input class="qa-filter" id="ask-q" maxlength="300" autocomplete="off" aria-label="Your question"
             placeholder="For example: what do they ask in the technical round?" />
      ${aiActionButton('data-ask-go', 'Ask', AI_COST.ask, 'btn primary')}
    </form>
    ${asks.map((a, i) => askAnswerHtml(a, i)).join('')}
  </section>`;
}

function askAnswerHtml(a, i) {
  const r = a.data;
  const cite = (ids) => ids.map(id => {
    const ref = a.refs[id];
    return ref ? `<button class="cite" type="button" data-ask-cite="${i}|${esc(id)}" title="${esc(ref.label)}">${esc(id)}</button>` : '';
  }).join('');
  return `<div class="jd-card ask-answer">
    <div class="ask-q">${esc(a.q)}</div>
    <p class="brief-overview">${esc(r.answer)}</p>
    ${r.points.length ? `<ul class="jd-list brief-list">${r.points.map(p => `<li>${esc(p.text)} ${cite(p.sources)}</li>`).join('')}</ul>` : ''}
    <p class="brief-foot">${r.found ? '' : 'Your pulled results don\'t really cover this. '}Answered by ${esc(r.model_name || 'AI')} on ${fmtDate(a.at)} from
      ${plural(r.based_on.experiences, 'experience')} and ${plural(r.based_on.questions, 'question')}.${r.cached ? ' Asked before: no tokens used.' : ''}
      <button class="linkbtn" type="button" data-ask-remove="${i}">Remove</button></p>
  </div>`;
}

async function runAsk(btn) {
  const d = lastData;
  const c = aiEntry();
  const input = $('#ask-q');
  const question = (input && input.value || '').trim();
  if (question.length < 4) { if (input) input.focus(); return; }
  const m = askMaterial(d, question);
  const done = busyButton(btn, 'Reading your results…');
  try {
    const r = await aiPost('/api/ai/ask', { company: c.name, question,
      experiences: m.experiences.map(({ id, source, role, date, text }) => ({ id, source, role, date, text })),
      questions: m.questions.map(({ id, text }) => ({ id, text })) });
    const used = new Set(r.points.flatMap(p => p.sources));
    const refs = Object.fromEntries(Object.entries(m.refs).filter(([id]) => used.has(id)));
    c.ai.asks = [{ q: question, data: r, refs, at: new Date().toISOString() }, ...(c.ai.asks || [])
      .filter(a => norm(a.q) !== norm(question))].slice(0, ASK_KEEP);
    saveStore();
    rerender();
  } catch (e) {
    done();
    toast(`No answer: ${e.message}`);
  }
}

// ---------- one set of handlers for every render ----------
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-practise],[data-mock-start],[data-ask-go],[data-ask-cite],[data-ask-remove]');
  if (!t) return;
  if (t.dataset.practise !== undefined) {
    practice.mock = null;
    const q = findPulled(t.dataset.practise, t.dataset.q);
    openPractice({ ...q, text: q.text || t.dataset.q });
  } else if (t.dataset.mockStart !== undefined) {
    startMock(lastData);
  } else if (t.dataset.askGo !== undefined) {
    e.preventDefault();
    runAsk(t);
  } else if (t.dataset.askCite) {
    const [i, id] = t.dataset.askCite.split('|');
    const c = aiEntry();
    const a = c && (c.ai.asks || [])[+i];
    const ref = a && a.refs[id];
    if (ref && ref.src) openSource(ref.src, ref.tab);
  } else if (t.dataset.askRemove !== undefined) {
    const c = aiEntry();
    if (c && c.ai.asks) { c.ai.asks.splice(+t.dataset.askRemove, 1); saveStore(); rerender(); }
  }
});
document.addEventListener('submit', (e) => {
  if (!e.target.matches('[data-ask-form]')) return;
  e.preventDefault();
  const b = e.target.querySelector('[data-ask-go]');
  if (b && !b.disabled) runAsk(b);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#practice-modal')) { if (practice.mock) finishMock(); else closePractice(); }
});
