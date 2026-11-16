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

try:  # settings from .env (GOOGLE_CLIENT_ID, PREPIFY_SECRET); real environment variables win
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))
except ImportError:
    pass

app = Flask(__name__, static_folder='static', template_folder='templates')

# Sessions are signed cookies, not server storage. Without PREPIFY_SECRET a fresh key is made
# on every start, which simply signs everyone out after a restart.
app.secret_key = os.environ.get('PREPIFY_SECRET') or secrets.token_hex(32)
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
)

GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', '').strip()


# ---------- Query understanding ----------
STOPWORDS = set('''
a about all an and any are as asked at be can common company crack do expect experience experiences
for frequently from get give hiring how i in interview interviews is job list me most my of on or
please prepare preparation process question questions recruitment role round rounds should show study
tell the their to topics want what which with
hr technical coding reviews review culture salary salaries rating ratings
into join joining clear clearing cracking placement placements campus off drive fresher freshers
'''.split())

ROLE_PATTERNS = [
    r'\bfor (?:the |an? )?([a-z][\w\s\-/]*?) (?:role|position|profile|post)\b',
    r'\b(?:as|for) (?:an? |the )?((?:associate |senior |junior |lead |staff )?'
    r'(?:software|data|product|business|system|systems|full stack|frontend|backend|devops|cloud|qa|test)'
    r'[\w\s\-]*?(?:engineer|analyst|developer|manager|scientist|consultant|intern))\b',
]

# (regex on the original-case query, role name). Longer patterns first. "GET" must be upper case
# so the English word "get" is not mistaken for Graduate Engineer Trainee.
ROLE_ALIASES = [
    (r'(?i)\bgenc\s+(next|elevate|pro)\b', None),
    (r'(?i)\bspecialist programmer\b', 'Specialist Programmer'),
    (r'(?i)\bpower programmer\b', 'Power Programmer'),
    (r'(?i)\bsde[\s\-]?([123])\b', None),
    (r'(?i)\bsde\b', 'Software Development Engineer'),
    (r'(?i)\base\b', 'Associate Software Engineer'),
    (r'(?i)\bsse\b', 'Senior Software Engineer'),
    (r'(?i)\bswe\b', 'Software Engineer'),
    (r'(?i)\bmts\b', 'Member of Technical Staff'),
    (r'(?i)\bdse\b', 'Digital Specialist Engineer'),
    (r'\bGET\b', 'Graduate Engineer Trainee'),
    (r'(?i)\bninja\b', 'Ninja'),
    (r'(?i)\bdigital\b', 'Digital'),
    (r'(?i)\bprime\b', 'Prime'),
    (r'(?i)\bgenc\b', 'GenC'),
    (r'(?i)\belite\b', 'Elite'),
    (r'(?i)\bturbo\b', 'Turbo'),
]

INTENT_WORDS = {
    'questions': ['question', 'asked'],
    'process': ['process', 'round', 'recruitment', 'hiring', 'selection'],
    'technical': ['technical', 'coding', 'dsa', 'aptitude'],
    'hr': ['hr', 'managerial', 'behavioral', 'behavioural'],
    'reviews': ['review', 'culture', 'rating', 'work life', 'salary'],
}


def parse_query(q, known=()):
    """Split a free-text query into company, role and intents.

    `known` = company names the browser already has data for; a match wins over guessing.
    """
    original = ' '.join(q.split())
    low = original.lower()

    role = None
    for pat in ROLE_PATTERNS:
        m = re.search(pat, low)
        if m:
            # "for Accenture for the X role" -> the role clause starts at the LAST "for"/"as"
            start = m.start()
            inner = list(re.finditer(r'\b(?:for|as) (?:the |an? )?', low[m.start():m.start(1) + len(m.group(1))]))
            if len(inner) > 1:
                start = m.start() + inner[-1].start()
                role_start = m.start() + inner[-1].end()
            else:
                role_start = m.start(1)
            role = original[role_start:m.end(1)].strip()
            low = low[:start] + ' ' + low[m.end():]
            original = original[:start] + ' ' + original[m.end():]
            break

    # Abbreviated roles (ASE, SDE...) and campus hiring tracks (TCS Ninja, Cognizant GenC...)
    if not role:
        for pat, name in ROLE_ALIASES:
            m = re.search(pat, original)
            if m:
                role = name or ' '.join(
                    'SDE' if w.lower() == 'sde' else 'GenC' if w.lower() == 'genc' else w.capitalize()
                    for w in re.split(r'[\s\-]+', m.group(0)))
                low = low[:m.start()] + ' ' + low[m.end():]
                original = original[:m.start()] + ' ' + original[m.end():]
                break

    intents = [k for k, words in INTENT_WORDS.items() if any(w in low for w in words)] or ['questions']

    hits = [n for n in known if n and re.search(r'\b' + re.escape(n.lower()) + r'\b', low)]
    if hits:
        company = max(hits, key=len)
    else:
        tokens = [t.strip(".'-") for t in re.findall(r"[A-Za-z0-9&.'\-]+", original)]
        tokens = [t for t in tokens if re.search(r'[A-Za-z0-9]', t)]
        best, cur = [], []
        for t in tokens:
            if t.lower().strip(".'") in STOPWORDS:
                if len(cur) > len(best):
                    best = cur
                cur = []
            else:
                cur.append(t)
        if len(cur) > len(best):
            best = cur
        company = ' '.join(w if w.isupper() else w[:1].upper() + w[1:] for w in best) or None

    return {'company': company, 'role': role, 'intents': intents}


@app.route('/api/parse', methods=['GET'])
def parse():
    q = (request.args.get('q') or '').strip()
    if not q:
        return jsonify({'error': 'empty query'}), 400
    known = [k for k in request.args.getlist('known') if k][:200]
    return jsonify({'query': q, 'parsed': parse_query(q, known)})


# ---------- Sign in with Google (optional) ----------
def current_user():
    return session.get('user')


@app.route('/api/auth/config', methods=['GET'])
def auth_config():
    return jsonify({'google_client_id': GOOGLE_CLIENT_ID or None, 'user': current_user(),
                    'sources': {'reddit_api': bool(REDDIT_CLIENT_ID)}})


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
        info = id_token.verify_oauth2_token(credential, google_requests.Request(), GOOGLE_CLIENT_ID)
    except Exception:
        return jsonify({'error': 'invalid Google sign-in'}), 401
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
