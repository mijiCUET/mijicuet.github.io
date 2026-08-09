#!/usr/bin/env python3
"""Configure the Grade 3 frontend for the deployed math-auth Worker and re-pin CSP hashes."""
from pathlib import Path
from urllib.parse import urlparse
import argparse, base64, hashlib, re, sys


def sha256_source(text: str) -> str:
    digest = hashlib.sha256(text.encode('utf-8')).digest()
    return "'sha256-" + base64.b64encode(digest).decode('ascii') + "'"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('worker_origin', help='e.g. https://math-auth.example-subdomain.workers.dev')
    ap.add_argument('html', nargs='?', default='index.html')
    args = ap.parse_args()
    u = urlparse(args.worker_origin)
    if u.scheme != 'https' or not u.hostname or u.username or u.password or u.query or u.fragment or u.path not in ('', '/'):
        ap.error('worker_origin must be a bare HTTPS origin with no path/query/fragment')
    origin = f'https://{u.hostname}' + (f':{u.port}' if u.port else '')
    if u.hostname.endswith('.workers.dev') and not u.hostname.startswith('math-auth.'):
        ap.error('the workers.dev hostname should start with math-auth.')

    p = Path(args.html)
    s = p.read_text(encoding='utf-8')
    s, n = re.subn(r'(<meta name="grade3-api-base" content=")[^"]+("\s*>)', lambda m: m.group(1)+origin+m.group(2), s, count=1)
    if n != 1:
        raise SystemExit('Could not find the grade3-api-base meta tag.')
    style_m = re.search(r'<style>(.*?)</style>', s, re.S)
    script_m = re.search(r'<script>(.*?)</script>', s, re.S)
    if not style_m or not script_m:
        raise SystemExit('Could not find the single inline style/script blocks.')
    csp = (
        "default-src 'none'; "
        f"script-src {sha256_source(script_m.group(1))}; "
        f"style-src {sha256_source(style_m.group(1))}; "
        "img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; "
        f"object-src 'none'; connect-src {origin}"
    )
    s, n = re.subn(r'(Content-Security-Policy" content=")[^"]+("[^>]*>)', lambda m: m.group(1)+csp+m.group(2), s, count=1)
    if n != 1:
        raise SystemExit('Could not find the CSP meta tag.')
    p.write_text(s, encoding='utf-8', newline='\n')
    print(f'Configured {p} for {origin}')
    print('CSP script/style hashes re-pinned.')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
