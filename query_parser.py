"""Understanding a search such as "amazon sde 2 bangalore online assessment questions 2025".

parse_query() returns the company, role, level, experience, location, year, interview rounds,
topics and what the person wants (questions, process, reviews...). Recognised pieces are taken
out of the query one by one, so whatever is left over is most likely the company name.
"""
import difflib
import re

from skills import COMPILED, SKILLS, public

# ---------- companies: canonical name -> other ways people write it ----------
COMPANIES = {
    'Amazon': ['amazon', 'amzn', 'amazon india', 'aws india'],
    'Google': ['google', 'alphabet', 'google india'],
    'Microsoft': ['microsoft', 'msft', 'microsoft india', 'microsoft idc'],
    'Meta': ['meta', 'facebook', 'fb'],
    'Apple': ['apple'],
    'Netflix': ['netflix'],
    'Adobe': ['adobe'],
    'Oracle': ['oracle', 'oracle india'],
    'Salesforce': ['salesforce'],
    'SAP': ['sap', 'sap labs', 'sap labs india'],
    'Uber': ['uber'],
    'Atlassian': ['atlassian'],
    'Intuit': ['intuit'],
    'PayPal': ['paypal'],
    'Walmart': ['walmart', 'walmart global tech', 'walmart labs'],
    'Target Corporation': ['target corporation', 'target india', 'target corp'],
    'Flipkart': ['flipkart'],
    'Swiggy': ['swiggy'],
    'Zomato': ['zomato', 'eternal'],
    'Paytm': ['paytm', 'one97'],
    'PhonePe': ['phonepe', 'phone pe'],
    'Razorpay': ['razorpay'],
    'CRED': ['cred'],
    'Meesho': ['meesho'],
    'Myntra': ['myntra'],
    'Zoho': ['zoho'],
    'Freshworks': ['freshworks'],
    'Ola': ['ola', 'ola cabs', 'ola electric'],
    'Goldman Sachs': ['goldman sachs', 'goldman', 'gs india'],
    'JPMorgan Chase': ['jpmorgan chase', 'jpmorgan', 'jp morgan', 'j.p. morgan', 'jpmc', 'jp morgan chase'],
    'Morgan Stanley': ['morgan stanley'],
    'Deutsche Bank': ['deutsche bank', 'db india'],
    'Barclays': ['barclays'],
    'HSBC': ['hsbc'],
    'Citi': ['citi', 'citibank', 'citigroup', 'citicorp'],
    'American Express': ['american express', 'amex'],
    'Wells Fargo': ['wells fargo'],
    'Bank of America': ['bank of america', 'bofa', 'boa'],
    'Mastercard': ['mastercard'],
    'CME Group': ['cme group', 'cme'],
    'BNY': ['bny', 'bny mellon', 'bank of new york mellon'],
    'UBS': ['ubs'],
    'TCS': ['tcs', 'tata consultancy services', 'tata consultancy'],
    'Infosys': ['infosys', 'infy'],
    'Wipro': ['wipro'],
    'HCL Technologies': ['hcl', 'hcltech', 'hcl tech', 'hcl technologies'],
    'Tech Mahindra': ['tech mahindra', 'techm'],
    'Cognizant': ['cognizant', 'cts'],
    'Accenture': ['accenture'],
    'Capgemini': ['capgemini'],
    'Deloitte': ['deloitte', 'deloitte usi'],
    'EY': ['ey', 'ernst & young', 'ernst and young', 'ey gds'],
    'KPMG': ['kpmg'],
    'PwC': ['pwc', 'pricewaterhousecoopers', 'pwc ac'],
    'IBM': ['ibm', 'ibm india'],
    'LTIMindtree': ['ltimindtree', 'lti mindtree', 'lti', 'mindtree', 'l&t infotech'],
    'L&T Technology Services': ['ltts', 'l&t technology services'],
    'Mphasis': ['mphasis'],
    'Persistent Systems': ['persistent', 'persistent systems'],
    'Hexaware': ['hexaware'],
    'Zensar': ['zensar'],
    'Cisco': ['cisco'],
    'Intel': ['intel'],
    'Nvidia': ['nvidia'],
    'AMD': ['amd'],
    'Qualcomm': ['qualcomm'],
    'Samsung': ['samsung', 'samsung r&d', 'srib'],
    'Texas Instruments': ['texas instruments'],
    'VMware': ['vmware'],
    'Dell': ['dell', 'dell technologies'],
    'HP': ['hp', 'hewlett packard'],
    'Siemens': ['siemens'],
    'Bosch': ['bosch'],
    'Honeywell': ['honeywell'],
    'ZS Associates': ['zs', 'zs associates'],
    'McKinsey': ['mckinsey', 'mckinsey & company'],
    'BCG': ['bcg', 'boston consulting group'],
    'Bain': ['bain', 'bain & company'],
    'Media.net': ['media.net', 'medianet'],
    'Juspay': ['juspay'],
    'Rubrik': ['rubrik'],
    'Nutanix': ['nutanix'],
}
ALIAS = {}
for canon, names in COMPANIES.items():
    for n in [canon.lower()] + names:
        ALIAS[n] = canon
