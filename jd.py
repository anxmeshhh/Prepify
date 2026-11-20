"""Reading a job description (and optionally a resume) to plan interview preparation.

Everything here is worked out from the text with rules, so each finding can point at the line
of the JD it came from. Nothing is stored: the text is analysed and the result is sent back.
"""
import io
import re
import zipfile

from query_parser import ALIAS, AMBIGUOUS, LOCATIONS, ROLE_NOUNS, _role_case
from skills import CATEGORY_ORDER, find_skills, public, skill  # noqa: F401

MAX_BYTES = 5 * 1024 * 1024
MAX_CHARS = 60000


# ---------- getting text out of an upload ----------
class JDError(ValueError):
    pass


class NeedsAI(JDError):
    """A file the rules can't read (a scanned PDF or a photo). AI assist can, from the raw bytes."""
    def __init__(self, message, data, media_type):
        super().__init__(message)
        self.data = data
        self.media_type = media_type


IMAGE_TYPES = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif'}


def _image_type(name, data):
    for ext, mt in IMAGE_TYPES.items():
        if name.endswith(ext):
            return mt
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return 'image/png'
    if data[:3] == b'\xff\xd8\xff':
        return 'image/jpeg'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'image/webp'
    return None


def text_from_upload(filename, data):
    name = (filename or '').lower()
    if len(data) > MAX_BYTES:
        raise JDError('That file is over 5 MB. Paste the text instead.')
    image = _image_type(name, data)
    if image:
        raise NeedsAI('Photos and screenshots of a JD can only be read with AI assist. Turn it on, or paste the text.',
                      data, image)
    if name.endswith('.pdf') or data[:5] == b'%PDF-':
        try:
            from pypdf import PdfReader
        except ImportError:
            raise JDError('Reading PDFs needs the pypdf package (pip install pypdf). Paste the text instead.')
        try:
            reader = PdfReader(io.BytesIO(data))
            text = '\n'.join((page.extract_text() or '') for page in reader.pages[:20])
        except Exception:
            raise JDError("That PDF couldn't be read. Paste the text instead.")
        if len(text.strip()) < 80:
            raise NeedsAI('That PDF has no selectable text (it may be a scanned image). Turn on AI assist to read it, '
                          'or paste the text instead.', data, 'application/pdf')
        return text
    if name.endswith('.docx') or data[:2] == b'PK':
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                xml = z.read('word/document.xml').decode('utf-8', 'ignore')
        except Exception:
            raise JDError("That Word file couldn't be read. Save it as .docx or paste the text instead.")
        xml = re.sub(r'</w:p>', '\n', xml)
        xml = re.sub(r'<w:tab/>', '\t', xml)
        xml = re.sub(r'<w:br/>', '\n', xml)
        text = re.sub(r'<[^>]+>', '', xml)
        return (text.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
                .replace('&quot;', '"').replace('&apos;', "'"))
    if name.endswith('.doc'):
        raise JDError('Old .doc files are not supported. Save it as .docx or PDF, or paste the text.')
    try:
        return data.decode('utf-8')
    except UnicodeDecodeError:
        return data.decode('latin-1')


# ---------- splitting the JD into sections ----------
SECTION_HEADINGS = [
    ('about', r'about (us|the company|the team|the role|the job|this role)|who we are|company overview|our story|overview'),
    ('responsibilities', r'(key )?responsibilit\w*|what you.?ll do|what you will do|the role|your role|role description|'
                         r'job description|duties|day[- ]to[- ]day|your impact|what you.?ll be doing|in this role'),
    ('preferred', r'preferred|nice[- ]to[- ]have|good[- ]to[- ]have|bonus( points)?|desired|plus points|'
                  r'additional (skills|qualifications)|it would be great if|extra credit'),
    ('requirements', r'requirements?|(basic |minimum |required )?qualifications?|what you.?ll need|what you need|'
                     r'must[- ]have|required skills|skills( required| and experience)?|who you are|what we.?re looking for|'
                     r'what we look for|eligibility( criteria)?|you have|you.?ll bring|technical skills|experience'),
    ('benefits', r'benefits|perks|what we offer|why join|why you.?ll love|compensation'),
    ('process', r'(interview|selection|hiring|recruitment) process|how to apply|next steps'),
]


