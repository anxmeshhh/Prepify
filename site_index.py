"""Finding a company's own section on sites whose addresses can't be guessed from the company name.

Code360 files TCS under /interview-experiences/tata-consultancy-services and Infosys under
infosys-technologies-limited; PrepInsta has sections like /tcs/ but nothing at all for many companies.
Both sites publish sitemaps for search engines, so Prepify reads those (public site structure only,
kept in memory for a day) and either points the extension at the right page or says the site has
nothing for that company, instead of guessing an address and reporting "nothing found".
"""
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import requests

from query_parser import ALIAS, COMPANIES

UA = 'Prepify/0.9 (personal interview preparation; reads public sitemaps)'
TTL = 24 * 3600
SITES = ('Code360', 'PrepInsta')

_cache = {}
_locks = {s: threading.Lock() for s in SITES}


class IndexError_(Exception):
    pass


def _get(url, timeout=40):
    r = requests.get(url, headers={'User-Agent': UA}, timeout=timeout)
    r.raise_for_status()
    return r.text


def _locs(xml):
    return re.findall(r'<loc>\s*([^<\s]+)\s*</loc>', xml)


def _build_code360():
    """slug -> number of interview experiences."""
    counts = {}
    for u in _locs(_get('https://www.naukri.com/code360/sitemap.xml', 90)):
        m = re.match(r'https://www\.naukri\.com/code360/interview-experiences/([a-z0-9-]+)(/[^/?#]+)?/?$', u)
        if m:
            counts[m.group(1)] = counts.get(m.group(1), 0) + (1 if m.group(2) else 0)
    return counts


def _build_prepinsta():
    """section -> {'pages': n, 'interview': [urls about interviews, hiring or the test pattern]}."""
    maps = [u for u in _locs(_get('https://prepinsta.com/sitemap_index.xml')) if re.search(r'(page|post)-sitemap', u)]

    def fetch(u):
        try:
            return _get(u)
        except requests.RequestException:
            return ''                      # one missing sitemap file shouldn't sink the rest
    with ThreadPoolExecutor(4) as ex:
        xmls = list(ex.map(fetch, maps))
    sections = {}
    for xml in xmls:
        for u in _locs(xml):
            m = re.match(r'https://prepinsta\.com/([a-z0-9-]+)/(.+)$', u)
            if not m:
                continue
            d = sections.setdefault(m.group(1), {'pages': 0, 'interview': []})
            d['pages'] += 1
            if re.search(r'interview|recruitment|selection|hiring|placement|pattern|syllabus', m.group(2)):
                d['interview'].append(u)
    return sections


_BUILD = {'Code360': _build_code360, 'PrepInsta': _build_prepinsta}


def _index(site):
    hit = _cache.get(site)
    if hit and time.time() - hit[0] < TTL:
        return hit[1]
    with _locks[site]:
        hit = _cache.get(site)
        if hit and time.time() - hit[0] < TTL:
            return hit[1]
        try:
            data = _BUILD[site]()
        except requests.RequestException as e:
            if hit:                        # keep using yesterday's index rather than failing
                return hit[1]
            raise IndexError_(f"{site}'s index couldn't be read ({type(e).__name__}).")
        _cache[site] = (time.time(), data)
        return data


def _slug(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower().replace('&', ' and ')).strip('-')


def _names(company):
    """The company's name and every alias Prepify knows, as slugs ("TCS" -> tcs, tata-consultancy-services, ...)."""
    c = company.strip()
    canon = ALIAS.get(c.lower()) or next((k for k in COMPANIES if k.lower() == c.lower()), None)
    names = [c] + ([canon] + COMPANIES.get(canon, []) if canon else [])
    out = []
    for n in names:
        s = _slug(n)
        if s and s not in out:
            out.append(s)
    return out


def _matches(key, names):
    """Does a site's slug name this company? The same slug, or the slug plus a legal suffix
    (infosys-technologies-limited), never a different company that merely starts the same way."""
    for s in names:
        if key == s:
            return True
        if key.startswith(s + '-') and re.fullmatch(
                r'(-(technologies|technology|solutions|services|india|limited|ltd|pvt|private|inc|corp|corporation|company|co|group|global|and|systems|software|consulting|labs?))+',
                key[len(s):]):
            return True
    return False


def locate(site, company):
    """{'covered': True, 'url': ..., 'match': [words], 'count': n} or {'covered': False, 'message': ...}."""
    if site not in SITES:
        raise ValueError(site)
    names = _names(company)
    data = _index(site)
    if site == 'Code360':
        found = sorted(((k, n) for k, n in data.items() if n and _matches(k, names)), key=lambda kv: -kv[1])
        if not found:
            return {'covered': False, 'message': f'Code360 has no interview experiences for {company}.'}
        slug, n = found[0]
        return {'covered': True, 'url': f'https://www.naukri.com/code360/interview-experiences/{slug}',
                'match': slug.split('-')[:2], 'count': n}
    found = sorted(((k, d) for k, d in data.items() if d['interview'] and _matches(k, names)),
                   key=lambda kv: -len(kv[1]['interview']))
    if not found:
        return {'covered': False, 'message': f'PrepInsta has no interview pages for {company}.'}
    seg, d = found[0]
    pages = d['interview']
    best = (next((u for u in pages if re.search(rf'/{seg}/interview-experiences?/?$', u)), None)
            or next((u for u in pages if re.search(rf'/{seg}/interview-questions/?$', u)), None)
            or f'https://prepinsta.com/{seg}/')
    return {'covered': True, 'url': best, 'match': [seg], 'count': len(pages)}
