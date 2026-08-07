# Auth Testing Playbook (CareerTrack)

Unified auth: opaque `session_token` cookie for BOTH email/password and Google login.

## Demo credentials
- Email: demo@careertrack.com / Password: demo1234 (seeded with 10 sample applications)

## Backend API tests
```
# Register / login
curl -c cookies.txt -X POST http://localhost:8001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@careertrack.com","password":"demo1234"}'

# Current user via cookie
curl -b cookies.txt http://localhost:8001/api/auth/me

# List applications
curl -b cookies.txt http://localhost:8001/api/applications

# Analytics
curl -b cookies.txt http://localhost:8001/api/analytics
```

## MongoDB verification
```
mongosh
use test_database
db.users.findOne({email: "demo@careertrack.com"})   // password_hash starts with $2b$
db.applications.countDocuments({})                   // ~10 seeded
db.user_sessions.find().limit(2)
```

## Notes
- Cookies: httpOnly, secure, samesite=none, path=/
- Google login flow: frontend redirects to https://auth.emergentagent.com/?redirect=<origin>/dashboard
  then AuthCallback POSTs /api/auth/session with X-Session-ID header.
- All /applications and /analytics endpoints require auth and are scoped to the logged-in user.