PREFERRED_INLINE = re.compile(r'\b(is a plus|a plus|an added advantage|an advantage|nice to have|good to have|'
                              r'is preferred|preferred but not|bonus|desirable)\b', re.I)


def _heading_kind(line):
    clean = re.sub(r'[*#:_\-–—|•]+', ' ', line).strip().lower()
    if not clean or len(clean) > 60 or len(clean.split()) > 7:
        return None
    for kind, pat in SECTION_HEADINGS:
        if re.fullmatch(r'(' + pat + r')( and [a-z ]+)?\s*', clean):
            return kind
    return None


def _lines(text):
    out = []
    for raw in text.replace('\r', '\n').split('\n'):
        line = re.sub(r'\s+', ' ', raw).strip()
        line = re.sub(r'^([•●▪◦○■□►▶✓✔➤\-*–—]|\d{1,2}[.)])\s*', '', line)
        if line:
            out.append(line)
    return out


def split_sections(text):
    sections = {'intro': []}
    kind = 'intro'
    for line in _lines(text):
        k = _heading_kind(line)
        if k:
            kind = k
            sections.setdefault(kind, [])
            continue
        # "Requirements: 3+ years of Java" on one line
        m = re.match(r'^([A-Za-z][A-Za-z \'’/&]{2,40}):\s+(.{8,})$', line)
        if m and _heading_kind(m.group(1)):
            kind = _heading_kind(m.group(1))
            sections.setdefault(kind, []).append(m.group(2))
            continue
        sections.setdefault(kind, []).append(line)
    # "Basic Python is a plus" inside the requirements is really a nice-to-have
    for kind in ('requirements', 'responsibilities', 'intro'):
        keep = []
        for line in sections.get(kind, []):
            if PREFERRED_INLINE.search(line):
                sections.setdefault('preferred', []).append(line)
            else:
                keep.append(line)
        if kind in sections:
            sections[kind] = keep
    return sections


# ---------- facts ----------
def _title(lines, text):
    m = re.search(r'(?im)^\s*(?:job title|position|role|designation|title)\s*[:\-–]\s*(.{3,80})$', text)
    if m:
        return m.group(1).strip(' .')
    for line in lines[:12]:
        if len(line) <= 80 and re.search(r'\b' + ROLE_NOUNS + r'\b', line, re.I) and not line.endswith('.'):
            t = re.split(r'\s+[|@–—]\s+|\s+-\s+|,\s', line)[0]
            t = re.sub(r'^(we are hiring|hiring|job opening|opening)\s*[:\-–]?\s*(an?|the)?\s*', '', t, flags=re.I)
            return t.strip(' .:')
    m = re.search(r'\b(?:hiring|looking for|seeking) (?:an? |the )?((?:[A-Z][\w+#./-]*\s){0,4}' + ROLE_NOUNS + r')', text)
    if m:
        return m.group(1).strip()
    return None


def _company(lines, text):
    m = re.search(r'(?im)^\s*(?:company|organi[sz]ation|employer|company name)\s*[:\-–]\s*(.{2,60})$', text)
    if m:
        return m.group(1).strip(' .'), 'stated'
    m = re.search(r'(?i)\babout ([A-Z][\w&.\- ]{1,40}?)\s*(?:\n|:|$)', text)
    if m and m.group(1).strip().lower() not in ('us', 'the role', 'the team', 'the job', 'this role', 'the company', 'you'):
        return m.group(1).strip(), 'about'
    counts = {}
    low = text.lower()
    for alias, canon in ALIAS.items():
        if alias in AMBIGUOUS and not re.search(r'\b(at|join) ' + re.escape(alias) + r'\b', low):
            continue
        n = len(re.findall(r'(?<![\w&])' + re.escape(alias) + r'(?![\w&])', low))
        if n:
            counts[canon] = counts.get(canon, 0) + n
    if counts:
        return max(counts, key=counts.get), 'mentioned'
    m = re.search(r'\b(?:at|join) ([A-Z][\w&.]+(?: [A-Z][\w&.]+){0,3})', text)
    if m and m.group(1).lower() not in ('our', 'the', 'we'):
        return m.group(1), 'mentioned'
    return None, None


