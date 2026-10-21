# IILM University Portal

A full-stack university portal with password authentication, email OTP, WebAuthn passkeys, recovery codes, and role-aware student, faculty, and administration workspaces.

## Highlights

- Password, email OTP, and WebAuthn passkey MFA
- Single-use recovery codes and named server-side sessions
- New-device security alerts, audit records, CSRF protection, rate limiting, and security headers
- Student timetable, deadlines, fees, notifications, course search, and grade-report download
- Faculty roster workspace and controlled record updates
- Admin security dashboard with CSV audit export

## Architecture

```text
Browser (static frontend)
        │ HTTPS, cookies, and CSRF header
        ▼
Nginx or local web server ──► Express API ──► MongoDB
                                  │
                                  └──► Resend (preferred) or Gmail SMTP
```

## Local setup

Prerequisites: Node.js 20+, MongoDB 7+, and an email provider for OTP delivery.

```powershell
Copy-Item backend/.env.example backend/.env
cd backend
npm ci
npm run dev
```

Set unique values of at least 32 characters for `JWT_SECRET` and `IP_HASH_SECRET` in `backend/.env`. Configure `RESEND_API_KEY` with a verified `EMAIL_FROM` address, or use the Gmail fallback variables. Never commit the `.env` file.

Serve `frontend/` with a local HTTP server (for example VS Code Live Server on port 5500). In that development mode, the UI connects to `http://localhost:5000/api`.

To load sample data into a configured MongoDB instance:

```powershell
cd backend
node seed.js
```

Demo credentials are local-only examples and must be removed or changed before deployment.

## Docker

```powershell
Copy-Item backend/.env.example backend/.env
# Set secrets and email variables before starting.
docker compose up --build
```

Open `http://localhost:8080`. Compose uses development cookie settings for localhost. Production needs HTTPS, `NODE_ENV=production`, exact public origins, and a matching `WEBAUTHN_RP_ID`.

## Quality checks

```powershell
cd backend
npm test
npm run lint
npm run format:check
```

The tests cover security helpers, OTP generation, device labels, and an API health smoke test. GitHub Actions runs them for pushes and pull requests.

## Documentation

- [OpenAPI contract](docs/openapi.yaml)
- [Architecture notes](docs/architecture.md)
- [Threat model and production checklist](docs/threat-model.md)

Important endpoints include `POST /api/auth/login`, `POST /api/auth/otp/verify`, `GET /api/portal/academic`, `GET /api/portal/faculty/courses`, and `GET /api/admin/security/logs/export`.

## Security and operations

- Tokens are stored in `HttpOnly` cookies, with CSRF protection on state-changing browser requests.
- OTPs and recovery codes are bcrypt-hashed; recovery codes are displayed only once.
- `/api/health` checks process availability and `/api/ready` checks MongoDB readiness.
- Request logs are structured JSON with request IDs and exclude credentials, OTPs, tokens, and raw IP addresses.

Review the threat model before public deployment. Run `npm audit` in every release cycle and remediate advisories deliberately rather than forcing breaking upgrades.
