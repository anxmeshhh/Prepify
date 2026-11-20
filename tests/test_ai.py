"""AI assist, tested with the API call replaced by canned replies (no key or network needed).
Run: python -m pytest tests"""
import io
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import ai  # noqa: E402
import app as prepify  # noqa: E402
import jd  # noqa: E402


@pytest.fixture
def fake_ai(monkeypatch):
    """Route ai._call to a canned reply per schema; records what was sent."""
    monkeypatch.setenv('ANTHROPIC_API_KEY', 'test-key')
    sent = []
    replies = {}

    def fake_call(system, content, schema, effort='low', max_tokens=32000):
        sent.append({'system': system, 'content': content, 'schema': schema, 'effort': effort})
        reply = replies[id(schema)]
        if isinstance(reply, Exception):
            raise reply
        return (reply(content) if callable(reply) else reply), 'claude-opus-5-5'

    monkeypatch.setattr(ai, '_call', fake_call)
    ai._usage.clear()
    ai._parse_cache.clear()
    return {'sent': sent, 'set': lambda schema, reply: replies.__setitem__(id(schema), reply)}


def check_strict(schema, path='root'):
    """Structured outputs need every object closed and every property required."""
    if schema.get('type') == 'object':
        assert schema.get('additionalProperties') is False, path
        assert set(schema['required']) == set(schema['properties']), path
        for k, v in schema['properties'].items():
            check_strict(v, f'{path}.{k}')
    if schema.get('type') == 'array':
        check_strict(schema['items'], path + '[]')


def test_schemas_are_strict():
    for s in (ai.TIDY_SCHEMA, ai.JD_SCHEMA, ai.PARSE_SCHEMA):
        check_strict(s)


AI_JD = {
    'is_job_description': True, 'source_text': '', 'title': 'Data Engineer', 'company': 'Flipkart',
    'experience_min': 2, 'experience_max': 4, 'experience_label': '2-4 years', 'experience_evidence': '2-4 years of experience',
    'seniority': 'Mid level', 'family': 'Data engineering',
    'facts': {'work_mode': 'Hybrid', 'employment': 'Full-time', 'locations': ['Bengaluru'], 'salary': '', 'education': [],
              'academic_cutoff': '', 'backlogs': '', 'bond': '', 'shifts': '', 'relocation': '', 'travel': ''},
    'responsibilities': ['Build streaming pipelines'], 'requirements': ['Strong Python'], 'preferred': [], 'process': [],
    'skills': [
        {'name': 'Python', 'category': 'Languages', 'level': 'required', 'mentions': 3, 'evidence': 'Strong Python', 'topics': []},
        {'name': 'Golang', 'category': 'Languages', 'level': 'preferred', 'mentions': 1, 'evidence': 'Golang is a plus', 'topics': []},
        {'name': 'Apache Flink', 'category': 'Data & databases', 'level': 'required', 'mentions': 2, 'evidence': 'Flink jobs',
         'topics': ['Windowing', 'State and checkpoints']},
    ],
    'rounds': [{'name': 'Coding', 'why': 'Standard.', 'focus': ['Arrays']}],
    'ask': ['What does the data platform look like?'], 'watch_outs': ['No salary range is given.'],
}


def test_jd_reading_maps_to_the_standard_shape(fake_ai):
    fake_ai['set'](ai.JD_SCHEMA, AI_JD)
    a, text = ai.read_jd('x' * 200, resume_text='Built Flink jobs and Python services.')
    names = {s['name']: s for s in a['skills']}
    assert 'Go' in names and names['Go']['level'] == 'preferred'        # "Golang" -> the lexicon's Go
    flink = names['Apache Flink']
    assert flink['topics'] == ['Windowing', 'State and checkpoints'] and flink['questions'] == []
    assert re.search(flink['pattern'], 'we use apache  flink here', re.I)  # works on free text
    assert 'SQL' in names and names['SQL']['level'] == 'expected'       # data roles always test SQL
    assert a['experience'] == {'min': 2, 'max': 4, 'label': '2-4 years', 'evidence': '2-4 years of experience'}
    assert a['watch_outs'] == ['No salary range is given.'] and a['ai']['model'] == 'claude-opus-5-5'
    assert 'Apache Flink' in a['resume']['matched'] and 'Python' in a['resume']['matched']
    assert text == 'x' * 200


def test_scanned_pdf_goes_to_the_ai_as_a_document(fake_ai):
    fake_ai['set'](ai.JD_SCHEMA, {**AI_JD, 'source_text': 'Data Engineer at Flipkart ...'})
    a, text = ai.read_jd(file_data=b'%PDF-1.4 fake', media_type='application/pdf')
    block = fake_ai['sent'][-1]['content'][0]
    assert block['type'] == 'document' and block['source']['media_type'] == 'application/pdf'
    assert text == 'Data Engineer at Flipkart ...' and a['ai']['from_file']


def test_search_reading_fills_in_what_the_parser_missed(fake_ai):
    fake_ai['set'](ai.PARSE_SCHEMA, {'company': 'IKEA', 'role': 'Software Engineer', 'level': '', 'experience': '',
                                     'location': '', 'year': '', 'rounds': ['Coding'], 'topics': ['golang'],
                                     'intents': ['questions']})
    p = ai.parse_search('the swedish furniture company software engineer interview')
    assert p['company'] == 'IKEA' and p['company_source'] == 'ai'
    assert 'Coding' in p['rounds'] and [t['name'] for t in p['topics']] == ['Go']
    assert ai.cached_parse('The swedish furniture company  software engineer interview') is p


