import os
import re
import sqlite3
from datetime import datetime
from flask import Flask, render_template, request, jsonify, g

app = Flask(__name__, static_folder='static', template_folder='templates')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'data', 'interview.db')


def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        db = g._database = sqlite3.connect(DB_PATH)
        db.row_factory = sqlite3.Row
    return db


@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()


def init_db():
    with app.app_context():
        db = get_db()
        c = db.cursor()
        c.execute('''CREATE TABLE IF NOT EXISTS companies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            industry TEXT,
            size TEXT,
            location TEXT,
            website TEXT,
            notes TEXT,
            created_at TEXT
        )''')
        c.execute('''CREATE TABLE IF NOT EXISTS roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            level TEXT,
            department TEXT,
            description TEXT,
            created_at TEXT,
            FOREIGN KEY (company_id) REFERENCES companies(id)
        )''')
        c.execute('''CREATE TABLE IF NOT EXISTS questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            role_id INTEGER NOT NULL,
            round_type TEXT,
            category TEXT,
            text TEXT NOT NULL,
            topic TEXT,
            difficulty TEXT,
            source TEXT,
            tags TEXT,
            created_at TEXT,
            FOREIGN KEY (role_id) REFERENCES roles(id)
        )''')
        c.execute('''CREATE TABLE IF NOT EXISTS answers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            question_id INTEGER NOT NULL,
            user_answer TEXT,
            code TEXT,
            language TEXT,
            time_spent INTEGER,
            self_rating INTEGER,
            feedback TEXT,
            score REAL,
            created_at TEXT,
            FOREIGN KEY (question_id) REFERENCES questions(id)
        )''')
        c.execute('''CREATE TABLE IF NOT EXISTS reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL,
            source TEXT,
            rating REAL,
            title TEXT,
            pros TEXT,
            cons TEXT,
            body TEXT,
            job_title TEXT,
            review_date TEXT,
            url TEXT,
            created_at TEXT,
            FOREIGN KEY (company_id) REFERENCES companies(id)
        )''')
        c.execute('''CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )''')
        # lightweight migration for existing DBs
        qcols = [r['name'] for r in c.execute('PRAGMA table_info(questions)').fetchall()]
        if 'url' not in qcols:
            c.execute('ALTER TABLE questions ADD COLUMN url TEXT')
        db.commit()


# ---------- Companies ----------
@app.route('/api/companies', methods=['GET'])
def list_companies():
    rows = get_db().execute('SELECT * FROM companies ORDER BY created_at DESC').fetchall()
    return jsonify([dict(r) for r in rows])


@app.route('/api/companies', methods=['POST'])
def add_company():
    d = request.get_json() or {}
    now = datetime.utcnow().isoformat()
    cur = get_db().execute(
        'INSERT INTO companies (name, industry, size, location, website, notes, created_at) VALUES (?,?,?,?,?,?,?)',
        (d.get('name'), d.get('industry'), d.get('size'), d.get('location'), d.get('website'), d.get('notes'), now)
    )
    get_db().commit()
    return jsonify({'id': cur.lastrowid}), 201


# ---------- Roles ----------
@app.route('/api/roles', methods=['GET'])
def list_roles():
    company_id = request.args.get('company_id')
    if company_id:
        rows = get_db().execute(
            'SELECT * FROM roles WHERE company_id = ? ORDER BY created_at DESC', (company_id,)
        ).fetchall()
    else:
        rows = get_db().execute('SELECT * FROM roles ORDER BY created_at DESC').fetchall()
    return jsonify([dict(r) for r in rows])


@app.route('/api/roles', methods=['POST'])
def add_role():
    d = request.get_json() or {}
    now = datetime.utcnow().isoformat()
    cur = get_db().execute(
        'INSERT INTO roles (company_id, title, level, department, description, created_at) VALUES (?,?,?,?,?,?)',
        (d.get('company_id'), d.get('title'), d.get('level'), d.get('department'), d.get('description'), now)
    )
    get_db().commit()
    return jsonify({'id': cur.lastrowid}), 201