def _experience(text):
    pats = [
        r'(\d{1,2})\s*(?:\+|plus)?\s*(?:-|–|to)\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)',
        r'(?:minimum|min\.?|at least|over)\s*(?:of\s*)?(\d{1,2})\s*\+?\s*(?:years?|yrs?)',
        r'(\d{1,2})\s*\+\s*(?:years?|yrs?)',
        r'(\d{1,2})\s*(?:years?|yrs?)\s*(?:of\s*)?(?:relevant |professional |industry |hands-on |work )?experience',
    ]
    for p in pats:
        m = re.search(p, text, re.I)
        if m:
            lo = int(m.group(1))
            hi = int(m.group(2)) if m.lastindex and m.lastindex >= 2 and m.group(2) else None
            if lo > 30:
                continue
            label = f'{lo}–{hi} years' if hi else f'{lo}+ years'
            return {'min': lo, 'max': hi, 'label': label, 'evidence': _sentence_around(text, m)}
    if re.search(r'\b(freshers?|new grads?|recent graduates?|entry[- ]level|0\s*(?:-|–|to)\s*1 years?|no experience required|campus|batch of 20\d\d|20\d\d (passing out|batch|graduates?))\b', text, re.I):
        return {'min': 0, 'max': 1, 'label': 'Fresher / entry level', 'evidence': None}
    return None


def _sentence_around(text, m):
    a = max(text.rfind('\n', 0, m.start()), text.rfind('. ', 0, m.start()) + 1, 0)
    b = min([x for x in (text.find('\n', m.end()), text.find('. ', m.end())) if x != -1] or [len(text)])
    return re.sub(r'\s+', ' ', text[a:b]).strip(' .•-')[:200]


def _seniority(title, exp):
    t = (title or '').lower()
    if re.search(r'\bintern', t):
        return 'Intern'
    if re.search(r'\b(principal|staff|architect|director|head|vp)\b', t):
        return 'Principal / staff'
    if re.search(r'\b(lead|manager)\b', t):
        return 'Lead / manager'
    if re.search(r'\b(senior|sr\.?|iii)\b', t) or (exp and exp['min'] >= 5):
        return 'Senior'
    if re.search(r'\b(trainee|graduate|junior|jr\.?|associate|entry)\b', t) or (exp and exp['min'] <= 1):
        return 'Entry level'
    if exp and exp['min'] >= 2:
        return 'Mid level'
    return None


def _first(rx, text, flags=re.I):
    return re.search(rx, text, flags)