# Ordinary English words that are also company names: only treated as a company by position,
# never picked out of the middle of a sentence.
AMBIGUOUS = {'target', 'visa', 'apple', 'meta', 'oracle', 'ola', 'cred', 'bain', 'intel', 'citi', 'boa', 'fb', 'gs', 'db'}

ACRONYMS = {'tcs', 'ibm', 'hcl', 'ey', 'kpmg', 'pwc', 'sap', 'ge', 'lti', 'l&t', 'at&t', 'ntt', 'dxc', 'cgi', 'hp',
            'hsbc', 'ubs', 'bny', 'cme', 'jpmc', 'amd', 'ust', 'zs', 'bcg', 'atos', 'tcl', 'ltts', 'nasa', 'isro',
            'drdo', 'bhel', 'ongc', 'iocl', 'sbi', 'hdfc', 'icici', 'lic', 'rbi', 'ntpc', 'gail'}

# ---------- places ----------
LOCATIONS = {
    'bangalore': 'Bengaluru', 'bengaluru': 'Bengaluru', 'blr': 'Bengaluru', 'hyderabad': 'Hyderabad',
    'hyd': 'Hyderabad', 'pune': 'Pune', 'chennai': 'Chennai', 'mumbai': 'Mumbai', 'bombay': 'Mumbai',
    'delhi': 'Delhi', 'new delhi': 'Delhi', 'ncr': 'Delhi NCR', 'delhi ncr': 'Delhi NCR', 'gurgaon': 'Gurugram',
    'gurugram': 'Gurugram', 'noida': 'Noida', 'kolkata': 'Kolkata', 'ahmedabad': 'Ahmedabad', 'kochi': 'Kochi',
    'coimbatore': 'Coimbatore', 'trivandrum': 'Thiruvananthapuram', 'thiruvananthapuram': 'Thiruvananthapuram',
    'jaipur': 'Jaipur', 'indore': 'Indore', 'chandigarh': 'Chandigarh', 'mysore': 'Mysuru', 'mysuru': 'Mysuru',
    'bhubaneswar': 'Bhubaneswar', 'india': 'India', 'usa': 'United States', 'united states': 'United States',
    'uk': 'United Kingdom', 'united kingdom': 'United Kingdom', 'london': 'London', 'singapore': 'Singapore',
    'dublin': 'Dublin', 'seattle': 'Seattle', 'new york': 'New York', 'san francisco': 'San Francisco',
    'bay area': 'San Francisco Bay Area', 'toronto': 'Toronto', 'berlin': 'Berlin', 'dubai': 'Dubai',
    'remote': 'Remote',
}