# ---------- Questions ----------
@app.route('/api/questions', methods=['GET'])
def list_questions():
    role_id = request.args.get('role_id')
    if role_id:
        rows = get_db().execute(
            'SELECT * FROM questions WHERE role_id = ? ORDER BY created_at DESC', (role_id,)
        ).fetchall()
    else:
        rows = get_db().execute('SELECT * FROM questions ORDER BY created_at DESC').fetchall()
    return jsonify([dict(r) for r in rows])


@app.route('/api/questions', methods=['POST'])
def add_question():
    d = request.get_json() or {}
    now = datetime.utcnow().isoformat()
    cur = get_db().execute(
        '''INSERT INTO questions (role_id, round_type, category, text, topic, difficulty, source, tags, created_at)
           VALUES (?,?,?,?,?,?,?,?,?)''',
        (d.get('role_id'), d.get('round_type'), d.get('category'), d.get('text'),
         d.get('topic'), d.get('difficulty'), d.get('source'), d.get('tags'), now)
    )
    get_db().commit()
    return jsonify({'id': cur.lastrowid}), 201


# ---------- Import ----------
@app.route('/api/import/questions', methods=['POST'])
def import_questions():
    d = request.get_json() or {}
    items = d.get('items', [])
    role_id = d.get('role_id')
    if not items:
        return jsonify({'error': 'no items provided'}), 400
    if not role_id:
        return jsonify({'error': 'role_id is required'}), 400
    db = get_db()
    c = db.cursor()
    now = datetime.utcnow().isoformat()
    count = 0
    for item in items:
        c.execute(
            '''INSERT INTO questions (role_id, round_type, category, text, topic, difficulty, source, tags, created_at)
               VALUES (?,?,?,?,?,?,?,?,?)''',
            (role_id, item.get('round_type'), item.get('category'), item.get('text'),
             item.get('topic'), item.get('difficulty'), item.get('source'), item.get('tags'), now)
        )
        count += 1
    db.commit()
    return jsonify({'imported': count}), 201


# ---------- Answers ----------
@app.route('/api/answers', methods=['GET'])
def list_answers():
    question_id = request.args.get('question_id')
    if question_id:
        rows = get_db().execute(
            'SELECT * FROM answers WHERE question_id = ? ORDER BY created_at DESC', (question_id,)
        ).fetchall()
    else:
        rows = get_db().execute('SELECT * FROM answers ORDER BY created_at DESC').fetchall()
    return jsonify([dict(r) for r in rows])


@app.route('/api/answers', methods=['POST'])
def add_answer():
    d = request.get_json() or {}
    now = datetime.utcnow().isoformat()
    cur = get_db().execute(
        '''INSERT INTO answers (question_id, user_answer, code, language, time_spent, self_rating, feedback, score, created_at)
           VALUES (?,?,?,?,?,?,?,?,?)''',
        (d.get('question_id'), d.get('user_answer'), d.get('code'), d.get('language'),
         d.get('time_spent'), d.get('self_rating'), d.get('feedback'), d.get('score'), now)
    )
    get_db().commit()
    return jsonify({'id': cur.lastrowid}), 201


# ---------- Dashboard ----------
@app.route('/api/dashboard', methods=['GET'])
def dashboard():
    db = get_db()
    companies = db.execute('SELECT COUNT(*) as c FROM companies').fetchone()['c']
    roles = db.execute('SELECT COUNT(*) as c FROM roles').fetchone()['c']
    questions = db.execute('SELECT COUNT(*) as c FROM questions').fetchone()['c']
    answers = db.execute('SELECT COUNT(*) as c FROM answers').fetchone()['c']
    reviews = db.execute('SELECT COUNT(*) as c FROM reviews').fetchone()['c']
    by_category = db.execute('SELECT category, COUNT(*) as c FROM questions GROUP BY category').fetchall()
    return jsonify({
        'companies': companies,
        'roles': roles,
        'questions': questions,
        'answers': answers,
        'reviews': reviews,
        'by_category': [dict(r) for r in by_category]
    })


# ---------- Active company (set by the app, read by the browser extension) ----------
@app.route('/api/active', methods=['GET'])
def get_active():
    db = get_db()
    row = db.execute("SELECT value FROM settings WHERE key='active_company_id'").fetchone()
    if not row:
        return jsonify({'company': None})
    c = db.execute('SELECT id, name FROM companies WHERE id = ?', (row['value'],)).fetchone()
    return jsonify({'company': dict(c) if c else None})


