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

from flask import Flask, jsonify, render_template, request, session

try:  # settings from .env (GOOGLE_CLIENT_ID, PREPIFY_SECRET, GROQ_API_KEY); real environment variables win
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))
except ImportError:
    pass

import ai  # noqa: E402  (reads its settings from the environment loaded above)
import jd as jd_reader  # noqa: E402
from query_parser import parse_query  # noqa: E402

app = Flask(__name__, static_folder='static', template_folder='templates')

# Sessions are signed cookies, not server storage. Without PREPIFY_SECRET a fresh key is made
# on every start, which simply signs everyone out after a restart.
app.secret_key = os.environ.get('PREPIFY_SECRET') or secrets.token_hex(32)
app.config.update(
    MAX_CONTENT_LENGTH=12 * 1024 * 1024,   # a JD and a resume upload
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
)

GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', '').strip()


# ---------- Query understanding (query_parser.py) and job descriptions (jd.py) ----------
@app.route('/api/parse', methods=['GET'])
def parse():
    q = (request.args.get('q') or '').strip()
    if not q:
        return jsonify({'error': 'empty query'}), 400
    known = [k for k in request.args.getlist('known') if k][:200]
    return jsonify({'query': q, 'parsed': parse_query(q, known)})


@app.route('/api/jd', methods=['POST'])
def analyse_jd():
    """Analyse a job description (file or pasted text) and, optionally, a resume.
    With use_ai=1 (signed in, AI set up) the AI reads it; the rules are the fallback.
    Nothing is kept: the text is read, analysed and the result is returned."""
    user = current_user()
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
        rf = request.files.get('resume_file')
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
            ai.charge(user['email'])
            try:
                analysis, _ = ai.read_jd(text, resume_text)
            except Exception:
                ai.refund(user['email'])
                raise
            return jsonify({'analysis': analysis, 'text': text if jd_file else None, 'ai': ai.status(user)})
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
                    'ai': ai.status(user)})


# ---------- AI assist (ai.py): signed-in users only, with a daily limit per user ----------
def _ai_begin():
    """The signed-in user, after counting one AI request; or an error response."""
    user = current_user()
    if not user:
        return None, (jsonify({'error': 'Sign in to use AI assist.'}), 401)
    if not ai.available():
        return None, (jsonify({'error': 'AI assist is not set up on this server.', 'ai': ai.status(user)}), 503)
    try:
        ai.charge(user['email'])
    except ai.AILimit as e:
        return None, (jsonify({'error': str(e), 'ai': ai.status(user)}), 429)
    return user, None


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
    user, err = _ai_begin()
    if err:
        return err
    try:
        out, model = ai.tidy_questions(str(body.get('company') or ''), items, known)
    except Exception as e:
        return _ai_failed(user, e, 'question tidying')
    return jsonify({**out, 'model': model, 'ai': ai.status(user)})


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
    return jsonify({'query': q, 'parsed': parsed, 'ai': ai.status(user)})


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
    'tcs': 'https://www.tcs.com/careers',
    'tata consultancy services': 'https://www.tcs.com/careers',
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
    'target': 'https://india.target.com/',
    'target corporation': 'https://india.target.com/',
    'cme group': 'https://www.cmegroup.com/careers.html',
}
OFFICIAL_UA = 'Prepify/0.6 (personal interview preparation; reads public careers pages)'
OFFICIAL_LINK_WORDS = re.compile(r'campus|graduate|fresher|freshers|students?|universit|early.?career|entry.?level|'
                                 r'eligib|selection|hiring process|recruitment|how we hire|interview|internship', re.I)
OFFICIAL_SECTION_WORDS = re.compile(r'\b(eligib\w*|selection|hiring process|recruitment process|interview rounds?|online tests?|coding tests?|aptitude|'
                                    r'assessments?|interviews?|pattern|how to apply|qualif\w*|criteria|campus|graduates?|'
                                    r'freshers?|what to expect|prepar\w*)\b', re.I)


def _allowed_by_robots(url):
    from urllib import robotparser
    from urllib.parse import urlsplit
    import requests
    parts = urlsplit(url)
    rp = robotparser.RobotFileParser()
    try:
        r = requests.get(f'{parts.scheme}://{parts.netloc}/robots.txt', headers={'User-Agent': OFFICIAL_UA}, timeout=10)
        if r.status_code >= 400:
            return True                      # no robots.txt: allowed
        rp.parse(r.text.splitlines())
        return rp.can_fetch(OFFICIAL_UA, url)
    except Exception:
        return True


def _read_official_page(url):
    """Title, relevant sections (heading + paragraphs/list items) and promising same-site links."""
    import requests
    from bs4 import BeautifulSoup
    from urllib.parse import urljoin, urlsplit
    r = requests.get(url, headers={'User-Agent': OFFICIAL_UA, 'Accept-Language': 'en-IN,en;q=0.8'}, timeout=15)
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
    if not current_user():
        return jsonify({'error': 'sign in to pull sources'}), 401
    company = (request.args.get('company') or '').strip()[:100]
    url = (request.args.get('url') or '').strip()
    if not url:
        url = OFFICIAL_PAGES.get(company.lower()) or OFFICIAL_PAGES.get(company.lower().split(' ')[0], '')
    if not url:
        return jsonify({'error': 'no official page known', 'needs_url': True}), 404
    from urllib.parse import urlsplit
    if urlsplit(url).scheme not in ('http', 'https') or not urlsplit(url).netloc:
        return jsonify({'error': 'that is not a web address'}), 400

    pages, seen, queue = [], set(), [url]
    while queue and len(pages) < 4:
        u = queue.pop(0)
        if u in seen:
            continue
        seen.add(u)
        if not _allowed_by_robots(u):
            continue
        try:
            page = _read_official_page(u)
        except Exception:
            continue
        if not page:
            continue
        if page['sections']:
            pages.append({'title': page['title'], 'url': page['url'], 'sections': page['sections']})
        queue += [l for l in page['links'] if l not in seen]
    return jsonify({'source': 'Official', 'url': url, 'company_name': company,
                    'official': pages, 'questions': [], 'reviews': [], 'experiences': []})


# ---------- Pages ----------
@app.route('/')
def home():
    return render_template('search.html')


if __name__ == '__main__':
    app.run(debug=True, port=5000)
