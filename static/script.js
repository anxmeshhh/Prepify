// Prepify frontend logic
const API = '';

let currentRoleId = null;
let currentQuestionId = null;

// ---------- Helpers ----------
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function showSection(id) {
  $$('section').forEach(s => s.classList.remove('active'));
  $(`#${id}`).classList.add('active');

  $$('.nav .tab').forEach(t => t.classList.remove('active'));
  $(`.nav .tab[data-section="${id}"]`)?.classList.add('active');
}

async function fetchJson(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ---------- Stats ----------
async function loadStats() {
  try {
    const d = await fetchJson('/api/dashboard');
    $('#stat-companies').textContent = d.companies;
    $('#stat-roles').textContent = d.roles;
    $('#stat-questions').textContent = d.questions;
    $('#stat-answers').textContent = d.answers;
    $('#stat-reviews').textContent = d.reviews;

    const cat = $('#cat-list');
    cat.innerHTML = '';
    d.by_category.forEach(row => {
      const el = document.createElement('div');
      el.className = 'list-item';
      el.innerHTML = `<span>${escapeHtml(row.category || 'Uncategorized')}</span><span class="meta">${row.c}</span>`;
      cat.appendChild(el);
    });
  } catch (e) {
    console.error('Failed to load stats', e);
  }
}

// ---------- Companies ----------
async function loadCompanies() {
  try {
    const companies = await fetchJson('/api/companies');
    const list = $('#company-list');
    list.innerHTML = '';
    companies.forEach(c => {
      const el = document.createElement('div');
      el.className = 'list-item';
      el.innerHTML = `
        <div>
          <div><strong>${escapeHtml(c.name)}</strong></div>
          <div class="meta">${escapeHtml(c.industry || '')} • ${escapeHtml(c.location || '')}</div>
        </div>
        <div>
          <button class="btn btn-sm btn-secondary" onclick="selectCompany(${c.id})">Use</button>
        </div>
      `;
      list.appendChild(el);
    });

    // company dropdowns
    const rsel = $('#review-company');
    rsel.innerHTML = '<option value="">All companies</option>';
    companies.forEach(c => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; rsel.appendChild(o); });
    const sel = $('#role-company');
    sel.innerHTML = '<option value="">Select company</option>';
    companies.forEach(c => {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.name;
      sel.appendChild(o);
    });
  } catch (e) {
    console.error(e);
  }
}

$('#company-form').onsubmit = async (e) => {
  e.preventDefault();
  const d = {
    name: $('#company-name').value,
    industry: $('#company-industry').value,
    size: $('#company-size').value,
    location: $('#company-location').value,
    website: $('#company-website').value,
    notes: $('#company-notes').value
  };
  await fetchJson('/api/companies', { method: 'POST', body: JSON.stringify(d) });
  $('#company-form').reset();
  loadCompanies();
  loadStats();
  showSection('companies');
};

window.selectCompany = async (id) => {
  currentRoleId = null;
  $('#role-company').value = id;
  loadRoles();
  showSection('roles');
};

// ---------- Roles ----------
async function loadRoles() {
  const companyId = $('#role-company').value;
  let url = '/api/roles';
  if (companyId) url += `?company_id=${companyId}`;
  try {
    const roles = await fetchJson(url);
    const list = $('#role-list');
    list.innerHTML = '';
    roles.forEach(r => {
      const el = document.createElement('div');
      el.className = 'list-item';
      el.innerHTML = `
        <div>
          <div><strong>${escapeHtml(r.title)}</strong> — ${escapeHtml(r.level || '')}</div>
          <div class="meta">${escapeHtml(r.department || '')}</div>
        </div>
        <div>
          <button class="btn btn-sm btn-secondary" onclick="selectRole(${r.id})">Questions</button>
        </div>
      `;
      list.appendChild(el);
    });

    // populate import dropdown
    const importSel = $('#import-role');
    if (importSel) {
      importSel.innerHTML = '<option value="">Select role</option>';
      roles.forEach(r => {
        const o = document.createElement('option');
        o.value = r.id;
        o.textContent = r.title;
        importSel.appendChild(o);
      });
    }
  } catch (e) {
    console.error(e);
  }
}

$('#role-form').onsubmit = async (e) => {
  e.preventDefault();
  const d = {
    company_id: $('#role-company').value || null,
    title: $('#role-title').value,
    level: $('#role-level').value,
    department: $('#role-department').value,
    description: $('#role-desc').value
  };
  await fetchJson('/api/roles', { method: 'POST', body: JSON.stringify(d) });
  $('#role-form').reset();
  loadRoles();
  loadStats();
};

window.selectRole = (id) => {
  currentRoleId = id;
  loadQuestions();
  showSection('questions');
};

// ---------- Questions ----------
async function loadQuestions() {
  let url = '/api/questions';
  if (currentRoleId) url += `?role_id=${currentRoleId}`;
  try {
    const questions = await fetchJson(url);
    const list = $('#question-list');
    list.innerHTML = '';
    questions.forEach(q => {
      const el = document.createElement('div');
      el.className = 'list-item';
      el.innerHTML = `
        <div style="max-width: 600px;">
          <div><strong>${escapeHtml(q.category || 'Question')}</strong> — ${escapeHtml(q.round_type || '')}</div>
          <div class="meta" style="white-space:normal; margin-top:4px;">${escapeHtml(q.text)}</div>
          <div class="meta" style="margin-top:4px;">
            ${q.difficulty ? `<span class="tag">${escapeHtml(q.difficulty)}</span>` : ''}
            ${q.source ? `<span class="tag">${escapeHtml(q.source)}</span>` : ''}
          </div>
        </div>
        <div>
          <button class="btn btn-sm btn-secondary" onclick="openAnswer(${q.id})">Answer</button>
        </div>
      `;
      list.appendChild(el);
    });
  } catch (e) {
    console.error(e);
  }
}