@app.route('/api/active', methods=['POST'])
def set_active():
    d = request.get_json() or {}
    db = get_db()
    company_id = d.get('company_id')
    name = (d.get('name') or '').strip()
    if not company_id and name:
        company_id = find_or_create_company(db, name)
    if not company_id:
        return jsonify({'error': 'company_id or name required'}), 400
    db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('active_company_id', ?)", (str(company_id),))
    db.commit()
    c = db.execute('SELECT id, name FROM companies WHERE id = ?', (company_id,)).fetchone()
    return jsonify({'company': dict(c)})


# ---------- Reviews ----------
@app.route('/api/reviews', methods=['GET'])
def list_reviews():
    company_id = request.args.get('company_id')
    q = 'SELECT r.*, c.name AS company_name FROM reviews r JOIN companies c ON c.id = r.company_id'
    if company_id:
        rows = get_db().execute(q + ' WHERE r.company_id = ? ORDER BY r.created_at DESC', (company_id,)).fetchall()
    else:
        rows = get_db().execute(q + ' ORDER BY r.created_at DESC').fetchall()
    return jsonify([dict(r) for r in rows])


# ---------- Capture (called by the browser extension) ----------
def find_or_create_company(db, name):
    row = db.execute('SELECT id FROM companies WHERE lower(name) = lower(?)', (name.strip(),)).fetchone()
    if row:
        return row['id']
    cur = db.execute('INSERT INTO companies (name, created_at) VALUES (?, ?)',
                     (name.strip(), datetime.utcnow().isoformat()))
    return cur.lastrowid


def find_or_create_role(db, company_id, title):
    title = (title or 'General').strip() or 'General'
    row = db.execute('SELECT id FROM roles WHERE company_id = ? AND lower(title) = lower(?)',
                     (company_id, title)).fetchone()
    if row:
        return row['id']
    cur = db.execute('INSERT INTO roles (company_id, title, created_at) VALUES (?,?,?)',
                     (company_id, title, datetime.utcnow().isoformat()))
    return cur.lastrowid


@app.route('/api/capture', methods=['POST'])
def capture():
    # Custom header forces a CORS preflight, so random websites can't write to this local API.
    if request.headers.get('X-Prepify') != '1':
        return jsonify({'error': 'forbidden'}), 403
    d = request.get_json() or {}
    db = get_db()
    now = datetime.utcnow().isoformat()
    source = d.get('source') or 'Unknown'
    url = d.get('url')

    company_id = d.get('company_id')
    if not company_id:
        active = db.execute("SELECT value FROM settings WHERE key='active_company_id'").fetchone()
        if active:
            company_id = int(active['value'])
        elif d.get('company_name'):
            company_id = find_or_create_company(db, d['company_name'])
    if not company_id:
        return jsonify({'error': 'no company: search one in Prepify first'}), 400

    added_q = added_r = skipped = 0

    for it in d.get('questions', []):
        text = (it.get('text') or '').strip()
        if not text:
            continue
        role_id = find_or_create_role(db, company_id, it.get('role'))
        if db.execute('SELECT 1 FROM questions WHERE role_id = ? AND text = ?', (role_id, text)).fetchone():
            skipped += 1
            continue
        db.execute(
            '''INSERT INTO questions (role_id, round_type, category, text, topic, difficulty, source, tags, created_at, url)
               VALUES (?,?,?,?,?,?,?,?,?,?)''',
            (role_id, it.get('round_type') or 'Interview', it.get('category') or 'Other', text,
             it.get('topic'), it.get('difficulty'), source, it.get('tags'), now, url))
        added_q += 1

    for it in d.get('reviews', []):
        body = (it.get('body') or '').strip()
        pros = (it.get('pros') or '').strip()
        cons = (it.get('cons') or '').strip()
        title = (it.get('title') or '').strip()
        if not (body or pros or cons or title):
            continue
        dup = db.execute(
            "SELECT 1 FROM reviews WHERE company_id=? AND source=? AND ifnull(title,'')=? "
            "AND ifnull(pros,'')=? AND ifnull(cons,'')=? AND ifnull(body,'')=?",
            (company_id, source, title, pros, cons, body)).fetchone()
        if dup:
            skipped += 1
            continue
        db.execute(
            '''INSERT INTO reviews (company_id, source, rating, title, pros, cons, body, job_title, review_date, url, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)''',
            (company_id, source, it.get('rating'), title, pros, cons, body,
             it.get('job_title'), it.get('date'), url, now))
        added_r += 1

    db.commit()
    return jsonify({'questions_added': added_q, 'reviews_added': added_r, 'duplicates_skipped': skipped,
                    'company_id': company_id}), 201


