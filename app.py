"""Prepify server.

Stateless by design: there is no database. The server only
  * understands search queries (company, role, what the user wants), and
  * handles optional "Sign in with Google" for the Prepify session.
Everything pulled from Glassdoor / AmbitionBox lives only in the user's browser tab
(sessionStorage) and disappears when the tab is closed.
"""
import os
import re
import secrets
import sys

from flask import Flask, jsonify, render_template, request, session

# Where the app's files are (inside the bundle when packaged with PyInstaller), and where the user's
# own settings live (next to Prepify.exe when packaged, next to app.py otherwise).
FROZEN = getattr(sys, 'frozen', False)
BUNDLE_DIR = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
HOME_DIR = os.path.dirname(sys.executable) if FROZEN else os.path.dirname(os.path.abspath(__file__))

try:  # settings from .env (GOOGLE_CLIENT_ID, PREPIFY_SECRET, GROQ_API_KEY); real environment variables win
    from dotenv import load_dotenv
    # the shared app keeps the user's settings (their Groq key) in prepify-settings.txt next to Prepify.exe;
    # a developer copy uses .env. The first file that sets a value wins.
    load_dotenv(os.path.join(HOME_DIR, 'prepify-settings.txt'))
    load_dotenv(os.path.join(HOME_DIR, '.env'))
except ImportError:
    pass

import ai  # noqa: E402  (reads its settings from the environment loaded above)

ai.USAGE_FILE = os.path.join(HOME_DIR, '.prepify-usage.json')     # the AI token ledger: counts only, no content
import jd as jd_reader  # noqa: E402
import site_index  # noqa: E402
from query_parser import parse_query  # noqa: E402

app = Flask(__name__, static_folder=os.path.join(BUNDLE_DIR, 'static'),
            template_folder=os.path.join(BUNDLE_DIR, 'templates'))

# Deployed (PREPIFY_PUBLIC_URL=https://...): the host's proxy terminates HTTPS, so trust its forwarded
# headers for the client address and scheme, and send the session cookie over HTTPS only.
PUBLIC_URL = (os.environ.get('PREPIFY_PUBLIC_URL') or os.environ.get('RENDER_EXTERNAL_URL') or '').strip().rstrip('/')
if PUBLIC_URL:
    from werkzeug.middleware.proxy_fix import ProxyFix
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

# Sessions are signed cookies, not server storage. Without PREPIFY_SECRET a fresh key is made
# on every start, which simply signs everyone out after a restart.
app.secret_key = os.environ.get('PREPIFY_SECRET') or secrets.token_hex(32)
if PUBLIC_URL and not os.environ.get('PREPIFY_SECRET'):
    print('WARNING: PREPIFY_SECRET is not set; everyone is signed out whenever the server restarts.', file=sys.stderr)
app.config.update(
    MAX_CONTENT_LENGTH=12 * 1024 * 1024,   # a JD and a resume upload
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_SECURE=PUBLIC_URL.startswith('https://'),
)


# ---------- a simple per-visitor limit on the endpoints anyone can call without signing in ----------
_hits = {}


def _limited(bucket, per, seconds):
    """True when this client address has made more than `per` calls to `bucket` in `seconds`."""
    import time
    now = time.time()
    key = (bucket, request.remote_addr or '?')
    recent = [t for t in _hits.get(key, []) if now - t < seconds]
    recent.append(now)
    _hits[key] = recent
    if len(_hits) > 20000:                     # forget idle visitors
        for k in [k for k, v in _hits.items() if now - v[-1] > 3600]:
            _hits.pop(k, None)
    return len(recent) > per


@app.route('/healthz')
def healthz():
    return jsonify({'ok': True})


# ---------- first run on the person's own PC: who they are, and their own Groq key (setup_local.py) ----------
import setup_local  # noqa: E402

PROFILE_FILE = os.path.join(HOME_DIR, '.prepify-profile.json')
SETTINGS_FILE = os.path.join(HOME_DIR, 'prepify-settings.txt')
# where a pasted Groq key is saved: prepify-settings.txt in the shared app, .env in a developer copy
ENV_FILE = SETTINGS_FILE if (FROZEN or os.path.exists(SETTINGS_FILE)) else os.path.join(HOME_DIR, '.env')
if not PUBLIC_URL:
    setup_local.sync_in_background(PROFILE_FILE)      # details saved while offline go to Supabase now