$('#question-form').onsubmit = async (e) => {
  e.preventDefault();
  if (!currentRoleId) {
    alert('Please select a role first');
    return;
  }
  const d = {
    role_id: currentRoleId,
    round_type: $('#q-round').value,
    category: $('#q-category').value,
    text: $('#q-text').value,
    topic: $('#q-topic').value,
    difficulty: $('#q-difficulty').value,
    source: $('#q-source').value,
    tags: $('#q-topic').value
  };
  await fetchJson('/api/questions', { method: 'POST', body: JSON.stringify(d) });
  $('#question-form').reset();
  loadQuestions();
};

window.openAnswer = (qid) => {
  currentQuestionId = qid;
  $('#answer-area').classList.remove('hidden');
  $('#answer-text').value = '';
  $('#answer-code').value = '';
  $('#answer-lang').value = '';
  $('#answer-time').value = '';
  $('#answer-rating').value = '';
  $('#answer-feedback').value = '';
  loadAnswers(qid);
  showSection('answers');
};

// ---------- Answers ----------
async function loadAnswers(qid) {
  try {
    const answers = await fetchJson(`/api/answers?question_id=${qid}`);
    const list = $('#answer-list');
    list.innerHTML = '';
    answers.forEach(a => {
      const el = document.createElement('div');
      el.className = 'list-item';
      el.innerHTML = `
        <div>
          <div><strong>Your answer</strong></div>
          <div class="meta" style="white-space:normal;">${escapeHtml(a.user_answer)}</div>
          ${a.code ? `<div class="answer-card"><div class="label">Code (${escapeHtml(a.language || '')})</div><pre style="white-space:pre-wrap;font-size:0.9rem">${escapeHtml(a.code)}</pre></div>` : ''}
          ${a.self_rating ? `<div class="meta">Self rating: ${a.self_rating}/5 ${a.time_spent ? `• ${a.time_spent} min` : ''}</div>` : ''}
        </div>
      `;
      list.appendChild(el);
    });
  } catch (e) {
    console.error(e);
  }
}

$('#answer-form').onsubmit = async (e) => {
  e.preventDefault();
  if (!currentQuestionId) return;
  const d = {
    question_id: currentQuestionId,
    user_answer: $('#answer-text').value,
    code: $('#answer-code').value || null,
    language: $('#answer-lang').value || null,
    time_spent: parseInt($('#answer-time').value) || null,
    self_rating: parseInt($('#answer-rating').value) || null,
    feedback: $('#answer-feedback').value || null,
    score: null
  };
  await fetchJson('/api/answers', { method: 'POST', body: JSON.stringify(d) });
  $('#answer-form').reset();
  loadAnswers(currentQuestionId);
};

// ---------- Import ----------
$('#import-form').onsubmit = async (e) => {
  e.preventDefault();
  const roleId = $('#import-role').value;
  const raw = $('#import-json').value.trim();
  if (!roleId) { alert('Select a role first'); return; }
  try {
    const items = JSON.parse(raw);
    const d = await fetchJson('/api/import/questions', {
      method: 'POST',
      body: JSON.stringify({ role_id: roleId, items })
    });
    $('#import-result').innerHTML = `<div style="color:var(--success);">✅ Imported ${d.imported} questions!</div>`;
    $('#import-form').reset();
    loadQuestions();
    loadStats();
  } catch (err) {
    $('#import-result').innerHTML = `<div style="color:var(--danger);">❌ Invalid JSON or server error: ${escapeHtml(err.message)}</div>`;
  }
};

// ---------- Reviews ----------
async function loadReviews() {
  const cid = $('#review-company').value;
  const rows = await fetchJson('/api/reviews' + (cid ? `?company_id=${cid}` : ''));
  const list = $('#review-list');
  list.innerHTML = rows.length ? '' : '<div class="meta">No reviews captured yet.</div>';
  rows.forEach(r => {
    const el = document.createElement('div');
    el.className = 'list-item';
    el.innerHTML = `
      <div style="max-width:700px;">
        <div><strong>${escapeHtml(r.title || r.job_title || 'Review')}</strong>
          ${r.rating ? ` — ${r.rating}/5` : ''} <span class="tag">${escapeHtml(r.source || '')}</span>
          <span class="tag">${escapeHtml(r.company_name)}</span></div>
        ${r.pros ? `<div class="meta" style="white-space:normal;margin-top:4px;"><strong>Pros:</strong> ${escapeHtml(r.pros)}</div>` : ''}
        ${r.cons ? `<div class="meta" style="white-space:normal;margin-top:4px;"><strong>Cons:</strong> ${escapeHtml(r.cons)}</div>` : ''}
        ${r.body ? `<div class="meta" style="white-space:normal;margin-top:4px;">${escapeHtml(r.body)}</div>` : ''}
        ${r.url ? `<div class="meta" style="margin-top:4px;"><a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">source</a></div>` : ''}
      </div>`;
    list.appendChild(el);
  });
}
$('#review-company').onchange = loadReviews;

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  loadCompanies();
  showSection('dashboard');

  $$('.nav .tab').forEach(tab => {
    tab.onclick = () => {
      showSection(tab.dataset.section);
      if (tab.dataset.section === 'reviews') loadReviews();
      if (tab.dataset.section === 'questions') { currentRoleId = null; loadQuestions(); }
    };
  });
});