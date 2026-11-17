"""Checks for search parsing and job description analysis. Run: python -m pytest tests"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import jd  # noqa: E402
from query_parser import parse_query  # noqa: E402


def p(q, **want):
    got = parse_query(q)
    for k, v in want.items():
        actual = [t['name'] for t in got[k]] if k == 'topics' else got[k]
        assert actual == v, f'{q!r}: {k} = {actual!r}, expected {v!r}'
    return got


def test_company_role_and_campus_tracks():
    p('Target Corporation interview questions', company='Target Corporation', role=None)
    p('Accenture ASE interview process', company='Accenture', role='Associate Software Engineer', intents=['process'])
    p('TCS Ninja HR questions', company='TCS', role='Ninja', rounds=['HR'])
    p('Cognizant GenC Next interview', company='Cognizant', role='GenC Next')
    p('Infosys specialist programmer coding round questions', company='Infosys', role='Specialist Programmer', rounds=['Coding'])


def test_levels_locations_and_rounds_stay_out_of_the_company():
    p('interview questions for amazon sde 2 bangalore', company='Amazon', role='SDE-2', location='Bengaluru')
    p('Amazon system design questions', company='Amazon', rounds=['System design'])
    p('Swiggy hiring manager round', company='Swiggy', role=None, rounds=['Managerial'])
    p('Goldman Sachs analyst online assessment 2025', company='Goldman Sachs', role='Analyst', year='2025',
      rounds=['Online assessment'])
    p('2 yoe backend engineer at Razorpay interview', company='Razorpay', role='Backend Engineer', level='Experienced')


def test_aliases_typos_and_topics():
    p('jp morgan java developer 3 years experience interview', company='JPMorgan Chase', role='Java Developer',
      intents=['questions'])
    p('accenure interview questions', company='Accenture', corrected_from='accenure')
    p('accenure data analyst 2 yoe hyderabad sql interview questions', company='Accenture', role='Data Analyst',
      location='Hyderabad', topics=['SQL'])
    p('Morgan Stanley technical interview questions java', company='Morgan Stanley', rounds=['Technical'], topics=['Java'])
    p('Zeta Suite backend developer interview', company='Zeta Suite', company_source='guess')
    p('Some Startup Pvt Ltd interview questions', company='Some Startup')


def test_explicit_overrides():
    p('company:"Target" role:"Data Analyst" interview questions', company='Target', role='Data Analyst',
      company_source='override')


SDE_JD = """Software Engineer II - Backend | Bengaluru (Hybrid)

About Razorpay
Razorpay is building the financial infrastructure for India's businesses.

What you'll do
- Design, build and own backend services in Java and Spring Boot
- Build scalable, low-latency microservices and REST APIs
- Work with Kafka and Redis to process events reliably
- Mentor junior engineers and review code

What we're looking for
- 3-5 years of experience in backend development
- Strong in data structures, algorithms and object-oriented design
- Experience with MySQL or PostgreSQL and writing efficient SQL
- Hands-on with AWS, Docker and Kubernetes

Nice to have
- Experience with Go (Golang)
- Exposure to CI/CD pipelines using Jenkins
"""

DA_JD = """Job Title: Data Analyst (Fresher)
Company: Target Corporation
Location: Bengaluru, Work from office

Responsibilities:
Build dashboards in Power BI and Tableau for business teams.
Write SQL queries to extract and clean data from large datasets.

Requirements:
Bachelor's degree in Statistics or Computer Science (2025 batch), minimum 60% throughout.
Strong Excel skills (VLOOKUP, pivot tables).
Basic Python (pandas) is a plus.
Selection process: Online assessment, technical interview, HR interview.
CTC: 6-8 LPA
"""


def levels(a):
    return {s['name']: s['level'] for s in a['skills']}


def test_engineering_jd():
    a = jd.analyze(SDE_JD, 'Skills: Java, Spring Boot, MySQL, Docker, Git')
    assert a['title'] == 'Software Engineer II'
    assert a['company'] == 'Razorpay'
    assert a['experience']['min'] == 3 and a['experience']['max'] == 5
    assert a['facts']['work_mode'] == 'Hybrid'
    lv = levels(a)
    assert lv['Java'] == 'required' and lv['Kubernetes'] == 'required'
    assert lv['Go'] == 'preferred' and lv['CI/CD'] == 'preferred'
    rounds = [r['name'] for r in a['rounds']]
    assert rounds[0] == 'Coding / DSA' and 'System design' in rounds and rounds[-1] == 'HR and behavioural'
    r = a['resume']
    assert 'SQL' in r['matched']          # MySQL on the resume counts as SQL
    assert 'Kubernetes' in r['missing_required']


def test_fresher_analyst_jd():
    a = jd.analyze(DA_JD)
    assert a['company'] == 'Target Corporation' and a['company_source'] == 'stated'
    assert a['family'] == 'Data analysis' and a['seniority'] == 'Entry level'
    lv = levels(a)
    assert lv['Python'] == 'preferred'    # "is a plus"
    assert lv['SQL'] == 'required' and lv['Excel'] == 'required'
    rounds = [r['name'] for r in a['rounds']]
    assert rounds[0] == 'Online assessment' and 'Managerial' not in rounds
    assert a['facts']['salary'] == '6-8 LPA'


def test_short_jd_is_rejected():
    try:
        jd.analyze('Java developer')
    except jd.JDError:
        return
    raise AssertionError('a two-word JD should be rejected')