if not os.environ.get('PYTEST_CURRENT_TEST') and 'pytest' not in sys.modules:
    site_index.warm()                                  # Code360 / PrepInsta indexes ready before the first pull


def _local_only():
    """Setup writes to this PC (the .env, the profile file), so it's only for a copy running on the user's own machine."""
    if PUBLIC_URL:
        return jsonify({'error': 'Setup is only available when Prepify runs on your own computer.'}), 403
    return None


@app.route('/api/setup', methods=['GET'])
def setup_status():
    profile = setup_local.load_profile(PROFILE_FILE)
    return jsonify({'local': not PUBLIC_URL, 'registered': bool(profile) or bool(PUBLIC_URL),
                    'name': profile and profile.get('name'), 'email': profile and profile.get('email'),
                    'synced': bool(profile and profile.get('synced')),
                    'groq_key': ai.available(), 'version': setup_local.APP_VERSION})


@app.route('/api/setup/profile', methods=['POST'])
def setup_profile():
    refused = _local_only()
    if refused:
        return refused
    b = request.get_json(silent=True) or {}
    try:
        setup_local.save_profile(PROFILE_FILE, b.get('name'), b.get('email'))
    except setup_local.SetupError as e:
        return jsonify({'error': str(e)}), 400
    synced = setup_local.sync_profile(PROFILE_FILE)     # if offline, it's retried at the next start
    return jsonify({'ok': True, 'synced': synced})


@app.route('/api/setup/groq', methods=['POST'])
def setup_groq():
    refused = _local_only()
    if refused:
        return refused
    try:
        key = setup_local.check_groq_key((request.get_json(silent=True) or {}).get('key'))
        setup_local.set_env_value(ENV_FILE, 'GROQ_API_KEY', key)
    except setup_local.SetupError as e:
        return jsonify({'error': str(e)}), 400
    except OSError:
        return jsonify({'error': "The key works, but Prepify couldn't save it next to the app. Check that its folder isn't read-only."}), 500
    return jsonify({'ok': True, 'ai': ai.status(current_user())})

# Prepify's own Google sign-in client. A client ID is public (it's sent to every browser), so it's built in:
# people who run Prepify can sign in without setting anything up. GOOGLE_CLIENT_ID in .env overrides it.
# It only works on the origins registered for it in Google Cloud Console: http://localhost:5000.
DEFAULT_GOOGLE_CLIENT_ID = '896456277671-tbi2jc4cdppnu3blcrbsguesuvmfo0fu.apps.googleusercontent.com'
GOOGLE_CLIENT_ID = (os.environ.get('GOOGLE_CLIENT_ID') or DEFAULT_GOOGLE_CLIENT_ID).strip()
# Fixed at 5000: Google sign-in and the Prepify Capture extension are both registered for localhost:5000.
# PREPIFY_PORT exists only for testing a build next to a running copy.
PORT = int(os.environ.get('PREPIFY_PORT') or 5000)


# ---------- Query understanding (query_parser.py) and job descriptions (jd.py) ----------
@app.route('/api/parse', methods=['GET'])
def parse():
    q = (request.args.get('q') or '').strip()
    if not q:
        return jsonify({'error': 'empty query'}), 400
    if _limited('parse', 120, 60):
        return jsonify({'error': 'Too many searches at once. Wait a minute and try again.'}), 429
    known = [k for k in request.args.getlist('known') if k][:200]
    return jsonify({'query': q, 'parsed': parse_query(q, known)})