# ---------- interview rounds ----------
ROUNDS = [
    ('Online assessment', r'\b(oa|nqt|national qualifier test|online assessments?|online tests?|coding tests?|hackerrank|codility|hackerearth|mettl|amcat|cocubes|elitmus)\b'),
    ('Aptitude', r'\b(aptitude|quant(itative)?|logical reasoning|verbal ability|reasoning)\b'),
    ('Coding', r'\b(coding|dsa|programming round|leetcode|data structures)\b'),
    ('Technical', r'\b(technical|tech round|tr\d?)\b'),
    ('System design', r'\b(system design|hld|lld|high[- ]level design|low[- ]level design)\b'),
    ('Machine coding', r'\bmachine coding\b'),
    ('Managerial', r'\b(managerial|hiring manager|manager round|mr round|techno[- ]managerial)\b'),
    ('HR', r'\b(hr|human resources?)\b'),
    ('Behavioural', r'\b(behaviou?ral|leadership principles?|culture fit|bar raiser|lp round|star method)\b'),
    ('Group discussion', r'\b(gd|group discussions?)\b'),
    ('Case study', r'\b(case study|case interview|guesstimates?)\b'),
    ('Puzzles', r'\bpuzzles?\b'),
]

# ---------- what the person wants ----------
INTENT_WORDS = {
    'questions': r'\b(questions?|asked|ask|faqs?)\b',
    'experiences': r'\b(experiences?|journey|story)\b',
    'process': r'\b(process|rounds?|recruitment|hiring|selection|pattern|stages?|syllabus)\b',
    'tips': r'\b(tips|prepare|preparation|crack|cracking|clear|guide|roadmap|how to)\b',
    'salary': r'\b(salary|salaries|ctc|package|lpa|compensation|pay)\b',
    'reviews': r'\b(reviews?|culture|ratings?|work[- ]life|wlb)\b',
}

# ---------- roles ----------
ROLE_NOUNS = r'(engineers?|recruiters?|developers?|analysts?|scientists?|managers?|consultants?|interns?|internship|architects?|' \
             r'designers?|administrators?|admin|trainees?|programmers?|testers?|specialists?|executives?|' \
             r'associates?|researchers?|officers?|representatives?|dbas?|sres?|leads?|technicians?)'
ROLE_WORDS = set('''
senior sr junior jr lead staff principal associate assistant chief head graduate trainee entry level mid
software data business product program project system systems network cloud devops site reliability full stack fullstack
frontend front backend back end mobile android ios web qa quality test testing automation machine learning ml ai
deep security cyber embedded hardware firmware research applied analytics bi marketing sales financial finance
operations support technical solutions solution application applications database sql salesforce sap java python
react node angular .net dotnet golang ruby php ui ux graphic game platform infrastructure reliability risk quantitative
quant credit investment audit tax science engineering development digital customer success integration etl big
devsecops mlops dataops computer vision nlp genai hr people talent sdet manual performance power servicenow
'''.split())
# Abbreviations and campus tracks, in priority order. "GET" only in capitals (not the verb "get").
ROLE_ALIASES = [
    (r'(?i)\bgenc\s+(next|elevate|pro)\b', None),
    (r'(?i)\bspecialist programmer\b', 'Specialist Programmer'),
    (r'(?i)\bpower programmer\b', 'Power Programmer'),
    (r'(?i)\bsystem engineer specialist\b', 'System Engineer Specialist'),
    (r'(?i)\bsde[\s\-]?(i{1,3}|[123])\b(\s+intern)?', None),
    (r'(?i)\bswe[\s\-]?(i{1,3}|[123])\b', None),
    (r'(?i)\bsde\s+intern\b', 'SDE Intern'),
    (r'(?i)\bsde\b', 'Software Development Engineer'),
    (r'(?i)\bsdet\b', 'SDET'),
    (r'(?i)\base\b', 'Associate Software Engineer'),
    (r'(?i)\bsse\b', 'Senior Software Engineer'),
    (r'(?i)\bswe\b', 'Software Engineer'),
    (r'(?i)\bmts\b', 'Member of Technical Staff'),
    (r'(?i)\bdse\b', 'Digital Specialist Engineer'),
    (r'(?i)\bpm\b', 'Product Manager'),
    (r'(?i)\bapm\b', 'Associate Product Manager'),
    (r'(?i)\bsre\b', 'Site Reliability Engineer'),
    (r'(?i)\bba\b', 'Business Analyst'),
    (r'\bGET\b', 'Graduate Engineer Trainee'),
    (r'(?i)\bninja\b', 'Ninja'),
    (r'(?i)\bdigital\b(?!\s+(marketing|transformation))', 'Digital'),
    (r'(?i)\bprime\b', 'Prime'),
    (r'(?i)\bgenc\b', 'GenC'),
    (r'(?i)\belite\b', 'Elite'),
    (r'(?i)\bturbo\b', 'Turbo'),
]
UPPER_WORDS = {'sde', 'swe', 'qa', 'ml', 'ai', 'ui', 'ux', 'bi', 'sre', 'sap', 'sql', 'etl', 'hr', 'it', 'nlp', 'dba',
               'sdet', 'mts', 'devops', 'devsecops', 'mlops', 'ii', 'iii', 'apm', 'pm', 'get', 'genai'}