def _facts(text, lines, title):
    out = {}
    low = text.lower()
    if re.search(r'\b(fully remote|remote[- ]first|100% remote|work from home|wfh|remote)\b', low):
        out['work_mode'] = 'Remote' if not re.search(r'\bhybrid\b', low) else 'Hybrid'
    elif re.search(r'\bhybrid\b', low):
        out['work_mode'] = 'Hybrid'
    elif re.search(r'\b(on-?site|in[- ]office|work from office|wfo)\b', low):
        out['work_mode'] = 'On-site'
    if re.search(r'\b(internship|intern)\b', (title or '').lower()) or re.search(r'\binternship\b', low):
        out['employment'] = 'Internship'
    elif re.search(r'\b(contract|contractual|freelance|c2h|contract[- ]to[- ]hire)\b', low):
        out['employment'] = 'Contract'
    elif re.search(r'\bpart[- ]time\b', low):
        out['employment'] = 'Part-time'
    elif re.search(r'\bfull[- ]time\b|\bpermanent\b', low):
        out['employment'] = 'Full-time'
    locs = []
    for name in sorted(LOCATIONS, key=len, reverse=True):
        if name in ('remote', 'india', 'uk', 'usa'):
            continue
        if re.search(r'\b' + re.escape(name) + r'\b', low) and LOCATIONS[name] not in locs:
            locs.append(LOCATIONS[name])
    if locs:
        out['locations'] = locs[:5]
    m = _first(r'(?:₹|rs\.?|inr|\$|usd|€|£)\s*[\d,.]+\s*(?:k|l|lpa|lakhs?|cr|crores?)?(?:\s*(?:-|–|to)\s*(?:₹|rs\.?|inr|\$|usd|€|£)?\s*[\d,.]+\s*(?:k|l|lpa|lakhs?|cr|crores?)?)?(?:\s*(?:per annum|p\.a\.|/yr|per year|a year|lpa))?|\b\d{1,2}(?:\.\d)?\s*(?:-|–|to)\s*\d{1,2}(?:\.\d)?\s*lpa\b|\b\d{1,2}(?:\.\d)?\s*lpa\b', text)
    if m:
        out['salary'] = m.group(0).strip()
    edu = []
    for pat, label in [(r'\bb\.?\s?tech\b|\bb\.?e\.?\b(?=\W)|\bbachelor', "Bachelor's degree"),
                       (r'\bm\.?\s?tech\b|\bm\.?e\.?\b(?=\W)|\bmaster|\bm\.?s\.?\b(?= in)', "Master's degree"),
                       (r'\bmca\b', 'MCA'), (r'\bbca\b', 'BCA'), (r'\bb\.?sc\b', 'B.Sc'), (r'\bmba\b', 'MBA'),
                       (r'\bph\.?d\b', 'PhD')]:
        if re.search(pat, text, re.I):
            edu.append(label)
    fields = re.findall(r'\b(computer science|information technology|electronics|electrical|mathematics|statistics|'
                        r'computer engineering|data science|economics|finance|commerce|engineering)\b', low)
    if edu:
        out['education'] = edu + ([f'in {", ".join(dict.fromkeys(f.title() for f in fields[:3]))}'] if fields else [])
    m = re.search(r'(\d{2})\s*%|(\d(?:\.\d)?)\s*cgpa|cgpa\s*(?:of\s*)?(\d(?:\.\d)?)', low)
    if m:
        out['academic_cutoff'] = _sentence_around(text, m)
    if re.search(r'\b(no (active )?backlogs?|backlogs?)\b', low):
        out['backlogs'] = 'Backlog rules apply (see the JD)'
    if re.search(r'\b(service agreement|bond|service bond)\b', low):
        out['bond'] = _sentence_around(text, re.search(r'\b(service agreement|bond|service bond)\b', low))
    if re.search(r'\b(rotational shifts?|night shifts?|24x7|24/7|us shift|uk shift)\b', low):
        out['shifts'] = _sentence_around(text, re.search(r'\b(rotational shifts?|night shifts?|24x7|24/7|us shift|uk shift)\b', low))
    if re.search(r'\b(relocat\w+)\b', low):
        out['relocation'] = _sentence_around(text, re.search(r'\brelocat\w+\b', low))
    if re.search(r'\b(travel)\b', low):
        out['travel'] = _sentence_around(text, re.search(r'\btravel\b', low))
    return out