@app.route('/api/jd', methods=['POST'])
def analyse_jd():
    """Analyse a job description (file or pasted text) and, optionally, a resume.
    With use_ai=1 (signed in, AI set up) the AI reads it; the rules are the fallback.
    Nothing is kept: the text is read, analysed and the result is returned."""
    user = current_user()
    if _limited('jd', 20, 600):
        return jsonify({'error': 'Too many job descriptions in a short time. Wait a few minutes and try again.'}), 429
    use_ai = request.form.get('use_ai') == '1' and bool(user) and ai.available()
    jd_file = request.files.get('jd_file')
    text = None
    try:
        if jd_file and jd_file.filename:
            raw = jd_file.read(jd_reader.MAX_BYTES + 1)
            try:
                text = jd_reader.text_from_upload(jd_file.filename, raw)
            except jd_reader.NeedsAI:          # the AI provider has no vision model, so these need pasting
                raise jd_reader.JDError('That file has no text Prepify can read (it may be a scanned image or a '
                                        'photo). Paste the text instead.')
        else:
            text = request.form.get('jd_text', '')
        resume_text = ''
        rf = request.files.get('resume_file')    # an uploaded resume's text goes back to the tab, for the AI resume match
        if rf and rf.filename:
            try:
                resume_text = jd_reader.text_from_upload(rf.filename, rf.read(jd_reader.MAX_BYTES + 1))
            except jd_reader.NeedsAI:
                raise jd_reader.JDError("That resume file has no text Prepify can read. Paste your resume's text instead.")
        else:
            resume_text = request.form.get('resume_text', '')
    except jd_reader.JDError as e:
        return jsonify({'error': str(e)}), 400

    ai_note = None
    if use_ai:
        try:
            ai.begin(user['email'])
            try:
                analysis, _ = ai.read_jd(text, resume_text)
            except Exception:
                ai.refund(user['email'])
                raise
            ai.end()
            return jsonify({'analysis': analysis, 'text': text if jd_file else None,
                            'resume_text': resume_text if rf and rf.filename else None, 'ai': ai.status(user)})
        except jd_reader.JDError as e:
            return jsonify({'error': str(e)}), 400
        except Exception as e:                       # AI failed or the text was flagged: the rules still read it
            if not isinstance(e, ai.AIError):
                app.logger.exception('AI JD reading failed')
            ai_note = str(e) if isinstance(e, ai.AIError) else 'AI assist failed unexpectedly.'
    try:
        result = jd_reader.analyze(text, resume_text)
    except jd_reader.JDError as e:
        return jsonify({'error': str(e)}), 400
    return jsonify({'analysis': result, 'text': text if jd_file else None, 'ai_error': ai_note,
                    'resume_text': resume_text if rf and rf.filename else None, 'ai': ai.status(user)})


# ---------- AI assist (ai.py): signed-in users only, within a daily token budget ----------
def _ai_begin(background=False, pool='main'):
    """The signed-in user, after checking and counting against the AI budget; or an error response."""
    user = current_user()
    if not user:
        return None, (jsonify({'error': 'Sign in to use AI assist.'}), 401)
    if not ai.available():
        return None, (jsonify({'error': 'AI assist is not set up on this server.', 'ai': ai.status(user)}), 503)
    try:
        ai.begin(user['email'], background, pool)
    except ai.AILimit as e:
        return None, (jsonify({'error': str(e), 'paused': background, 'ai': ai.status(user)}), 429)
    return user, None


def _ai_done(user, payload):
    ai.end()
    return jsonify({**payload, 'ai': ai.status(user)})


def _ai_failed(user, e, what):
    ai.refund(user['email'])
    if not isinstance(e, ai.AIError):
        app.logger.exception('AI %s failed', what)
    status = e.status if isinstance(e, ai.AIError) else 502
    return jsonify({'error': str(e) if isinstance(e, ai.AIError) else f'AI {what} failed unexpectedly.',
                    'ai': ai.status(user)}), status


@app.route('/api/ai/questions', methods=['POST'])
def ai_questions():
    body = request.get_json(silent=True) or {}
    items = body.get('items')
    if not isinstance(items, list) or not items:
        return jsonify({'error': 'no questions sent'}), 400
    known = body.get('known') if isinstance(body.get('known'), list) else []
    user, err = _ai_begin(background=bool(body.get('background')), pool='fast')
    if err:
        return err
    try:
        out, model = ai.tidy_questions(str(body.get('company') or ''), items, known)
    except Exception as e:
        return _ai_failed(user, e, 'question tidying')
    return _ai_done(user, {**out, 'model': model})