NICE_CASE = {'devops': 'DevOps', 'devsecops': 'DevSecOps', 'mlops': 'MLOps', 'ios': 'iOS', '.net': '.NET',
             'dotnet': '.NET', 'genai': 'GenAI', 'fullstack': 'Full Stack', 'javascript': 'JavaScript'}

STOPWORDS = set('''
a about all an and any are as asked at be best can common company companies crack do does expect for frequently from get
give guide how i in interview interviews is it job jobs list latest me most my of off on or please prepare preparation
recent should show study tell the their them this to top topics want what which with year years
into join joining clear clearing cracking placement placements campus drive drives fresher freshers new grad lateral
hiring role position batch profile post opening openings vacancy vacancies like real actual
'''.split())
LEGAL_SUFFIXES = {'pvt', 'pvt.', 'private', 'ltd', 'ltd.', 'limited', 'inc', 'inc.', 'llc', 'llp', 'plc', 'gmbh', 'co', 'co.'}


def _nice(word):
    w = word.lower()
    if w in NICE_CASE:
        return NICE_CASE[w]
    if w in UPPER_WORDS or re.fullmatch(r'l\d', w):
        return w.upper()
    return word[:1].upper() + word[1:] if word.islower() else word


def _role_case(text):
    return ' '.join(_nice(w) for w in text.split())


class _Query:
    """The query text with recognised pieces blanked out, so they don't end up in the company name."""

    def __init__(self, text):
        self.text = text

    def take(self, m_or_span):
        a, b = m_or_span.span() if hasattr(m_or_span, 'span') else m_or_span
        self.text = self.text[:a] + ' ' * (b - a) + self.text[b:]

    @property
    def low(self):
        return self.text.lower()


def _overrides(q):
    """company:"Target" role:"Data Analyst" written by the edit chips (or by power users)."""
    found = {}
    for key in ('company', 'role', 'location'):
        m = re.search(key + r':\s*(?:"([^"]+)"|(\S+))', q.text, re.I)
        if m:
            found[key] = (m.group(1) or m.group(2)).strip()
            q.take(m)
    return found


