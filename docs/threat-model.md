# Threat model and deployment checklist

## Assets

Credentials, OTPs, passkey public keys, recovery-code hashes, sessions, student records, fee metadata, and audit history require protection. Raw IP addresses, access tokens, OTPs, and passwords must not appear in logs or exports.

## Main controls

| Threat | Mitigation |
| --- | --- |
| Credential stuffing | Rate limits, bcrypt password hashing, temporary account lockout, audited failures |
| Session theft | HttpOnly cookies, server-side sessions, token hashes, CSRF checks, individual and all-other session revocation |
| Cross-site requests | Origin allowlist, credentialed CORS, CSRF token, Helmet headers |
| Passkey loss | Eight single-use bcrypt-hashed recovery codes, regenerated on demand |
| New-device access | Device labels, suspicious-login audit event, best-effort security email alert |
| Privilege escalation | Server-side role middleware and security-admin restriction for privileged role grants |
| Data injection | Input validation, frontend output escaping, and CSV escaping |

## Production checklist

1. Use HTTPS end to end and set `NODE_ENV=production`.
2. Set the exact HTTPS frontend origin and matching WebAuthn RP ID; never use permissive CORS.
3. Store secrets in the deployment platform secret manager, rotate them, and set a separate `IP_HASH_SECRET`.
4. Configure a verified transactional sender and monitor email delivery failures.
5. Use managed MongoDB with backups, private network access, and least-privilege credentials.
6. Centralise JSON logs and monitor health, readiness, failed-login rates, and audit exports.
7. Run tests, linting, dependency review, and an authorised penetration test before release.
8. Apply retention, consent, and incident-response policies required by the institution and applicable privacy law.