@app.route('/api/ai/parse', methods=['POST'])
def ai_parse():
    q = str((request.get_json(silent=True) or {}).get('q') or '').strip()[:300]
    if not q:
        return jsonify({'error': 'empty query'}), 400
    hit = ai.cached_parse(q)
    if hit and current_user():
        return jsonify({'query': q, 'parsed': hit, 'ai': ai.status(current_user())})
    user, err = _ai_begin()
    if err:
        return err
    try:
        parsed = ai.parse_search(q)
    except Exception as e:
        return _ai_failed(user, e, 'search reading')
    return _ai_done(user, {'query': q, 'parsed': parsed})


def _list(v, n):
    return v[:n] if isinstance(v, list) else []


def _cached_or_run(kind, payload, run, what):
    """Serve a result already made for exactly this input; otherwise make it within the budget."""
    user = current_user()
    hit = ai.cached(kind, payload)
    if hit and user:
        return jsonify({**hit, 'cached': True, 'ai': ai.status(user)})
    user, err = _ai_begin()
    if err:
        return err
    try:
        result = ai.remember(kind, payload, run())
    except Exception as e:
        return _ai_failed(user, e, what)
    return _ai_done(user, result)


@app.route('/api/ai/brief', methods=['POST'])
def ai_brief():
    b = request.get_json(silent=True) or {}
    payload = {'company': str(b.get('company') or '')[:100], 'role': str(b.get('role') or '')[:80],
               'experiences': [{k: str(x.get(k) or '')[:2000] for k in ('id', 'source', 'role', 'date', 'outcome', 'text')}
                               for x in _list(b.get('experiences'), 40) if isinstance(x, dict)],
               'questions': [{'id': str(q.get('id') or '')[:20], 'text': str(q.get('text') or '')[:400],
                              'sources': [str(s)[:30] for s in _list(q.get('sources'), 5)]}
                             for q in _list(b.get('questions'), 80) if isinstance(q, dict)]}
    if not payload['company'] or not (payload['experiences'] or payload['questions']):
        return jsonify({'error': 'Pull some interview experiences first.'}), 400
    return _cached_or_run('brief', payload, lambda: ai.company_brief(**payload), 'company brief')


@app.route('/api/ai/answers', methods=['POST'])
def ai_answers():
    b = request.get_json(silent=True) or {}
    payload = {'company': str(b.get('company') or '')[:100], 'role': str(b.get('role') or '')[:80],
               'items': [{'id': str(i.get('id') or '')[:20], 'text': str(i.get('text') or '')[:400]}
                         for i in _list(b.get('items'), ai.MAX_ANSWERS) if isinstance(i, dict)]}
    if not payload['items']:
        return jsonify({'error': 'no questions sent'}), 400
    return _cached_or_run('answers', payload, lambda: ai.model_answers(**payload), 'model answers')


@app.route('/api/ai/resume', methods=['POST'])
def ai_resume():
    b = request.get_json(silent=True) or {}
    jd = b.get('jd') if isinstance(b.get('jd'), dict) else {}
    payload = {'jd': {'title': str(jd.get('title') or '')[:100], 'company': str(jd.get('company') or '')[:100],
                      'skills': [{'name': str(s.get('name') or '')[:60], 'level': str(s.get('level') or '')[:12]}
                                 for s in _list(jd.get('skills'), 30) if isinstance(s, dict)],
                      'responsibilities': [str(r)[:200] for r in _list(jd.get('responsibilities'), 8)]},
               'resume_text': str(b.get('resume_text') or '')[:ai.RESUME_CHARS]}
    return _cached_or_run('resume', payload, lambda: ai.resume_coach(**payload), 'resume match')


# ---------- Sign in with Google (optional) ----------
def current_user():
    return session.get('user')


@app.route('/api/auth/config', methods=['GET'])
def auth_config():
    return jsonify({'google_client_id': GOOGLE_CLIENT_ID or None, 'user': current_user(),
                    'sources': {'reddit_api': bool(REDDIT_CLIENT_ID)}, 'ai': ai.status(current_user())})


