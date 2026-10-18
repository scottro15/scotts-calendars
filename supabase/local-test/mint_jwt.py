#!/usr/bin/env python3
"""LOCAL TESTING ONLY: mint HS256 JWTs for the throwaway local PostgREST.
usage: mint_jwt.py SECRET service_role|owner|other"""
import base64, hashlib, hmac, json, sys, time
def b64(b): return base64.urlsafe_b64encode(b).rstrip(b'=').decode()
secret, who = sys.argv[1], sys.argv[2]
claims = {'service_role': {'role': 'service_role'},
          'owner': {'role': 'authenticated', 'sub': '33333333-3333-3333-3333-333333333333', 'email': 'scottro1522@gmail.com'},
          'other': {'role': 'authenticated', 'sub': '22222222-2222-2222-2222-222222222222', 'email': 'someone@else.com'},
          'anon': {'role': 'anon'}}[who]
claims.update(iat=int(time.time()), exp=int(time.time()) + 86400 * 30, aud='authenticated')
h = b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode()); p = b64(json.dumps(claims).encode())
sig = b64(hmac.new(secret.encode(), f'{h}.{p}'.encode(), hashlib.sha256).digest())
print(f'{h}.{p}.{sig}')