def test_tidy_drops_bad_references(fake_ai):
    fake_ai['set'](ai.TIDY_SCHEMA, {'items': [
        {'id': 'n0', 'keep': True, 'text': 'Reverse a linked list.', 'subject': 'Coding & DSA', 'round': 'Coding', 'difficulty': 'Easy', 'same_as': ''},
        {'id': 'n1', 'keep': True, 'text': '', 'subject': 'Coding & DSA', 'round': 'Coding', 'difficulty': 'Easy', 'same_as': 'n0'},
        {'id': 'n2', 'keep': False, 'text': '', 'subject': 'General', 'round': '', 'difficulty': '', 'same_as': 'zz'},
        {'id': 'n9', 'keep': True, 'text': 'invented', 'subject': 'General', 'round': '', 'difficulty': '', 'same_as': ''},
    ]})
    out, _ = ai.tidy_questions('Razorpay', [{'id': 'n0', 'text': 'reverse linkedlist'},
                                            {'id': 'n1', 'text': 'How to reverse a linked list?'},
                                            {'id': 'n2', 'text': 'Answer question'}])
    assert [i['id'] for i in out['items']] == ['n0', 'n1', 'n2']      # nothing the AI made up
    assert out['items'][1]['same_as'] == 'n0' and out['items'][2]['same_as'] == ''


# ---------- the HTTP endpoints ----------
@pytest.fixture
def client():
    prepify.app.config['TESTING'] = True
    return prepify.app.test_client()


def sign_in(c):
    with c.session_transaction() as s:
        s['user'] = {'name': 'Test', 'email': 'test@example.com'}


ITEMS = {'company': 'Razorpay', 'items': [{'id': 'n0', 'text': 'Why Razorpay?'}], 'known': []}
TIDY_REPLY = {'items': [{'id': 'n0', 'keep': True, 'text': '', 'subject': 'HR & Behavioral', 'round': 'HR',
                         'difficulty': '', 'same_as': ''}]}


def test_ai_endpoints_need_sign_in_and_a_key(client, monkeypatch):
    monkeypatch.delenv('ANTHROPIC_API_KEY', raising=False)
    assert client.post('/api/ai/questions', json=ITEMS).status_code == 401
    sign_in(client)
    r = client.post('/api/ai/questions', json=ITEMS)
    assert r.status_code == 503 and r.get_json()['ai']['available'] is False


def test_daily_limit_and_refunds(client, fake_ai, monkeypatch):
    monkeypatch.setattr(ai, 'DAILY_LIMIT', 2)
    sign_in(client)
    fake_ai['set'](ai.TIDY_SCHEMA, ai.AIError('The AI service is busy right now. Try again in a minute.'))
    r = client.post('/api/ai/questions', json=ITEMS)
    assert r.status_code == 502 and r.get_json()['ai']['remaining'] == 2   # a failed call isn't counted
    fake_ai['set'](ai.TIDY_SCHEMA, TIDY_REPLY)
    assert client.post('/api/ai/questions', json=ITEMS).get_json()['ai']['remaining'] == 1
    assert client.post('/api/ai/questions', json=ITEMS).status_code == 200
    r = client.post('/api/ai/questions', json=ITEMS)
    assert r.status_code == 429 and r.get_json()['ai']['remaining'] == 0


def test_jd_endpoint_reads_photos_only_with_ai(client, fake_ai):
    png = b'\x89PNG\r\n\x1a\n' + b'0' * 100
    form = lambda: {'jd_file': (io.BytesIO(png), 'jd.png')}  # noqa: E731
    r = client.post('/api/jd', data=form(), content_type='multipart/form-data')
    assert r.status_code == 400                                             # guest: no AI
    sign_in(client)
    fake_ai['set'](ai.JD_SCHEMA, {**AI_JD, 'source_text': 'Data Engineer ...'})
    r = client.post('/api/jd', data={**form(), 'use_ai': '1'}, content_type='multipart/form-data')
    body = r.get_json()
    assert r.status_code == 200 and body['analysis']['ai'] and body['text'] == 'Data Engineer ...'
    assert fake_ai['sent'][-1]['content'][0]['source']['media_type'] == 'image/png'


def test_jd_endpoint_falls_back_to_the_rules(client, fake_ai):
    sign_in(client)
    fake_ai['set'](ai.JD_SCHEMA, ai.AIError('The AI service is busy right now. Try again in a minute.'))
    from test_parsing import SDE_JD
    r = client.post('/api/jd', data={'jd_text': SDE_JD, 'use_ai': '1'}, content_type='multipart/form-data')
    body = r.get_json()
    assert r.status_code == 200 and 'busy' in body['ai_error'] and body['analysis']['company'] == 'Razorpay'
    assert 'ai' not in body['analysis']


def test_status_is_in_the_auth_config(client, fake_ai):
    assert client.get('/api/auth/config').get_json()['ai'] == {
        'available': True, 'model': ai.MODEL, 'limit': ai.DAILY_LIMIT, 'remaining': None}
    sign_in(client)
    assert client.get('/api/auth/config').get_json()['ai']['remaining'] == ai.DAILY_LIMIT


def test_rules_still_read_text_pdfs_and_reject_images_without_ai():
    with pytest.raises(jd.NeedsAI):
        jd.text_from_upload('scan.jpg', b'\xff\xd8\xff' + b'0' * 50)