@app.route('/api/auth/google', methods=['POST'])
def auth_google():
    if not GOOGLE_CLIENT_ID:
        return jsonify({'error': 'Google sign-in is not set up (GOOGLE_CLIENT_ID missing)'}), 503
    credential = (request.get_json(silent=True) or {}).get('credential')
    if not credential:
        return jsonify({'error': 'missing credential'}), 400
    try:
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token
        # PC clocks drift; allow a few minutes either way when checking the token's issue/expiry times.
        info = id_token.verify_oauth2_token(credential, google_requests.Request(), GOOGLE_CLIENT_ID,
                                            clock_skew_in_seconds=300)
    except Exception as e:
        reason = str(e)[:200]
        app.logger.warning('Google sign-in rejected: %s', reason)
        return jsonify({'error': f'Google sign-in was rejected: {reason}'}), 401
    if not info.get('email_verified'):
        return jsonify({'error': 'Google account email is not verified'}), 401
    # Only what the UI shows; the Google token itself is not kept.
    session.clear()
    session['user'] = {'name': info.get('name') or info.get('email'), 'email': info.get('email'),
                       'picture': info.get('picture')}
    return jsonify({'user': session['user']})


@app.route('/api/auth/logout', methods=['POST'])
def auth_logout():
    session.clear()
    return jsonify({'ok': True})


# ---------- Reddit (official Data API, application-only OAuth) ----------
# An "installed app" client ID from https://www.reddit.com/prefs/apps is enough: no user login,
# no secret. Results go straight back to the browser; only the short-lived access token is kept
# in memory. Personal, non-commercial use within Reddit's free API limits.
REDDIT_CLIENT_ID = os.environ.get('REDDIT_CLIENT_ID', '').strip()
REDDIT_UA = 'web:prepify:0.5 (personal interview preparation)'
_reddit_token = {'value': None, 'expires': 0.0}


def reddit_token():
    import time
    import requests
    if _reddit_token['value'] and time.time() < _reddit_token['expires'] - 60:
        return _reddit_token['value']
    r = requests.post('https://www.reddit.com/api/v1/access_token',
                      auth=(REDDIT_CLIENT_ID, ''),
                      data={'grant_type': 'https://oauth.reddit.com/grants/installed_client',
                            'device_id': 'DO_NOT_TRACK_THIS_DEVICE'},
                      headers={'User-Agent': REDDIT_UA}, timeout=15)
    r.raise_for_status()
    body = r.json()
    _reddit_token.update(value=body['access_token'], expires=time.time() + body.get('expires_in', 3600))
    return _reddit_token['value']


INTERVIEW_WORDS = re.compile(r'interview|hiring|offer|round|placement|recruit|selected|rejected|onsite|\boa\b|assessment', re.I)


@app.route('/api/sources/reddit', methods=['GET'])
def reddit_source():
    if not current_user():
        return jsonify({'error': 'sign in to pull sources'}), 401
    if not REDDIT_CLIENT_ID:
        return jsonify({'error': 'Reddit is not set up (REDDIT_CLIENT_ID missing)'}), 503
    company = (request.args.get('company') or '').strip()[:100]
    if not company:
        return jsonify({'error': 'company required'}), 400
    import requests
    from datetime import datetime, timezone
    try:
        headers = {'Authorization': 'Bearer ' + reddit_token(), 'User-Agent': REDDIT_UA}
        r = requests.get('https://oauth.reddit.com/search',
                         params={'q': f'{company} interview', 'sort': 'relevance', 't': 'all',
                                 'limit': 25, 'type': 'link', 'raw_json': 1},
                         headers=headers, timeout=15)
        r.raise_for_status()
        word = company.lower().split()[0]
        posts = [c['data'] for c in r.json().get('data', {}).get('children', [])]
        posts = [p for p in posts if not p.get('over_18')
                 and word in (p.get('title', '') + ' ' + p.get('selftext', '')).lower()
                 and INTERVIEW_WORDS.search(p.get('title', '') + ' ' + p.get('selftext', ''))][:6]

        payload = {'source': 'Reddit', 'url': 'https://www.reddit.com/search/?q=' + requests.utils.quote(f'{company} interview'),
                   'company_name': company, 'questions': [], 'reviews': [], 'experiences': []}
        for p in posts:
            discussion = []
            try:
                t = requests.get(f"https://oauth.reddit.com/comments/{p['id']}",
                                 params={'limit': 50, 'depth': 1, 'sort': 'top', 'raw_json': 1},
                                 headers=headers, timeout=15).json()
                comments = [c['data'] for c in t[1]['data']['children'] if c.get('kind') == 't1']
                comments = [c for c in comments if c.get('body') and c['body'] not in ('[deleted]', '[removed]')]
                comments.sort(key=lambda c: c.get('score', 0), reverse=True)
                discussion = [{'text': c['body'][:1500], 'score': c.get('score', 0)} for c in comments[:8]]
            except Exception:
                pass
            body = (p.get('selftext') or '')[:4000]
            questions = [{'text': q.strip(), 'answers': []} for q in re.findall(r'[^.!?\n]{12,300}\?', body)][:15]
            payload['experiences'].append({
                'role': p.get('title', ''), 'location': 'r/' + p.get('subreddit', ''),
                'date': datetime.fromtimestamp(p.get('created_utc', 0), tz=timezone.utc).strftime('%Y-%m-%d'),
                'outcome': '', 'experience': '', 'difficulty': '', 'application': '', 'process': body,
                'rounds': [], 'questions': questions, 'tips': '', 'discussion': discussion,
                'score': p.get('score', 0), 'comments': p.get('num_comments', 0),
                'url': 'https://www.reddit.com' + p.get('permalink', '')})
            payload['questions'] += [{**q, 'role': p.get('title', '')} for q in questions]
        return jsonify(payload)
    except Exception as e:
        return jsonify({'error': f'Reddit request failed: {type(e).__name__}'}), 502