def _find_role(q):
    low = q.low
    # 1. "for the data analyst role", "as an associate software engineer"
    m = re.search(r'\b(?:for|as) (?:the |an? )?([a-z][\w\s\-/.+#]*?) (?:role|position|profile|post|opening)\b', low)
    if m:
        role = q.text[m.start(1):m.end(1)].strip()
        q.take(m)
        return _role_case(role)
    # 2. abbreviations and campus hiring tracks
    for pat, name in ROLE_ALIASES:
        m = re.search(pat, q.text)
        if m:
            if name is None:
                words = re.split(r'[\s\-]+', m.group(0).strip())
                role = ' '.join(_nice(w) if w.lower() not in ('i', 'ii', 'iii') else w.upper() for w in words)
                role = re.sub(r'^(SDE|SWE) ', r'\1-', role)
            else:
                role = name
            q.take(m)
            return role
    # 3. "<words> engineer/analyst/...": walk back over role words from the role noun
    tokens = list(re.finditer(r"[A-Za-z0-9.+#&/-]+", q.text))
    for i, t in enumerate(tokens):
        if not re.fullmatch(ROLE_NOUNS, t.group(0).lower()):
            continue
        start = i
        while start > 0 and tokens[start - 1].group(0).lower() in ROLE_WORDS:
            start -= 1
        end = i
        # trailing level: "engineer 2", "engineer II", "analyst I", "manager - L5"
        if end + 1 < len(tokens) and re.fullmatch(r'(i{1,3}|[1-4]|l\d)', tokens[end + 1].group(0).lower()):
            end += 1
        # a lone noun with nothing before it ("lead", "associate") is too vague to be a role
        noun = t.group(0).lower()
        after = q.low[t.end():].lstrip()
        if after.startswith('round') or (start == i and i > 0 and tokens[i - 1].group(0).lower() == 'hiring'):
            continue   # "manager round", "hiring manager": an interview round, not a role
        if start == i and noun in ('leads', 'lead', 'associate', 'associates', 'executive', 'officer'):
            continue
        a, b = tokens[start].start(), tokens[end].end()
        role = q.text[a:b]
        q.take((a, b))
        role = _role_case(re.sub(r'\binternship\b', 'intern', role, flags=re.I))
        return role[:1].upper() + role[1:]
    return None


def _find_level(q):
    level = years = None
    m = re.search(r'\b(\d{1,2})(?:\s*(?:-|to)\s*(\d{1,2}))?\s*\+?\s*(?:years?|yrs?|yoe)\b(?:\s+(?:of\s+)?experience)?', q.low)
    if m:
        years = m.group(0).strip()
        n = int(m.group(1))
        level = 'Experienced' if n >= 2 else 'Early career'
        q.take(m)
    m = re.search(r'\b(freshers?|new grads?|graduates?|entry[- ]level|campus|on[- ]campus|off[- ]campus|batch)\b', q.low)
    if m:
        level = level or 'Fresher'
        if 'off' in m.group(0):
            level = 'Fresher (off campus)'
        elif 'campus' in m.group(0):
            level = 'Fresher (campus)'
    m = re.search(r'\b(internships?|summer intern)\b', q.low)
    if m:
        level = 'Intern'
    m = re.search(r'\b(lateral|experienced)\b', q.low)
    if m and not level:
        level = 'Experienced'
    return level, years


def _find_location(q):
    found = None
    for name in sorted(LOCATIONS, key=len, reverse=True):
        m = re.search(r'\b' + re.escape(name) + r'\b', q.low)
        if m:
            found = found or LOCATIONS[name]
            q.take(m)
    return found


def _is_skill_word(word):
    return any(rx.fullmatch(word) for s, rx in COMPILED if s['category'] != 'Soft skills')


