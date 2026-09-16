# Authentication testing

Launchpad uses an opaque `session_token` for email/password authentication. The backend sets it as an HTTP-only cookie, and the Chrome extension may send the same token as a bearer credential.

Start the local stack, then create a unique test account:

```bash
curl -c cookies.txt -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"local-test@example.com","password":"replace-this-password","name":"Local Test"}'

curl -b cookies.txt http://localhost:8080/api/auth/me
curl -b cookies.txt http://localhost:8080/api/applications
curl -b cookies.txt http://localhost:8080/api/analytics
```

Local Compose uses `Secure=false` and `SameSite=Lax` so cookies work over localhost HTTP. A public HTTPS deployment must use `COOKIE_SECURE=true` and an exact CORS allowlist.

Google sign-in uses the operator-owned OAuth client and server-side authorization-code flow. In the invite-only production beta, new accounts are restricted by `BETA_ALLOWED_EMAILS`, and each invited address must also be added as a Google OAuth test user while the consent screen remains in testing mode. Existing email/password accounts can still sign in, but public email/password registration is disabled in production.