# ---------- Official careers / campus pages (ground truth) ----------
# Public company pages, fetched on request, robots.txt respected, nothing stored.
# Known recruiters map to their careers pages; any other company needs the user to paste the link.
OFFICIAL_PAGES = {
    # A list means several start pages (the readable campus or hiring-process page first).
    'tcs': ['https://www.tcs.com/careers/india/tcs-nqt', 'https://www.tcs.com/careers/india'],
    'tata consultancy services': ['https://www.tcs.com/careers/india/tcs-nqt', 'https://www.tcs.com/careers/india'],
    'infosys': 'https://www.infosys.com/careers/',
    'accenture': 'https://www.accenture.com/in-en/careers',
    'wipro': 'https://careers.wipro.com/',
    'cognizant': 'https://careers.cognizant.com/',
    'capgemini': 'https://www.capgemini.com/in-en/careers/',
    'hcl': 'https://www.hcltech.com/careers',
    'hcltech': 'https://www.hcltech.com/careers',
    'tech mahindra': 'https://careers.techmahindra.com/',
    'deloitte': 'https://www2.deloitte.com/in/en/careers.html',
    'amazon': 'https://www.amazon.jobs/en/',
    'microsoft': 'https://careers.microsoft.com/',
    'google': 'https://www.google.com/about/careers/applications/',
    'target': ['https://corporate.target.com/careers/career-areas/intern-entry-level', 'https://corporate.target.com/careers'],
    'target corporation': ['https://corporate.target.com/careers/career-areas/intern-entry-level', 'https://corporate.target.com/careers'],
    'cme group': 'https://www.cmegroup.com/careers.html',
}
OFFICIAL_UA = 'Prepify/0.6 (personal interview preparation; reads public careers pages)'
OFFICIAL_LINK_WORDS = re.compile(r'campus|graduate|fresher|freshers|students?|universit|early.?career|entry.?level|'
                                 r'eligib|selection|hiring process|recruitment|how we hire|interview|internship', re.I)
OFFICIAL_SECTION_WORDS = re.compile(r'\b(eligib\w*|selection|hiring process|recruitment process|interview rounds?|online tests?|coding tests?|aptitude|'
                                    r'assessments?|interviews?|pattern|how to apply|qualif\w*|criteria|campus|graduates?|'
                                    r'freshers?|what to expect|prepar\w*)\b', re.I)


class UnsafeURL(ValueError):
    pass


def _check_public(url):
    """Only http(s) on the normal ports, to hosts whose every address is public: a pasted careers link must
    never make the server reach its own machine, the private network or the cloud's metadata service."""
    import ipaddress
    import socket
    from urllib.parse import urlsplit
    parts = urlsplit(url)
    if parts.scheme not in ('http', 'https') or not parts.hostname or parts.username or parts.password:
        raise UnsafeURL('only public http(s) addresses')
    if parts.port not in (None, 80, 443):
        raise UnsafeURL('only the standard web ports')
    try:
        infos = socket.getaddrinfo(parts.hostname, parts.port or (443 if parts.scheme == 'https' else 80))
    except socket.gaierror:
        raise UnsafeURL("that address doesn't exist")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split('%')[0])
        if not ip.is_global or ip.is_multicast:
            raise UnsafeURL('that address is not on the public internet')