def _find_company(q, known):
    """Company the user meant, plus where it came from: 'known', 'alias', 'guess' or 'corrected'."""
    low = q.low
    # 1. companies this browser tab already has data for
    hits = [(n, re.search(r'(?<![\w])' + re.escape(n.lower()) + r'(?![\w])', low)) for n in known if n]
    hits = [(n, m) for n, m in hits if m]
    if hits:
        name, m = max(hits, key=lambda h: len(h[0]))
        q.take(m)
        return name, 'known', None
    # 2. well-known companies and their aliases (longest first; "at X" / "in X" beats a bare mention)
    best = None
    for alias, canon in ALIAS.items():
        for m in re.finditer(r'(?<![\w&])' + re.escape(alias) + r'(?![\w&])', low):
            if alias in AMBIGUOUS:
                continue
            before = low[:m.start()].rstrip()
            score = len(alias) + (20 if re.search(r'\b(at|in|for|with|join|joining|@)$', before) else 0)
            if not best or score > best[0]:
                best = (score, canon, m)
    if best:
        q.take(best[2])
        return best[1], 'alias', None
    # 3. the longest run of words that are not stopwords
    tokens = [t for t in re.finditer(r"[A-Za-z0-9&.'\-]+", q.text) if re.search(r'[A-Za-z0-9]', t.group(0))]
    runs, cur = [], []
    for t in tokens:
        w = t.group(0).lower().strip(".'")
        prev = cur[-1] if cur else None
        gap = prev and q.text[prev.end():t.start()].strip()   # punctuation between words breaks a run
        skip = w in STOPWORDS or w.isdigit() or _is_skill_word(w)   # "sql", "java": topics, not company
        if skip or gap:
            if cur:
                runs.append(cur)
            cur = [] if skip else [t]
        else:
            cur.append(t)
    if cur:
        runs.append(cur)
    if not runs:
        return None, None, None
    run = max(runs, key=len)
    words = [t.group(0).strip(".'-") for t in run]
    while words and words[-1].lower() in LEGAL_SUFFIXES:
        words.pop()
    if not words:
        return None, None, None
    raw = ' '.join(words)
    if raw.lower() in ALIAS:
        return ALIAS[raw.lower()], 'alias', None
    # 4. a near miss on a well-known name ("accenure" -> Accenture); short words are too risky
    if len(raw) >= 5:
        close = difflib.get_close_matches(raw.lower(), [a for a in ALIAS if len(a) >= 5], n=1, cutoff=0.84)
        if close:
            return ALIAS[close[0]], 'corrected', raw
    company = ' '.join(w if (w.isupper() and len(w) > 1) else w.upper() if w.lower() in ACRONYMS
                       else w[:1].upper() + w[1:] for w in words)
    return company, 'guess', None


def parse_query(text, known=()):
    original = ' '.join((text or '').split())
    q = _Query(original)
    over = _overrides(q)

    year = None
    m = re.search(r'\b(20[1-3]\d)(?:\s*batch)?\b', q.text)
    if m:
        year = m.group(1)
        q.take(m)

    level, years = _find_level(q)
    # what the person wants: read after "3 years experience" is gone, so that isn't "experiences"
    intent_text = q.text
    location = over.get('location') or _find_location(q)

    role = over.get('role') or _find_role(q)

    # interview rounds (then removed so "system design" or "coding" never ends up in the company name)
    rounds = []
    for name, pat in ROUNDS:
        for m in re.finditer(pat, q.low):
            if name not in rounds:
                rounds.append(name)
            q.take(m)

    # intents, read before the words are removed
    intents = [k for k, pat in INTENT_WORDS.items() if re.search(pat, intent_text, re.I)]
    if rounds and 'questions' not in intents:
        intents.insert(0, 'questions')
    intents = intents or ['questions']

    if over.get('company'):
        company, how, corrected = over['company'], 'override', None
    else:
        company, how, corrected = _find_company(q, known)

    # topics: skills mentioned anywhere outside the company name
    topics = []
    if company:
        rest = re.sub(r'(?<![\w])' + re.escape(company) + r'(?![\w])', ' ', original, flags=re.I)
    else:
        rest = original
    for s in SKILLS:
        if s['category'] == 'Soft skills':
            continue
        if re.search(s['pattern'], rest, re.I):
            topics.append(public(s))
    # "coding" / "system design" are rounds; don't repeat them as topics
    topics = [t for t in topics if not (t['name'] == 'System design' and 'System design' in rounds)
              and not (t['name'] == 'Data structures and algorithms' and 'Coding' in rounds)]

    return {
        'company': company, 'company_source': how, 'corrected_from': corrected,
        'role': role, 'level': level, 'experience': years, 'location': location, 'year': year,
        'rounds': rounds, 'topics': topics[:6], 'intents': intents,
    }
