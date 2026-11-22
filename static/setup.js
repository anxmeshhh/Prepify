/* Prepify: first run on the person's own PC.
   1. A welcome from the team that asks for their name and Gmail (sent once to the team's user list).
   2. Their own Groq API key for the AI features (saved only in this computer's settings).
   Uses helpers from search.js ($, esc, getJson, toast, auth, rerender) at call time. */

const SETUP = { status: null };

function setupModal(id, html, { closable = false } = {}) {
  let el = $('#' + id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.className = 'modal';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    document.body.appendChild(el);
    if (closable) el.addEventListener('click', (e) => { if (e.target === el) el.remove(); });
  }
  el.innerHTML = html;
  return el;
}

// ---------- 1. welcome ----------
function openWelcome() {
  const el = setupModal('welcome-modal', `
    <form class="modal-box welcome-box" id="welcome-form" aria-labelledby="welcome-title" novalidate>
      <div class="welcome-head">
        <span class="mark big" style="--c:var(--accent)">F</span>
        <div>
          <h2 id="welcome-title">Hey, happy to know you're here!</h2>
          <p class="modal-sub">A note from the people behind Prepify</p>
        </div>
      </div>
      <div class="welcome-note">
        <p>We're gang F-205, and we just want to know your name and Gmail for further processes.</p>
        <p class="welcome-sign">~ Animesh</p>
      </div>
      <div class="field">
        <label for="welcome-name">Your name</label>
        <input id="welcome-name" name="name" autocomplete="name" maxlength="80" required />
      </div>
      <div class="field">
        <label for="welcome-email">Gmail</label>
        <input id="welcome-email" name="email" type="email" autocomplete="email" spellcheck="false" maxlength="254"
               placeholder="you@gmail.com" required />
      </div>
      <p class="modal-note">Your name and email go to the Prepify team's user list. Your searches, everything you pull and your
        API key stay on this computer.</p>
      <div class="form-error hidden" id="welcome-error" role="alert"></div>
      <div class="login-actions"><button class="btn primary" type="submit" id="welcome-go">Continue</button></div>
    </form>`);
  setTimeout(() => $('#welcome-name').focus(), 0);
  $('#welcome-form').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#welcome-error');
    const btn = $('#welcome-go');
    err.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    const name = $('#welcome-name').value.trim();
    try {
      await getJson('/api/setup/profile', { method: 'POST', body: JSON.stringify({ name, email: $('#welcome-email').value }) });
      el.remove();
      toast(`Welcome to Prepify, ${name.split(' ')[0]}!`);
      if (SETUP.status && !SETUP.status.groq_key) openGroqKey(true);
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Continue';
    }
  };
}

// ---------- 2. the person's own Groq key ----------
function openGroqKey(firstRun = false) {
  const el = setupModal('groq-modal', `
    <form class="modal-box welcome-box" id="groq-form" aria-labelledby="groq-title" novalidate>
      <div class="welcome-head">
        <span class="mark big" style="--c:var(--link)">AI</span>
        <div>
          <h2 id="groq-title">Add your Groq API key</h2>
          <p class="modal-sub">Free, and it takes about a minute</p>
        </div>
      </div>
      <p class="modal-sub">Prepify's AI features (tidying questions, reading job descriptions, the company brief and model answers)
        run on your own Groq key. It's saved only in this computer's settings.</p>
      <ol class="login-steps">
        <li>Open <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer">console.groq.com/keys</a> and sign in.</li>
        <li>Click <b>Create API key</b> and copy it.</li>
        <li>Paste it below.</li>
      </ol>
      <div class="field">
        <label for="groq-key">Groq API key</label>
        <input id="groq-key" name="groq-key" type="password" autocomplete="off" spellcheck="false" placeholder="gsk_…" required />
      </div>
      <div class="form-error hidden" id="groq-error" role="alert"></div>
      <div class="login-actions">
        <button class="btn primary" type="submit" id="groq-go">Save key</button>
        <button class="linkbtn" type="button" id="groq-skip">${firstRun ? 'Skip for now' : 'Cancel'}</button>
      </div>
      ${firstRun ? '<p class="modal-note">Without a key everything except the AI features works. You can add it later from the side panel.</p>' : ''}
    </form>`, { closable: !firstRun });
  setTimeout(() => $('#groq-key').focus(), 0);
  $('#groq-skip').onclick = () => el.remove();
  $('#groq-form').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#groq-error');
    const btn = $('#groq-go');
    err.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'Checking the key…';
    try {
      const r = await getJson('/api/setup/groq', { method: 'POST', body: JSON.stringify({ key: $('#groq-key').value.trim() }) });
      if (r.ai) auth.ai = r.ai;
      if (SETUP.status) SETUP.status.groq_key = true;
      el.remove();
      toast('Groq key saved. AI features are ready.');
      rerender();
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Save key';
    }
  };
}

// ---------- on start ----------
async function checkSetup() {
  try {
    SETUP.status = await getJson('/api/setup');
  } catch (e) {
    return;                                  // server unreachable: the page shows its own error
  }
  if (!SETUP.status.local) return;          // a hosted copy has no first-run setup
  if (!SETUP.status.registered) openWelcome();
  else if (!SETUP.status.groq_key && !sessionStorageFlag('prepify.groq.asked')) openGroqKey(true);
}

// ask for the key once per browser session, not on every page load
function sessionStorageFlag(name) {
  try {
    if (sessionStorage.getItem(name)) return true;
    sessionStorage.setItem(name, '1');
  } catch (e) { /* storage blocked: ask anyway */ }
  return false;
}

window.addEventListener('load', checkSetup);