def _public_get(url, timeout, max_redirects=4):
    """requests.get that checks every hop of a redirect chain with _check_public."""
    import requests
    from urllib.parse import urljoin
    headers = {'User-Agent': OFFICIAL_UA, 'Accept-Language': 'en-IN,en;q=0.8'}
    for _ in range(max_redirects + 1):
        _check_public(url)
        r = requests.get(url, headers=headers, timeout=timeout, allow_redirects=False)
        if r.is_redirect and r.headers.get('location'):
            url = urljoin(url, r.headers['location'])
            continue
        return r
    raise UnsafeURL('too many redirects')


def _allowed_by_robots(url):
    from urllib import robotparser
    from urllib.parse import urlsplit
    parts = urlsplit(url)
    rp = robotparser.RobotFileParser()
    try:
        r = _public_get(f'{parts.scheme}://{parts.netloc}/robots.txt', timeout=10)
        if r.status_code >= 400:
            return True                      # no robots.txt: allowed
        rp.parse(r.text.splitlines())
        return rp.can_fetch(OFFICIAL_UA, url)
    except Exception:
        return True


def _read_official_page(url):
    """Title, relevant sections (heading + paragraphs/list items) and promising same-site links."""
    from bs4 import BeautifulSoup
    from urllib.parse import urljoin, urlsplit
    r = _public_get(url, timeout=15)
    r.raise_for_status()
    if 'html' not in r.headers.get('content-type', ''):
        return None
    soup = BeautifulSoup(r.text, 'lxml')
    for tag in soup(['script', 'style', 'noscript', 'svg', 'nav', 'footer', 'header', 'form', 'iframe']):
        tag.decompose()
    title = (soup.title.get_text(' ', strip=True) if soup.title else url)[:160]

    sections, current = [], None
    for el in soup.find_all(['h1', 'h2', 'h3', 'h4', 'p', 'li']):
        text = ' '.join(el.get_text(' ', strip=True).split())
        if not text:
            continue
        if el.name in ('h1', 'h2', 'h3', 'h4'):
            current = {'heading': text[:160], 'text': []}
            sections.append(current)
        elif current is not None and len(text) > 20 and len(current['text']) < 25:
            current['text'].append(('- ' if el.name == 'li' else '') + text[:800])
    sections = [{'heading': s['heading'], 'text': '\n'.join(s['text'])} for s in sections
                if s['text'] and OFFICIAL_SECTION_WORDS.search(s['heading'] + ' ' + ' '.join(s['text'])[:400])][:12]

    host = urlsplit(r.url).netloc
    links = []
    for a in soup.find_all('a', href=True):
        href = urljoin(r.url, a['href']).split('#')[0]
        label = ' '.join(a.get_text(' ', strip=True).split())
        if urlsplit(href).netloc == host and href != r.url and OFFICIAL_LINK_WORDS.search(label + ' ' + href):
            links.append(href)
    return {'title': title, 'url': r.url, 'sections': sections, 'links': list(dict.fromkeys(links))[:6]}


