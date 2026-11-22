"""First run on a person's own PC: who they are (sent once to the Prepify team's user list on Supabase) and
their own Groq API key (saved only in their own .env, next to the app).

Supabase holds one table, prepify_users, that the app can only add rows to: its row-level security allows
INSERT for the public key and nothing else, so the key built into the app can't read anyone's details.
The SQL to create it is in supabase/prepify_users.sql.
"""
import json
import os
import re
import threading
from datetime import datetime, timezone

import requests

APP_VERSION = '1.0.0'

# The Prepify team's Supabase project. The publishable (anon) key is meant to ship inside apps; the table's
# security rules are what keep the list private. SUPABASE_URL / SUPABASE_KEY in .env override these.
DEFAULT_SUPABASE_URL = ''
DEFAULT_SUPABASE_KEY = ''

EMAIL_RX = re.compile(r'^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,}$')
GROQ_KEY_RX = re.compile(r'^gsk_[A-Za-z0-9]{20,100}$')

_lock = threading.Lock()


class SetupError(ValueError):
    pass


def supabase_config():
    url = (os.environ.get('SUPABASE_URL') or DEFAULT_SUPABASE_URL).strip().rstrip('/')
    key = (os.environ.get('SUPABASE_KEY') or DEFAULT_SUPABASE_KEY).strip()
    return (url, key) if url.startswith('https://') and key else (None, None)


# ---------- the person's details, kept locally until Supabase has them ----------
def load_profile(path):
    try:
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, dict) and data.get('email') else None
    except (OSError, ValueError):
        return None


def _write_json(path, data):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, path)


def save_profile(path, name, email):
    name = re.sub(r'\s+', ' ', str(name or '')).strip()
    email = str(email or '').strip().lower()
    if not 1 <= len(name) <= 80:
        raise SetupError('Please tell us your name.')
    if len(email) > 254 or not EMAIL_RX.match(email):
        raise SetupError('That email address doesn\'t look right.')
    profile = {'name': name, 'email': email, 'registered_at': datetime.now(timezone.utc).isoformat(),
               'app_version': APP_VERSION, 'synced': False}
    with _lock:
        _write_json(path, profile)
    return profile


def sync_profile(path, timeout=10):
    """Send the details to Supabase once. True when Supabase has them (now or already), False to retry later."""
    url, key = supabase_config()
    with _lock:
        profile = load_profile(path)
    if not profile or profile.get('synced'):
        return bool(profile)
    if not url:
        return False
    headers = {'apikey': key, 'Content-Type': 'application/json', 'Prefer': 'return=minimal'}
    if key.startswith('eyJ'):                      # a legacy anon key is a JWT and goes in Authorization too
        headers['Authorization'] = 'Bearer ' + key
    body = {'name': profile['name'], 'email': profile['email'], 'app_version': profile.get('app_version', APP_VERSION)}
    try:
        r = requests.post(f'{url}/rest/v1/prepify_users', headers=headers, json=body, timeout=timeout)
    except requests.RequestException:
        return False
    if r.status_code in (200, 201, 204, 409):         # 409: this email is already on the list
        with _lock:
            profile = load_profile(path) or profile
            profile['synced'] = True
            _write_json(path, profile)
        return True
    return False


def sync_in_background(path):
    threading.Thread(target=sync_profile, args=(path,), daemon=True).start()


# ---------- the person's own Groq key, in their own .env ----------
def check_groq_key(key, timeout=12):
    """Ask Groq whether the key works (listing models costs no tokens)."""
    key = str(key or '').strip()
    if not GROQ_KEY_RX.match(key):
        raise SetupError('A Groq key starts with "gsk_" followed by letters and numbers. Copy it again from console.groq.com/keys.')
    try:
        r = requests.get('https://api.groq.com/openai/v1/models', headers={'Authorization': 'Bearer ' + key}, timeout=timeout)
    except requests.RequestException:
        raise SetupError("Couldn't reach Groq to check the key. Check the internet connection (or turn off a VPN) and try again.")
    if r.status_code == 401:
        raise SetupError('Groq says this key is not valid. Create a new one at console.groq.com/keys and paste it here.')
    if not r.ok:
        raise SetupError(f'Groq could not check the key right now ({r.status_code}). Try again in a minute.')
    return key


def set_env_value(env_path, name, value):
    """Set NAME=value in a .env file, keeping every other line, and in this process."""
    lines = []
    try:
        with open(env_path, encoding='utf-8') as f:
            lines = f.read().splitlines()
    except OSError:
        pass
    out, done = [], False
    for line in lines:
        if re.match(rf'^\s*{re.escape(name)}\s*=', line):
            if not done:
                out.append(f'{name}={value}')
                done = True
            continue
        out.append(line)
    if not done:
        out.append(f'{name}={value}')
    tmp = env_path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write('\n'.join(out) + '\n')
    os.replace(tmp, env_path)
    os.environ[name] = value