# ---------- what the interviews will probably cover ----------
def _role_family(title, skills_found):
    t = (title or '').lower()
    names = set(skills_found)
    if re.search(r'\b(data scien|machine learning|ml engineer|ai engineer|applied scien|research scien)', t):
        return 'Data science'
    if re.search(r'\b(data engineer|etl|big data)', t):
        return 'Data engineering'
    if re.search(r'\b(data analyst|business intelligence|bi analyst|analytics|mis)\b', t):
        return 'Data analysis'
    if re.search(r'\b(business analyst|consultant|strategy|associate consultant)\b', t):
        return 'Business analysis'
    if re.search(r'\b(product manager|program manager|apm|product owner)\b', t):
        return 'Product'
    if re.search(r'\b(qa|test|sdet|quality)\b', t):
        return 'Testing'
    if re.search(r'\b(devops|sre|site reliability|cloud|platform|infrastructure)\b', t):
        return 'DevOps'
    if re.search(r'\b(front ?end|ui developer|react|angular)\b', t):
        return 'Frontend'
    if re.search(r'\b(android|ios|mobile|flutter)\b', t):
        return 'Mobile'
    if re.search(r'\b(software|developer|engineer|sde|swe|programmer|backend|full ?stack|java|python|\.net)\b', t):
        return 'Software'
    if {'Machine learning', 'Deep learning'} & names:
        return 'Data science'
    coding = names & {'Data structures and algorithms', 'Java', 'C++', 'JavaScript', 'React', 'Node.js', 'Spring Boot'}
    if names & {'BI tools (Power BI, Tableau)', 'Excel'} and not coding:
        return 'Data analysis'
    if coding:
        return 'Software'
    return 'General'


def _rounds(family, seniority, exp, skills_found, text):
    low = text.lower()
    found = set(skills_found)
    fresher = seniority in ('Entry level', 'Intern') or (exp and exp['min'] <= 1)
    senior = seniority in ('Senior', 'Lead / manager', 'Principal / staff') or (exp and exp['min'] >= 4)
    tech = family in ('Software', 'Frontend', 'Mobile', 'DevOps', 'Data engineering', 'Testing', 'Data science')
    rounds = []

    def add(name, why, focus):
        rounds.append({'name': name, 'why': why, 'focus': focus})

    if fresher or re.search(r'\b(online (test|assessment)|aptitude|hackerrank|codility|assessment)\b', low):
        add('Online assessment', 'Entry-level hiring usually starts with a timed online test.' if fresher
            else 'The JD mentions an online test or assessment.',
            ['Aptitude and logical reasoning' if fresher else 'Timed coding problems',
             'Two or three coding problems (easy to medium)' if tech or fresher else 'Role-specific MCQs'])
    if tech:
        add('Coding / DSA', 'Engineering roles almost always include live problem solving.',
            ['Arrays, strings and hashing', 'Trees, graphs and recursion', 'Explaining time and space complexity'])
    if family == 'Frontend' or (found & {'React', 'Angular', 'Vue', 'JavaScript'} and family == 'Software'):
        add('Frontend / machine coding', 'The JD is built around frontend skills.',
            ['Build a small UI component live', 'JavaScript fundamentals (closures, event loop, promises)',
             'Browser rendering and performance'])
    if family in ('Software', 'Frontend', 'Mobile', 'DevOps', 'Data engineering') and (
            senior or 'System design' in found or 'Microservices' in found):
        add('System design', 'The role is senior or the JD talks about scale, architecture or microservices.',
            ['High-level design of a familiar product', 'Trade-offs: caching, queues, databases',
             'Low-level design (classes and APIs)' if not senior else 'Scaling, reliability and failure handling'])
    if tech or family in ('Data analysis', 'Business analysis'):
        # the tools themselves; DSA, OOP and system design already have their own rounds
        tools = [n for n in skills_found if skill(n) and skill(n)['category'] not in
                 ('CS fundamentals', 'Soft skills', 'Product & business', 'Practices')]
        add('Technical deep dive', 'Interviewers test the tools named in the JD and your projects.',
            ['Your projects: decisions, trade-offs, what you would change'] +
            [f'{n} in depth' for n in tools[:3]])
    if family == 'Data analysis':
        add('SQL and analytics case', 'Analyst roles test querying and turning data into a recommendation.',
            ['Joins, aggregations and window functions', 'A metric dropped: how do you investigate?',
             'Excel or BI dashboard questions'])
    if family == 'Data science':
        add('ML and statistics', 'Data science interviews test modelling and statistics fundamentals.',
            ['Model choice and evaluation metrics', 'Statistics and probability', 'An end-to-end ML case'])
    if family in ('Business analysis', 'Product') or re.search(r'\b(case stud|guesstimate|consulting)\b', low):
        add('Case study', 'Consulting, product and analyst roles often include a case or guesstimate.',
            ['Structuring an ambiguous problem', 'Estimating with sensible assumptions', 'Recommending with data'])
    if family == 'Product':
        add('Product sense', 'Product roles test how you think about users and metrics.',
            ['Improve or design a product', 'Choosing success metrics', 'Prioritisation'])
    if senior or (not fresher and re.search(r'\b(lead|mentor|manage|stakeholder)\w*', low)):
        add('Managerial', 'The JD mentions leading, mentoring or stakeholders.',
            ['Leading a project end to end', 'Handling conflict and pushback', 'Mentoring and feedback'])
    add('HR and behavioural', 'Every process ends with fit, motivation and logistics.',
        ['Tell me about yourself; why this company', 'Behavioural stories in the STAR format',
         'Notice period, location, shifts and salary expectations'])
    return rounds


