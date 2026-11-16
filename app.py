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
    return jsonify({'google_client_id': GOOGLE_CLIENT_ID or None, 'user': current_user()})


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


# ---------- Pages ----------
@app.route('/')
def home():
    return render_template('search.html')


if __name__ == '__main__':
    app.run(debug=True, port=5000)