# ---------- Search ----------
STOPWORDS = set('''
a about all an and any are as asked at be can common company crack do expect experience experiences
for frequently from get give hiring how i in interview interviews is job list me most my of on or
please prepare preparation process question questions recruitment role round rounds should show study
tell the their to topics want what which with
hr technical coding reviews review culture salary salaries rating ratings
'''.split())

ROLE_PATTERNS = [
    r'\bfor (?:the |an? )?([a-z][\w\s\-/]*?) (?:role|position|profile|post)\b',
    r'\b(?:as|for) (?:an? |the )?((?:associate |senior |junior |lead |staff )?'
    r'(?:software|data|product|business|system|systems|full stack|frontend|backend|devops|cloud|qa|test)'
    r'[\w\s\-]*?(?:engineer|analyst|developer|manager|scientist|consultant|intern))\b',
]

INTENT_WORDS = {
    'questions': ['question', 'asked'],
    'process': ['process', 'round', 'recruitment', 'hiring', 'selection'],
    'technical': ['technical', 'coding', 'dsa', 'aptitude'],
    'hr': ['hr', 'managerial', 'behavioral', 'behavioural'],
    'reviews': ['review', 'culture', 'rating', 'work life', 'salary'],
}


def parse_query(q):
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

    intents = [k for k, words in INTENT_WORDS.items() if any(w in low for w in words)] or ['questions']

    # Company = a saved company named in the query, else the longest run of non-filler words.
    db = get_db()
    known = [r['name'] for r in db.execute('SELECT name FROM companies').fetchall()]
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


@app.route('/api/search', methods=['GET'])
def search():
    q = (request.args.get('q') or '').strip()
    if not q:
        return jsonify({'error': 'empty query'}), 400
    db = get_db()
    parsed = parse_query(q)
    result = {'query': q, 'parsed': parsed, 'company': None, 'questions': [], 'reviews': []}
    if not parsed['company']:
        return jsonify(result)

    c = db.execute('SELECT * FROM companies WHERE lower(name) = lower(?)', (parsed['company'],)).fetchone()
    if not c:
        c = db.execute('SELECT * FROM companies WHERE lower(name) LIKE lower(?) ORDER BY length(name) LIMIT 1',
                       ('%' + parsed['company'] + '%',)).fetchone()
    if not c:
        return jsonify(result)
    result['company'] = dict(c)

    sql = '''SELECT q.*, r.title AS role_title FROM questions q JOIN roles r ON r.id = q.role_id
             WHERE r.company_id = ?'''
    args = [c['id']]
    if parsed['role']:
        role_rows = db.execute(sql + ' AND lower(r.title) LIKE lower(?) ORDER BY q.created_at DESC',
                               args + ['%' + parsed['role'] + '%']).fetchall()
        result['role_matched'] = bool(role_rows)
        rows = role_rows or db.execute(sql + ' ORDER BY q.created_at DESC', args).fetchall()
    else:
        rows = db.execute(sql + ' ORDER BY q.created_at DESC', args).fetchall()
    result['questions'] = [dict(r) for r in rows]
    result['reviews'] = [dict(r) for r in db.execute(
        'SELECT * FROM reviews WHERE company_id = ? ORDER BY created_at DESC', (c['id'],)).fetchall()]
    return jsonify(result)


# ---------- Pages ----------
@app.route('/')
def home():
    return render_template('search.html')


@app.route('/workspace')
def index():
    return render_template('index.html')


init_db()

if __name__ == '__main__':
    app.run(debug=True, port=5000)