def _questions_to_ask(title, family, skills_found, facts, responsibilities):
    qs = [f'What does success look like for this {title or "role"} in the first 90 days?',
          'What does a typical week look like for the team?']
    tech = [n for n in skills_found if skill(n) and skill(n)['category'] not in ('Soft skills', 'Product & business')]
    if tech:
        qs.append(f'How is {", ".join(tech[:3])} used day to day, and is the team planning any changes to the stack?')
    if responsibilities:
        qs.append(f'You mention "{responsibilities[0][:90].rstrip(".")}". What is the biggest challenge there right now?')
    if family in ('Software', 'Frontend', 'DevOps', 'Data engineering', 'Mobile'):
        qs.append('How does code get from a pull request to production, and how are incidents handled?')
    if family in ('Data analysis', 'Data science'):
        qs.append('Which decisions does this team\'s analysis feed into, and who are the main stakeholders?')
    if facts.get('work_mode') == 'Hybrid':
        qs.append('How many days a week is the team in the office?')
    qs.append('How are performance and growth reviewed, and what does progression look like from this role?')
    return qs


def _keywords(skill_counts):
    return [n for n, _ in sorted(skill_counts.items(), key=lambda kv: -kv[1])][:15]


def analyze(text, resume_text=None):
    text = (text or '')[:MAX_CHARS]
    if len(text.strip()) < 80:
        raise JDError('That job description is too short to analyse. Paste the full text.')
    lines = _lines(text)
    sections = split_sections(text)
    title = _title(lines, text)
    title = _role_case(title) if title and title.islower() else title
    company, company_how = _company(lines, text)
    exp = _experience(text)
    seniority = _seniority(title, exp)

    # skills: required unless they only show up under "preferred / nice to have"
    preferred_text = '\n'.join(sections.get('preferred', []))
    other_text = '\n'.join(l for k, ls in sections.items() if k not in ('preferred', 'benefits', 'about') for l in ls)
    req_counts = find_skills(other_text)
    pref_counts = find_skills(preferred_text)
    about_counts = find_skills('\n'.join(sections.get('about', [])))
    all_counts = {**about_counts, **pref_counts}
    for k, v in req_counts.items():
        all_counts[k] = all_counts.get(k, 0) + v

    def evidence(name):
        rx = re.compile(skill(name)['pattern'], re.I)
        for l in lines:
            if rx.search(l) and not _heading_kind(l):
                return l[:220]
        return None

    skills_out = []
    for name, n in all_counts.items():
        s = skill(name)
        level = 'required' if name in req_counts else 'preferred' if name in pref_counts else 'mentioned'
        skills_out.append(public(s, level=level, mentions=n, evidence=evidence(name)))
    family = _role_family(title, [s['name'] for s in skills_out if s['level'] != 'mentioned'])
    finish_skills(skills_out, family)

    facts = _facts(text, lines, title)
    responsibilities = sections.get('responsibilities', [])[:12]
    requirements = sections.get('requirements', [])[:14]
    preferred = sections.get('preferred', [])[:10]
    tech_names = [s['name'] for s in skills_out if s['level'] in ('required', 'preferred')]

    result = {
        'title': title, 'company': company, 'company_source': company_how,
        'experience': exp, 'seniority': seniority, 'family': family, 'facts': facts,
        'skills': skills_out,
        'responsibilities': responsibilities, 'requirements': requirements, 'preferred': preferred,
        'process': sections.get('process', [])[:8],
        'rounds': _rounds(family, seniority, exp, tech_names, text),
        'ask': _questions_to_ask(title, family, tech_names, facts, responsibilities),
        'keywords': keywords_for(skills_out),
        'chars': len(text),
    }
    if resume_text and resume_text.strip():
        result['resume'] = compare_resume(skills_out, resume_text[:MAX_CHARS])
    return result