@app.route('/api/sources/official', methods=['GET'])
def official_source():
    """Read a company's official careers pages. When nothing can be read, say why, so the user can act:
    no page known, the site disallows automated reading (robots.txt), or its pages only build in a browser."""
    if not current_user():
        return jsonify({'error': 'sign in to pull sources'}), 401
    company = (request.args.get('company') or '').strip()[:100]
    url = (request.args.get('url') or '').strip()
    starts = [url] if url else (OFFICIAL_PAGES.get(company.lower()) or OFFICIAL_PAGES.get(company.lower().split(' ')[0]) or [])
    starts = [starts] if isinstance(starts, str) else list(starts)
    if not starts:
        return jsonify({'error': 'no official page known', 'needs_url': True, 'reason': 'unknown'}), 404
    from urllib.parse import urlsplit
    for u in starts:
        if urlsplit(u).scheme not in ('http', 'https') or not urlsplit(u).netloc:
            return jsonify({'error': 'that is not a web address'}), 400
        try:
            _check_public(u)
        except UnsafeURL as e:
            return jsonify({'error': f"Prepify can't read that link: {e}.", 'needs_url': True, 'reason': 'unsafe'}), 400

    pages, seen, queue = [], set(), list(starts)
    blocked = fetched = 0
    while queue and len(pages) < 4 and len(seen) < 10:
        u = queue.pop(0)
        if u in seen:
            continue
        seen.add(u)
        if not _allowed_by_robots(u):
            blocked += 1
            continue
        try:
            page = _read_official_page(u)
        except Exception:
            continue
        if not page:
            continue
        fetched += 1
        if page['sections']:
            pages.append({'title': page['title'], 'url': page['url'], 'sections': page['sections']})
        queue += [l for l in page['links'] if l not in seen]
    if not pages:
        host = urlsplit(starts[0]).netloc.replace('www.', '')
        if blocked and not fetched:
            reason, msg = 'robots', f"{host} doesn't allow automated reading."
        elif fetched:
            reason, msg = 'unreadable', f"{host} builds its pages in the browser, so there is no hiring information Prepify can read."
        else:
            reason, msg = 'unreachable', f"{host} couldn't be reached."
        return jsonify({'error': msg, 'needs_url': True, 'reason': reason, 'tried': starts[0]}), 404
    return jsonify({'source': 'Official', 'url': starts[0], 'company_name': company,
                    'official': pages, 'questions': [], 'reviews': [], 'experiences': []})


# ---------- Where a company lives on sites whose addresses can't be guessed (site_index.py) ----------
@app.route('/api/sources/locate', methods=['GET'])
def locate_source():
    if not current_user():
        return jsonify({'error': 'sign in to pull sources'}), 401
    site = request.args.get('site') or ''
    company = (request.args.get('company') or '').strip()[:100]
    if site not in site_index.SITES or not company:
        return jsonify({'error': 'site and company required'}), 400
    try:
        return jsonify(site_index.locate(site, company))
    except site_index.IndexError_ as e:
        return jsonify({'error': str(e)}), 502


# ---------- Pages ----------
@app.route('/')
def home():
    return render_template('search.html')


def _prepify_already_running():
    """Is something already answering on the port, and is it Prepify?"""
    import socket
    with socket.socket() as s:
        s.settimeout(0.5)
        if s.connect_ex(('127.0.0.1', PORT)) != 0:
            return None                           # the port is free
    try:
        import requests
        return 'google_client_id' in requests.get(f'http://127.0.0.1:{PORT}/api/auth/config', timeout=2).json()
    except Exception:
        return False                              # something else holds the port


def main():
    """Start Prepify and open it in the browser. PREPIFY_DEBUG=1 runs Flask's auto-reloading dev server."""
    import webbrowser
    url = f'http://localhost:{PORT}'               # localhost, not 127.0.0.1: Google sign-in is registered for it
    debug = os.environ.get('PREPIFY_DEBUG') == '1'
    if debug and os.environ.get('WERKZEUG_RUN_MAIN'):
        # the auto-reloader's restarted copy: its parent already holds the port for it, so don't check it
        app.run(debug=True, port=PORT)
        return
    no_browser = os.environ.get('PREPIFY_NO_BROWSER') == '1'
    running = _prepify_already_running()
    if running:
        print(f'Prepify is already running. Opening {url}')
        if not no_browser:
            webbrowser.open(url)
        return
    if running is False:
        print(f'Port {PORT} is being used by another program, and Prepify needs it (Google sign-in and the '
              f'extension are set up for localhost:{PORT}). Close that program and start Prepify again.')
        if FROZEN:
            input('Press Enter to close.')
        sys.exit(1)

    if debug:
        app.run(debug=True, port=PORT)
        return
    print(f'Prepify is running at {url}\nKeep this window open while you use it; close it to stop Prepify.')
    if not no_browser:
        import threading
        threading.Timer(1.0, webbrowser.open, [url]).start()
    try:
        from waitress import serve
        serve(app, host='127.0.0.1', port=PORT, threads=8)
    except ImportError:
        app.run(host='127.0.0.1', port=PORT, threaded=True)


if __name__ == '__main__':
    main()
