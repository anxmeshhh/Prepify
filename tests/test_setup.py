"""First run: the welcome details (sent once to Supabase) and the person's own Groq key (saved in their .env).
Run: python -m pytest tests"""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as prepify  # noqa: E402
import setup_local as sl  # noqa: E402


@pytest.fixture
def local(monkeypatch, tmp_path):
    """The app's profile and .env files in a temporary folder, Supabase configured, no network."""
    monkeypatch.setattr(prepify, 'PROFILE_FILE', str(tmp_path / 'profile.json'))
    monkeypatch.setattr(prepify, 'ENV_FILE', str(tmp_path / '.env'))
    monkeypatch.setattr(prepify, 'PUBLIC_URL', '')
    monkeypatch.setenv('SUPABASE_URL', 'https://demo.supabase.co')
    monkeypatch.setenv('SUPABASE_KEY', 'sb_publishable_demo')
    monkeypatch.delenv('GROQ_API_KEY', raising=False)
    sent = []

    class R:
        def __init__(self, code):
            self.status_code, self.ok = code, 200 <= code < 300

    state = {'supabase': 201, 'groq': 200}

    def post(url, headers=None, json=None, timeout=None):
        sent.append({'url': url, 'headers': headers, 'json': json})
        return R(state['supabase'])

    def get(url, headers=None, timeout=None):
        sent.append({'url': url, 'headers': headers})
        return R(state['groq'])
    monkeypatch.setattr(sl.requests, 'post', post)
    monkeypatch.setattr(sl.requests, 'get', get)
    return {'dir': tmp_path, 'sent': sent, 'state': state, 'client': prepify.app.test_client()}


def test_first_run_asks_who_you_are(local):
    s = local['client'].get('/api/setup').get_json()
    assert s['local'] and not s['registered'] and not s['groq_key']


def test_welcome_details_go_to_supabase_once(local):
    c = local['client']
    r = c.post('/api/setup/profile', json={'name': '  Riya   Sharma ', 'email': 'Riya@Gmail.com'})
    assert r.get_json() == {'ok': True, 'synced': True}
    call = local['sent'][-1]
    assert call['url'] == 'https://demo.supabase.co/rest/v1/prepify_users'
    assert call['json'] == {'name': 'Riya Sharma', 'email': 'riya@gmail.com', 'app_version': sl.APP_VERSION}
    assert call['headers']['apikey'] == 'sb_publishable_demo' and 'Authorization' not in call['headers']
    assert c.get('/api/setup').get_json()['registered'] is True
    assert sl.sync_profile(prepify.PROFILE_FILE) is True and len(local['sent']) == 1     # not sent twice


def test_offline_details_are_kept_and_sent_later(local):
    local['state']['supabase'] = 503
    r = local['client'].post('/api/setup/profile', json={'name': 'Riya', 'email': 'riya@gmail.com'})
    assert r.get_json() == {'ok': True, 'synced': False}
    assert json.load(open(prepify.PROFILE_FILE))['synced'] is False
    local['state']['supabase'] = 409                       # already on the list counts as done
    assert sl.sync_profile(prepify.PROFILE_FILE) is True
    assert json.load(open(prepify.PROFILE_FILE))['synced'] is True


@pytest.mark.parametrize('name,email', [('', 'a@gmail.com'), ('Riya', 'not-an-email'), ('Riya', 'a@b'), ('x' * 81, 'a@gmail.com')])
def test_bad_details_are_refused(local, name, email):
    r = local['client'].post('/api/setup/profile', json={'name': name, 'email': email})
    assert r.status_code == 400 and not os.path.exists(prepify.PROFILE_FILE)


def test_own_groq_key_is_checked_then_saved_in_env(local):
    env = local['dir'] / '.env'
    env.write_text('PREPIFY_SECRET=abc\nGROQ_API_KEY=old\n')
    c = local['client']
    key = 'gsk_' + 'A1b2C3' * 8
    r = c.post('/api/setup/groq', json={'key': key})
    assert r.status_code == 200 and r.get_json()['ai']['available'] is True
    assert env.read_text() == f'PREPIFY_SECRET=abc\nGROQ_API_KEY={key}\n'        # other settings kept
    assert local['sent'][-1]['headers']['Authorization'] == 'Bearer ' + key
    local['state']['groq'] = 401
    r = c.post('/api/setup/groq', json={'key': 'gsk_' + 'Z9' * 20})
    assert r.status_code == 400 and 'not valid' in r.get_json()['error']
    assert c.post('/api/setup/groq', json={'key': 'sk-not-groq'}).status_code == 400


def test_setup_is_refused_on_a_hosted_copy(local, monkeypatch):
    monkeypatch.setattr(prepify, 'PUBLIC_URL', 'https://prepify.example.com')
    c = local['client']
    assert c.post('/api/setup/profile', json={'name': 'A', 'email': 'a@gmail.com'}).status_code == 403
    assert c.post('/api/setup/groq', json={'key': 'gsk_' + 'a' * 40}).status_code == 403
    assert c.get('/api/setup').get_json()['local'] is False
