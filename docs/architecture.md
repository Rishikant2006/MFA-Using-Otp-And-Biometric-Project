# Architecture notes

The frontend is deliberately framework-free so the authentication process and browser WebAuthn calls remain easy to inspect. It communicates with the Express API through credentialed requests and fetches a CSRF token before every state-changing request.

The API owns authentication state. A signed JWT identifies a server-side `Session` record whose token hash, expiration, revocation state, device label, and MFA stage are checked on protected requests. MongoDB holds application data and audit history. Email is an adapter: Resend is preferred in production, with Gmail SMTP retained for local development.

Roles are enforced server-side. UI visibility is a convenience only; routes independently require the appropriate student, faculty, admin, or security-admin authority.