LEVEL_RANK = {'required': 0, 'expected': 1, 'preferred': 2, 'mentioned': 3}


def finish_skills(skills_out, family):
    """Add the fundamentals a role is always tested on, then sort: required first, most mentioned first."""
    have = {s['name'] for s in skills_out}
    if family in ('Software', 'Frontend', 'Mobile', 'Data engineering', 'DevOps', 'Testing'):
        for name in ('Data structures and algorithms', 'OOP and design patterns'):
            if name not in have:
                skills_out.append(public(skill(name), level='expected', mentions=0,
                                         evidence='Not in the JD, but almost always tested for engineering roles.'))
    if family in ('Data analysis', 'Data science', 'Data engineering') and 'SQL' not in have:
        skills_out.append(public(skill('SQL'), level='expected', mentions=0,
                                 evidence='Not in the JD, but data roles almost always test SQL.'))
    skills_out.sort(key=lambda s: (LEVEL_RANK[s['level']], -s['mentions'],
                                   CATEGORY_ORDER.index(s['category']) if s['category'] in CATEGORY_ORDER else 99))
    return skills_out


def keywords_for(skills_out):
    return _keywords({s['name']: s['mentions'] for s in skills_out if s['level'] in ('required', 'preferred')})


NOT_ON_RESUMES = ('Soft skills', 'Product & business', 'Practices')


def compare_resume(jd_skills, resume_text):
    have = find_skills(resume_text)
    if 'Relational databases' in have:   # MySQL / PostgreSQL on a resume means SQL
        have.setdefault('SQL', 1)

    def on_resume(s):     # skills outside the lexicon (found by AI) are matched by their own pattern
        if s['name'] in have:
            return True
        if skill(s['name']):
            return False
        try:
            return bool(re.search(s['pattern'], resume_text, re.I))
        except re.error:
            return False

    rows = []
    for s in jd_skills:
        if s['category'] in NOT_ON_RESUMES:
            continue
        rows.append({'name': s['name'], 'level': s['level'], 'in_resume': on_resume(s)})
    want = [r for r in rows if r['level'] in ('required', 'expected')]
    matched = [r for r in want if r['in_resume']]
    score = round(100 * len(matched) / len(want)) if want else None
    extra = [n for n in have if n not in {s['name'] for s in jd_skills}
             and skill(n) and skill(n)['category'] not in NOT_ON_RESUMES][:10]
    return {
        'score': score,
        'matched': [r['name'] for r in rows if r['in_resume']],
        'missing_required': [r['name'] for r in want if not r['in_resume']],
        'missing_preferred': [r['name'] for r in rows if r['level'] == 'preferred' and not r['in_resume']],
        'extra': extra,
    }
