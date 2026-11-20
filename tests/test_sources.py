"""Finding a company's real page on Code360 and PrepInsta, from a stand-in for each site's sitemap index.
Run: python -m pytest tests"""
import os
import sys
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as prepify  # noqa: E402
import site_index as si  # noqa: E402

CODE360 = {'tata-consultancy-services': 286, 'tcs-ion': 3, 'tata-1mg': 18, 'infosys-technologies-limited': 148,
           'infosys': 6, 'evolution-infosystem': 1, 'jp-morgan-chase-company': 41, 'amazon': 327,
           'amazon-pay': 0, 'metaminds': 2, 'facebook': 8}
PREPINSTA = {'tcs': {'pages': 900, 'interview': ['https://prepinsta.com/tcs/interview-questions/',
                                                 'https://prepinsta.com/tcs/interview-questions/hr-interview-questions/']},
             'top-150-notout-questions': {'pages': 150, 'interview': []},
             'deloitte': {'pages': 40, 'interview': ['https://prepinsta.com/deloitte/recruitment-process/']}}


@pytest.fixture(autouse=True)
def stand_in_indexes():
    si._cache.update({'Code360': (time.time(), CODE360), 'PrepInsta': (time.time(), PREPINSTA)})
    yield
    si._cache.clear()


def test_code360_finds_the_slug_the_site_really_uses():
    r = si.locate('Code360', 'TCS')                     # alias -> tata-consultancy-services, not tcs-ion
    assert r['covered'] and r['url'].endswith('/tata-consultancy-services') and r['count'] == 286
    assert si.locate('Code360', 'Infosys')['url'].endswith('/infosys-technologies-limited')   # most experiences
    assert si.locate('Code360', 'JPMorgan Chase')['url'].endswith('/jp-morgan-chase-company')
    assert si.locate('Code360', 'Meta')['url'].endswith('/facebook')                          # via the alias


def test_a_different_company_with_the_same_start_is_not_a_match():
    assert not si._matches('metaminds', ['meta'])
    assert not si._matches('evolution-infosystem', ['infosys'])
    assert si._matches('infosys-technologies-limited', ['infosys'])
    assert not si._matches('amazon-pay', ['amazon'])     # a product, not a legal suffix


def test_not_covered_is_said_plainly():
    r = si.locate('Code360', 'Target Corporation')
    assert r == {'covered': False, 'message': 'Code360 has no interview experiences for Target Corporation.'}
    assert not si.locate('PrepInsta', 'Target Corporation')['covered']


def test_prepinsta_prefers_the_interview_page():
    assert si.locate('PrepInsta', 'TCS')['url'] == 'https://prepinsta.com/tcs/interview-questions/'
    assert si.locate('PrepInsta', 'Deloitte')['url'] == 'https://prepinsta.com/deloitte/'


def test_locate_endpoint_needs_sign_in():
    c = prepify.app.test_client()
    assert c.get('/api/sources/locate?site=Code360&company=TCS').status_code == 401
    with c.session_transaction() as s:
        s['user'] = {'name': 't', 'email': 't@example.com'}
    body = c.get('/api/sources/locate?site=Code360&company=TCS').get_json()
    assert body['covered'] and body['match'] == ['tata', 'consultancy']
    assert c.get('/api/sources/locate?site=Glassdoor&company=TCS').status_code == 400
