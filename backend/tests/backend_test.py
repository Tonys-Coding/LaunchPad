"""Backend API tests for CareerTrack."""
import os
import uuid
import io
import zipfile
from datetime import datetime, timedelta
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

import pytest
import requests

BASE_URL = os.environ.get("LAUNCHPAD_TEST_URL", "http://localhost:8080").rstrip("/")
OAUTH_PUBLIC_URL = os.environ.get("PUBLIC_BASE_URL", BASE_URL).rstrip("/")

DEMO_EMAIL = os.environ.get("DEMO_EMAIL", "demo@careertrack.com")
DEMO_PASSWORD = os.environ.get("DEMO_PASSWORD", "demo1234")
EXTENSION_ORIGIN = os.environ.get(
    "LAUNCHPAD_TEST_EXTENSION_ORIGIN",
    "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
)


@pytest.fixture(scope="module")
def demo_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}, timeout=30)
    temporary = r.status_code != 200
    email = DEMO_EMAIL
    password = DEMO_PASSWORD
    if temporary:
        email = f"test_demo_{uuid.uuid4().hex[:8]}@example.com"
        password = "password123"
        r = s.post(
            f"{BASE_URL}/api/auth/register",
            json={"email": email, "password": password, "name": "Test Demo User"},
            timeout=30,
        )
        assert r.status_code == 200, f"test demo registration failed: {r.status_code} {r.text}"
        statuses = ["Applied", "Screening", "Interviewing", "Offer", "Rejected"] * 2
        for index, status in enumerate(statuses):
            payload = {
                "company_name": f"TEST_Demo_{index}", "job_title": f"Role {index}",
                "day_applied": f"2026-0{(index % 8) + 1}-10", "status": status,
                "pay_amount": 30 + index, "pay_period": "hourly",
                "start_date_tbd": status in {"Applied", "Rejected"},
                "expected_start_date": None if status in {"Applied", "Rejected"} else "2027-06-01",
                "start_date_month_only": status not in {"Applied", "Rejected"},
                "interview_date": "2026-09-15T14:00:00" if status == "Interviewing" else None,
                "follow_up_date": "2026-09-20" if status in {"Applied", "Screening", "Interviewing"} else None,
            }
            created = s.post(f"{BASE_URL}/api/applications", json=payload, timeout=30)
            assert created.status_code == 200, created.text
    s._email = email
    s._password = password
    yield s
    if temporary:
        s.delete(
            f"{BASE_URL}/api/settings/account",
            json={"confirmation_email": email},
            timeout=60,
        )


@pytest.fixture(scope="module")
def new_user_session():
    s = requests.Session()
    email = f"test_{uuid.uuid4().hex[:8]}@example.com"
    r = s.post(f"{BASE_URL}/api/auth/register",
               json={"email": email, "password": "password123", "name": "Test User"},
               timeout=30)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    s._email = email
    return s


@pytest.fixture(scope="module")
def second_user_session():
    s = requests.Session()
    email = f"other_{uuid.uuid4().hex[:8]}@example.com"
    r = s.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": "password123", "name": "Other User"},
        timeout=30,
    )
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    s._email = email
    return s


# ---------- Auth ----------
class TestAuth:
    def test_login_success(self, demo_session):
        r = demo_session.get(f"{BASE_URL}/api/auth/me", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["email"] == demo_session._email
        assert "user_id" in data
        assert data["auth_provider"] == "email"

    def test_login_invalid(self, demo_session):
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": demo_session._email, "password": "wrong"}, timeout=30)
        assert r.status_code == 401

    def test_register_and_me(self, new_user_session):
        r = new_user_session.get(f"{BASE_URL}/api/auth/me", timeout=30)
        assert r.status_code == 200
        assert r.json()["email"] == new_user_session._email

    def test_login_sets_persistent_http_only_cookie(self, new_user_session):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": new_user_session._email, "password": "password123"},
            timeout=30,
        )
        assert r.status_code == 200
        cookie = r.headers.get("set-cookie", "").lower()
        assert "session_token=" in cookie
        assert "max-age=2592000" in cookie
        assert "httponly" in cookie
        assert "samesite=lax" in cookie

    def test_google_oauth_requires_account_selection(self):
        providers = requests.get(f"{BASE_URL}/api/auth/providers", timeout=30).json()
        if not providers.get("google"):
            pytest.skip("Google OAuth is not configured")
        r = requests.get(
            f"{BASE_URL}/api/auth/google/start",
            params={"return_to": "/dashboard"},
            allow_redirects=False,
            timeout=30,
        )
        assert r.status_code == 302
        params = parse_qs(urlparse(r.headers["location"]).query)
        assert params["prompt"] == ["select_account"]
        assert params["redirect_uri"] == [f"{OAUTH_PUBLIC_URL}/api/auth/google/callback"]

    def test_logout_invalidates_persistent_session(self, new_user_session):
        session = requests.Session()
        login = session.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": new_user_session._email, "password": "password123"},
            timeout=30,
        )
        assert login.status_code == 200
        assert session.get(f"{BASE_URL}/api/auth/me", timeout=30).status_code == 200
        logout = session.post(f"{BASE_URL}/api/auth/logout", timeout=30)
        assert logout.status_code == 200
        assert session.get(f"{BASE_URL}/api/auth/me", timeout=30).status_code == 401

    def test_register_duplicate_email(self, new_user_session):
        r = requests.post(f"{BASE_URL}/api/auth/register",
                          json={"email": new_user_session._email, "password": "password123", "name": "Dup"},
                          timeout=30)
        assert r.status_code == 400

    def test_me_unauthenticated(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", timeout=30)
        assert r.status_code == 401

    def test_registration_uses_eight_character_password_minimum(self):
        email = f"password_rule_{uuid.uuid4().hex[:8]}@example.com"
        too_short = requests.post(
            f"{BASE_URL}/api/auth/register",
            json={"email": email, "password": "short7", "name": "Password Rule"},
            timeout=30,
        )
        assert too_short.status_code == 422
        session = requests.Session()
        created = session.post(
            f"{BASE_URL}/api/auth/register",
            json={"email": email, "password": "long-enough", "name": "Password Rule"},
            timeout=30,
        )
        assert created.status_code == 200
        deleted = session.delete(
            f"{BASE_URL}/api/settings/account",
            json={"confirmation_email": email},
            timeout=30,
        )
        assert deleted.status_code == 200

    def test_extension_login_returns_bearer_session(self, new_user_session):
        no_origin = requests.post(
            f"{BASE_URL}/api/auth/extension-login",
            json={"email": new_user_session._email, "password": "password123"},
            timeout=30,
        )
        assert no_origin.status_code == 403

        response = requests.post(
            f"{BASE_URL}/api/auth/extension-login",
            json={"email": new_user_session._email, "password": "password123"},
            headers={"Origin": EXTENSION_ORIGIN},
            timeout=30,
        )
        assert response.status_code == 200, response.text
        token = response.json()["session_token"]
        me = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Origin": EXTENSION_ORIGIN, "Authorization": f"Bearer {token}"},
            timeout=30,
        )
        assert me.status_code == 200
        assert me.json()["email"] == new_user_session._email

    def test_logout(self, demo_session):
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/login",
                   json={"email": demo_session._email, "password": demo_session._password}, timeout=30)
        assert r.status_code == 200
        r = s.post(f"{BASE_URL}/api/auth/logout", timeout=30)
        assert r.status_code == 200
        r = s.get(f"{BASE_URL}/api/auth/me", timeout=30)
        assert r.status_code == 401


# ---------- Resume Studio ----------
class TestResumeStudio:
    def test_profile_master_export_and_cross_user_isolation(self, new_user_session, second_user_session):
        profile = new_user_session.put(
            f"{BASE_URL}/api/resume-profile",
            json={
                "full_name": "Resume Owner", "preferred_email": new_user_session._email,
                "phone": "312-555-1212", "city": "Chicago", "region": "IL",
                "country": "US", "linkedin": None, "github": None, "portfolio": None,
                "education": [],
            }, timeout=30,
        )
        assert profile.status_code == 200, profile.text
        created = new_user_session.post(
            f"{BASE_URL}/api/resumes",
            json={
                "name": "TEST Engineering Master", "template": "standard", "is_default": True,
                "content": {
                    "summary": "Engineering student building reliable tools.",
                    "skills": [{"name": "Python"}],
                    "experience": [], "projects": [{
                        "title": "LaunchPad", "organization": "Personal",
                        "bullets": ["Built a private career workspace"],
                    }], "education": [], "accomplishments": [], "certifications": [],
                },
            }, timeout=30,
        )
        assert created.status_code == 200, created.text
        resume_id = created.json()["resume_id"]
        assert second_user_session.get(f"{BASE_URL}/api/resumes/{resume_id}", timeout=30).status_code == 404
        assert second_user_session.put(
            f"{BASE_URL}/api/resumes/{resume_id}", json={
                "name": "Stolen", "template": "standard", "content": {},
            }, timeout=30,
        ).status_code == 404
        exported = new_user_session.get(
            f"{BASE_URL}/api/resumes/{resume_id}/export", params={"format": "docx"}, timeout=30,
        )
        assert exported.status_code == 200, exported.text
        assert exported.content.startswith(b"PK")
        exported_pdf = new_user_session.get(
            f"{BASE_URL}/api/resumes/{resume_id}/export", params={"format": "pdf"}, timeout=45,
        )
        assert exported_pdf.status_code == 200, exported_pdf.text
        assert exported_pdf.content.startswith(b"%PDF")
        removed = new_user_session.delete(f"{BASE_URL}/api/resumes/{resume_id}", timeout=30)
        assert removed.status_code == 200

    def test_txt_import_is_private_and_editable(self, new_user_session, second_user_session):
        imported = new_user_session.post(
            f"{BASE_URL}/api/resumes/import",
            files={"file": ("resume.txt", b"SUMMARY\nStudent developer\nSKILLS\nPython, React\nEXPERIENCE\nIntern | Example\n- Built reliable software", "text/plain")},
            data={"name": "TEST Imported Resume", "template": "compact", "improve_with_ai": "false"},
            timeout=30,
        )
        assert imported.status_code == 200, imported.text
        payload = imported.json()
        assert payload["content"]["skills"][0]["name"] == "Python"
        resume_id = payload["resume_id"]
        assert second_user_session.get(f"{BASE_URL}/api/resumes/{resume_id}", timeout=30).status_code == 404
        assert new_user_session.delete(f"{BASE_URL}/api/resumes/{resume_id}", timeout=30).status_code == 200


# ---------- User settings ----------
class TestUserSettings:
    def test_profile_and_preferences_persist_and_are_user_scoped(self):
        owner = requests.Session()
        other = requests.Session()
        owner_email = f"settings_{uuid.uuid4().hex[:8]}@example.com"
        other_email = f"settings_other_{uuid.uuid4().hex[:8]}@example.com"
        assert owner.post(
            f"{BASE_URL}/api/auth/register",
            json={"email": owner_email, "password": "password123", "name": "Original Name"},
            timeout=30,
        ).status_code == 200
        assert other.post(
            f"{BASE_URL}/api/auth/register",
            json={"email": other_email, "password": "password123", "name": "Other Name"},
            timeout=30,
        ).status_code == 200

        initial = owner.get(f"{BASE_URL}/api/auth/me", timeout=30).json()
        assert initial["preferences"]["theme"] is None
        assert initial["preferences"]["timezone"] is None
        assert initial["can_change_password"] is True

        profile = owner.put(
            f"{BASE_URL}/api/settings/profile", json={"name": "  Updated Name  "}, timeout=30
        )
        assert profile.status_code == 200, profile.text
        assert profile.json()["name"] == "Updated Name"

        preferences = owner.put(
            f"{BASE_URL}/api/settings/preferences",
            json={"theme": "system", "timezone": "America/Chicago"}, timeout=30,
        )
        assert preferences.status_code == 200, preferences.text
        assert preferences.json()["preferences"]["theme"] == "system"
        assert preferences.json()["preferences"]["timezone"] == "America/Chicago"
        assert preferences.json()["preferences"]["updated_at"]

        fresh = requests.Session()
        assert fresh.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": owner_email, "password": "password123"}, timeout=30,
        ).status_code == 200
        me = fresh.get(f"{BASE_URL}/api/auth/me", timeout=30).json()
        assert me["name"] == "Updated Name"
        assert me["preferences"]["theme"] == "system"
        assert me["preferences"]["timezone"] == "America/Chicago"

        other_me = other.get(f"{BASE_URL}/api/auth/me", timeout=30).json()
        assert other_me["name"] == "Other Name"
        assert other_me["preferences"]["theme"] is None

    @pytest.mark.parametrize("payload", [
        {"theme": "midnight", "timezone": "UTC"},
        {"theme": "dark", "timezone": "Mars/Olympus"},
        {"theme": "dark", "timezone": ""},
    ])
    def test_preference_validation(self, new_user_session, payload):
        response = new_user_session.put(f"{BASE_URL}/api/settings/preferences", json=payload, timeout=30)
        assert response.status_code == 422

    def test_profile_validation_and_unauthenticated_access(self, new_user_session):
        assert new_user_session.put(
            f"{BASE_URL}/api/settings/profile", json={"name": "   "}, timeout=30
        ).status_code == 422
        assert requests.put(
            f"{BASE_URL}/api/settings/profile", json={"name": "No session"}, timeout=30
        ).status_code == 401
        assert requests.post(
            f"{BASE_URL}/api/settings/sessions/revoke-others", timeout=30
        ).status_code == 401

    def test_password_change_and_revoke_others_preserve_current_session(self):
        email = f"security_{uuid.uuid4().hex[:8]}@example.com"
        current = requests.Session()
        other = requests.Session()
        registration = current.post(
            f"{BASE_URL}/api/auth/register",
            json={"email": email, "password": "starting-password", "name": "Security Test"},
            timeout=30,
        )
        assert registration.status_code == 200, registration.text
        assert other.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": email, "password": "starting-password"}, timeout=30,
        ).status_code == 200

        wrong = current.put(
            f"{BASE_URL}/api/settings/password",
            json={"current_password": "wrong-password", "new_password": "replacement-password", "confirm_password": "replacement-password"},
            timeout=30,
        )
        assert wrong.status_code == 400
        mismatch = current.put(
            f"{BASE_URL}/api/settings/password",
            json={"current_password": "starting-password", "new_password": "replacement-password", "confirm_password": "different-password"},
            timeout=30,
        )
        assert mismatch.status_code == 422

        changed = current.put(
            f"{BASE_URL}/api/settings/password",
            json={"current_password": "starting-password", "new_password": "replacement-password", "confirm_password": "replacement-password"},
            timeout=30,
        )
        assert changed.status_code == 200, changed.text
        assert changed.json()["revoked_sessions"] >= 1
        assert current.get(f"{BASE_URL}/api/auth/me", timeout=30).status_code == 200
        assert other.get(f"{BASE_URL}/api/auth/me", timeout=30).status_code == 401
        assert requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": email, "password": "starting-password"}, timeout=30,
        ).status_code == 401

        another = requests.Session()
        assert another.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": email, "password": "replacement-password"}, timeout=30,
        ).status_code == 200
        revoked = current.post(f"{BASE_URL}/api/settings/sessions/revoke-others", timeout=30)
        assert revoked.status_code == 200, revoked.text
        assert revoked.json()["revoked_sessions"] >= 1
        assert current.get(f"{BASE_URL}/api/auth/me", timeout=30).status_code == 200
        assert another.get(f"{BASE_URL}/api/auth/me", timeout=30).status_code == 401


class TestAccountLifecycle:
    def test_export_is_private_and_account_deletion_cascades(self):
        marker = uuid.uuid4().hex[:10]
        email = f"lifecycle_{marker}@example.com"
        session = requests.Session()
        registered = session.post(
            f"{BASE_URL}/api/auth/register",
            json={"email": email, "password": "password123", "name": "Lifecycle Test"},
            timeout=30,
        )
        assert registered.status_code == 200, registered.text

        application = session.post(
            f"{BASE_URL}/api/applications",
            json={
                "company_name": f"Export Company {marker}", "job_title": "Engineer",
                "day_applied": "2026-09-10", "start_date_tbd": True, "status": "Applied",
            },
            timeout=30,
        )
        assert application.status_code == 200, application.text
        app_id = application.json()["app_id"]
        attachment = session.post(
            f"{BASE_URL}/api/applications/{app_id}/attachments",
            files={"file": (f"resume-{marker}.txt", f"private-{marker}".encode(), "text/plain")},
            data={"kind": "resume"},
            timeout=60,
        )
        assert attachment.status_code == 200, attachment.text
        skill = session.post(
            f"{BASE_URL}/api/library/skills",
            json={"name": f"Skill {marker}", "category": "Technical", "level": "Strong"},
            timeout=30,
        )
        assert skill.status_code == 200, skill.text

        exported = session.get(f"{BASE_URL}/api/settings/export", timeout=60)
        assert exported.status_code == 200, exported.text
        assert exported.headers["content-type"].startswith("application/zip")
        with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
            names = set(archive.namelist())
            assert {"manifest.json", "account.json", "applications.json", "career-library/skills.json"} <= names
            assert any(name.startswith(f"attachments/{app_id}/") for name in names)
            applications_json = archive.read("applications.json").decode()
            assert marker in applications_json
            assert '"user_id"' not in applications_json
            assert "storage_path" not in applications_json

        wrong_confirmation = session.delete(
            f"{BASE_URL}/api/settings/account",
            json={"confirmation_email": "wrong@example.com"},
            timeout=30,
        )
        assert wrong_confirmation.status_code == 422
        deleted = session.delete(
            f"{BASE_URL}/api/settings/account",
            json={"confirmation_email": email},
            timeout=60,
        )
        assert deleted.status_code == 200, deleted.text
        assert session.get(f"{BASE_URL}/api/auth/me", timeout=30).status_code == 401
        assert requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": email, "password": "password123"},
            timeout=30,
        ).status_code == 401

    def test_export_and_delete_require_authentication(self):
        assert requests.get(f"{BASE_URL}/api/settings/export", timeout=30).status_code == 401
        assert requests.delete(
            f"{BASE_URL}/api/settings/account",
            json={"confirmation_email": "nobody@example.com"},
            timeout=30,
        ).status_code == 401


# ---------- Applications CRUD ----------
class TestApplications:
    def test_list_demo_seeded(self, demo_session):
        r = demo_session.get(f"{BASE_URL}/api/applications", timeout=30)
        assert r.status_code == 200
        apps = r.json()
        assert isinstance(apps, list)
        assert len(apps) >= 10
        # No _id or user_id leaks
        for a in apps:
            assert "_id" not in a
            assert "user_id" not in a
            assert "app_id" in a

    def test_create_read_update_delete(self, new_user_session):
        # CREATE
        payload = {
            "company_name": "TEST_Corp", "job_title": "SWE Intern",
            "day_applied": "2025-01-10", "start_date_tbd": True,
            "company_domain": "test.com", "description": "test desc",
            "pay_amount": 50.0, "pay_period": "hourly",
            "confidence_level": "High", "status": "Applied",
        }
        r = new_user_session.post(f"{BASE_URL}/api/applications", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        created = r.json()
        assert created["company_name"] == "TEST_Corp"
        assert created["start_date_tbd"] is True
        assert "app_id" in created
        assert "_id" not in created
        app_id = created["app_id"]

        # LIST includes it
        r = new_user_session.get(f"{BASE_URL}/api/applications", timeout=30)
        assert r.status_code == 200
        assert any(a["app_id"] == app_id for a in r.json())

        # UPDATE
        payload["status"] = "Interviewing"
        payload["company_name"] = "TEST_Corp2"
        r = new_user_session.put(f"{BASE_URL}/api/applications/{app_id}", json=payload, timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "Interviewing"
        assert r.json()["company_name"] == "TEST_Corp2"

        # DELETE
        r = new_user_session.delete(f"{BASE_URL}/api/applications/{app_id}", timeout=30)
        assert r.status_code == 200

        # Confirm gone -> update returns 404
        r = new_user_session.put(f"{BASE_URL}/api/applications/{app_id}", json=payload, timeout=30)
        assert r.status_code == 404

    def test_validation_missing_required(self, new_user_session):
        r = new_user_session.post(f"{BASE_URL}/api/applications",
                                  json={"company_name": "", "job_title": "x", "day_applied": "2025-01-01"},
                                  timeout=30)
        assert r.status_code == 422

    def test_unauth_applications(self):
        r = requests.get(f"{BASE_URL}/api/applications", timeout=30)
        assert r.status_code == 401


# ---------- Private calendar ----------
class TestCalendar:
    def test_timed_event_crud_defaults_and_isolation(self, new_user_session, second_user_session):
        payload = {
            "title": "TEST_Private lecture",
            "category": "Academic",
            "all_day": False,
            "starts_at": "2026-09-14T14:00:00-05:00",
            "timezone": "America/Chicago",
            "location": "Room 201",
            "icon": "book-open",
            "image_icon": "fluent-emoji-flat:school",
            "reminder_minutes": 15,
            "sync_to_google": False,
        }
        created_response = new_user_session.post(f"{BASE_URL}/api/events", json=payload, timeout=30)
        assert created_response.status_code == 200, created_response.text
        created = created_response.json()
        event_id = created["event_id"]
        assert created["starts_at"] == "2026-09-14T19:00:00Z"
        assert created["ends_at"] == "2026-09-14T20:00:00Z"
        assert created["google_sync_status"] == "not_requested"
        assert created["image_icon"] == "fluent-emoji-flat:school"
        assert "user_id" not in created and "google_event_id" not in created

        owner = new_user_session.get(
            f"{BASE_URL}/api/events", params={"from": "2026-09-01", "to": "2026-10-01"}, timeout=30
        )
        other = second_user_session.get(
            f"{BASE_URL}/api/events", params={"from": "2026-09-01", "to": "2026-10-01"}, timeout=30
        )
        assert any(item["event_id"] == event_id for item in owner.json())
        assert all(item["event_id"] != event_id for item in other.json())

        changed = dict(payload, title="TEST_Changed", ends_at="2026-09-14T16:00:00-05:00")
        assert second_user_session.put(f"{BASE_URL}/api/events/{event_id}", json=changed, timeout=30).status_code == 404
        assert second_user_session.delete(f"{BASE_URL}/api/events/{event_id}", timeout=30).status_code == 404
        assert second_user_session.post(
            f"{BASE_URL}/api/events/{event_id}/google-sync", json={"enabled": True}, timeout=30
        ).status_code == 404

        updated = new_user_session.put(f"{BASE_URL}/api/events/{event_id}", json=changed, timeout=30)
        assert updated.status_code == 200
        assert updated.json()["title"] == "TEST_Changed"
        assert new_user_session.delete(f"{BASE_URL}/api/events/{event_id}", timeout=30).status_code == 200

    def test_all_day_event_and_validation_allowlists(self, new_user_session):
        base = {
            "title": "TEST_Deadline", "category": "Deadline", "all_day": True,
            "start_date": "2026-09-20", "timezone": "America/Chicago",
            "icon": "bell", "reminder_minutes": 1440,
        }
        created = new_user_session.post(f"{BASE_URL}/api/events", json=base, timeout=30)
        assert created.status_code == 200, created.text
        data = created.json()
        assert data["end_date"] == "2026-09-20"
        assert data["starts_at"] is None
        new_user_session.delete(f"{BASE_URL}/api/events/{data['event_id']}", timeout=30)

        for change in (
            {"category": "Secret"}, {"icon": "remote-image"},
            {"reminder_minutes": 17}, {"timezone": "Mars/Olympus"},
            {"image_icon": "unknown-set:tracking-pixel"},
            {"end_date": "2026-09-19"},
        ):
            response = new_user_session.post(f"{BASE_URL}/api/events", json={**base, **change}, timeout=30)
            assert response.status_code == 422

    def test_local_save_survives_google_sync_failure(self, new_user_session):
        payload = {
            "title": "TEST_Local first", "category": "Work", "all_day": False,
            "starts_at": "2026-09-18T10:00:00Z", "timezone": "UTC",
            "icon": "briefcase-business", "sync_to_google": True,
        }
        response = new_user_session.post(f"{BASE_URL}/api/events", json=payload, timeout=30)
        assert response.status_code == 200
        event = response.json()
        assert event["google_sync_status"] == "error"
        assert event["google_last_error"] == "google_calendar_not_connected"
        listing = new_user_session.get(f"{BASE_URL}/api/events", timeout=30).json()
        assert any(item["event_id"] == event["event_id"] for item in listing)
        new_user_session.delete(f"{BASE_URL}/api/events/{event['event_id']}", timeout=30)

    def test_application_dates_appear_in_unified_feed(self, new_user_session, second_user_session):
        payload = {
            "company_name": "TEST_Calendar Corp", "job_title": "Engineer",
            "day_applied": "2026-09-01", "start_date_tbd": True,
            "interview_date": "2026-09-22T13:30:00", "follow_up_date": "2026-09-25",
            "status": "Interviewing",
        }
        response = new_user_session.post(f"{BASE_URL}/api/applications", json=payload, timeout=30)
        assert response.status_code == 200
        app_id = response.json()["app_id"]
        feed = new_user_session.get(
            f"{BASE_URL}/api/calendar/items", params={"from": "2026-09-01", "to": "2026-10-01"}, timeout=30
        )
        assert feed.status_code == 200
        sources = {item["source"] for item in feed.json() if item.get("application_id") == app_id}
        assert sources == {"application_interview", "application_follow_up"}
        other_feed = second_user_session.get(
            f"{BASE_URL}/api/calendar/items", params={"from": "2026-09-01", "to": "2026-10-01"}, timeout=30
        )
        assert other_feed.status_code == 200
        assert all(item.get("application_id") != app_id for item in other_feed.json())
        new_user_session.delete(f"{BASE_URL}/api/applications/{app_id}", timeout=30)

    def test_calendar_oauth_is_incremental_and_offline(self, new_user_session):
        status = new_user_session.get(f"{BASE_URL}/api/integrations/google-calendar", timeout=30)
        assert status.status_code == 200
        assert status.json()["configured"] is True
        if status.json()["connected"]:
            pytest.skip("Test account already has a calendar connection")
        response = new_user_session.get(
            f"{BASE_URL}/api/integrations/google-calendar/connect",
            params={"return_to": "/calendar", "timezone": "America/Chicago"},
            allow_redirects=False,
            timeout=30,
        )
        assert response.status_code == 302
        params = parse_qs(urlparse(response.headers["location"]).query)
        assert params["access_type"] == ["offline"]
        assert params["prompt"] == ["consent select_account"]
        assert "https://www.googleapis.com/auth/calendar.app.created" in params["scope"][0]
        assert params["redirect_uri"] == [f"{OAUTH_PUBLIC_URL}/api/integrations/google-calendar/callback"]


# ---------- Bulk import & follow_up_date ----------
class TestBulkAndFollowUp:
    def test_bulk_import_rejects_more_than_free_tier_batch_limit(self, new_user_session):
        item = {
            "company_name": "TEST_TooMany", "job_title": "Role",
            "day_applied": "2026-09-10", "start_date_tbd": True, "status": "Applied",
        }
        response = new_user_session.post(
            f"{BASE_URL}/api/applications/bulk", json=[item] * 501, timeout=60,
        )
        assert response.status_code == 413

    def test_bulk_create_and_persist(self, new_user_session):
        items = [
            {"company_name": "TEST_Bulk1", "job_title": "Eng", "day_applied": "2026-08-01",
             "start_date_tbd": True, "status": "Applied", "follow_up_date": "2026-08-05"},
            {"company_name": "TEST_Bulk2", "job_title": "PM", "day_applied": "2026-07-20",
             "start_date_tbd": True, "status": "Screening", "pay_amount": 55.0, "pay_period": "hourly"},
        ]
        r = new_user_session.post(f"{BASE_URL}/api/applications/bulk", json=items, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["created"] == 2

        # Verify persistence via GET
        listing = new_user_session.get(f"{BASE_URL}/api/applications", timeout=30).json()
        companies = {a["company_name"] for a in listing}
        assert "TEST_Bulk1" in companies
        assert "TEST_Bulk2" in companies
        b1 = next(a for a in listing if a["company_name"] == "TEST_Bulk1")
        assert b1["follow_up_date"] == "2026-08-05"
        assert b1["status"] == "Applied"

        # Cleanup
        for a in listing:
            if a["company_name"].startswith("TEST_Bulk"):
                new_user_session.delete(f"{BASE_URL}/api/applications/{a['app_id']}", timeout=30)

    def test_bulk_validation_error(self, new_user_session):
        # Missing required fields -> should 422
        r = new_user_session.post(f"{BASE_URL}/api/applications/bulk",
                                  json=[{"company_name": "", "job_title": "x", "day_applied": "2026-01-01"}],
                                  timeout=30)
        assert r.status_code == 422

    def test_bulk_unauth(self):
        r = requests.post(f"{BASE_URL}/api/applications/bulk",
                          json=[{"company_name": "X", "job_title": "Y", "day_applied": "2026-01-01"}],
                          timeout=30)
        assert r.status_code == 401

    def test_demo_has_followup_dates(self, demo_session):
        apps = demo_session.get(f"{BASE_URL}/api/applications", timeout=30).json()
        fu = [a for a in apps if a.get("follow_up_date")]
        assert len(fu) >= 1, "Expected seeded apps to include follow_up_date"


# ---------- Analytics ----------
class TestAnalytics:
    def test_demo_analytics(self, demo_session):
        r = demo_session.get(f"{BASE_URL}/api/analytics", timeout=30)
        assert r.status_code == 200
        data = r.json()
        for k in ("kpis", "status_distribution", "volume", "compensation"):
            assert k in data
        assert data["kpis"]["total"] >= 10
        assert isinstance(data["status_distribution"], list)
        assert len(data["status_distribution"]) == 5
        assert isinstance(data["compensation"], list)
        assert len(data["compensation"]) > 0

    def test_analytics_reflects_new_data(self, new_user_session):
        # start baseline
        base = new_user_session.get(f"{BASE_URL}/api/analytics", timeout=30).json()
        total0 = base["kpis"]["total"]

        payload = {
            "company_name": "TEST_Analytics", "job_title": "Analyst",
            "day_applied": "2025-01-15", "start_date_tbd": True,
            "pay_amount": 100000.0, "pay_period": "yearly",
            "status": "Offer",
        }
        r = new_user_session.post(f"{BASE_URL}/api/applications", json=payload, timeout=30)
        assert r.status_code == 200
        app_id = r.json()["app_id"]

        after = new_user_session.get(f"{BASE_URL}/api/analytics", timeout=30).json()
        assert after["kpis"]["total"] == total0 + 1
        assert after["kpis"]["offers"] >= 1
        assert any(c["company"] == "TEST_Analytics" for c in after["compensation"])

        # cleanup
        new_user_session.delete(f"{BASE_URL}/api/applications/{app_id}", timeout=30)


# ---------- Application goal ----------
class TestApplicationGoal:
    def test_goal_requires_authentication_and_valid_input(self):
        assert requests.get(f"{BASE_URL}/api/application-goal", timeout=30).status_code == 401
        invalid = requests.put(
            f"{BASE_URL}/api/application-goal",
            json={"cadence": "monthly", "target": 0, "timezone": "Not/A_Zone"},
            timeout=30,
        )
        assert invalid.status_code == 401

    def test_goal_crud_progress_boundaries_and_isolation(self, new_user_session, second_user_session):
        new_user_session.delete(f"{BASE_URL}/api/application-goal", timeout=30)
        second_user_session.delete(f"{BASE_URL}/api/application-goal", timeout=30)
        created_ids = []
        zone = ZoneInfo("America/Chicago")
        today = datetime.now(zone).date()
        week_start = today - timedelta(days=today.weekday())

        try:
            initial = new_user_session.put(
                f"{BASE_URL}/api/application-goal",
                json={"cadence": "weekly", "target": 100, "timezone": "America/Chicago"},
                timeout=30,
            )
            assert initial.status_code == 200, initial.text
            initial_data = initial.json()
            baseline = initial_data["count"]
            assert initial_data["period_start"] == week_start.isoformat()
            assert initial_data["period_end"] == (week_start + timedelta(days=6)).isoformat()

            dates = [
                today,
                week_start,
                week_start - timedelta(days=1),
                today + timedelta(days=1),
            ]
            for index, applied_date in enumerate(dates):
                response = new_user_session.post(
                    f"{BASE_URL}/api/applications",
                    json={
                        "company_name": f"TEST_Goal_{index}",
                        "job_title": "Goal Test",
                        "day_applied": applied_date.isoformat(),
                        "start_date_tbd": True,
                        "status": "Applied",
                    },
                    timeout=30,
                )
                assert response.status_code == 200, response.text
                created_ids.append(response.json()["app_id"])

            progress = new_user_session.get(f"{BASE_URL}/api/application-goal", timeout=30).json()
            assert progress["count"] == baseline + 2
            assert progress["remaining"] == 100 - progress["count"]
            assert progress["complete"] is False

            bulk = new_user_session.post(
                f"{BASE_URL}/api/applications/bulk",
                json=[{
                    "company_name": "TEST_Goal_Bulk",
                    "job_title": "Imported Goal Test",
                    "day_applied": today.isoformat(),
                    "start_date_tbd": True,
                    "status": "Applied",
                }],
                timeout=30,
            )
            assert bulk.status_code == 200
            imported = next(
                application for application in new_user_session.get(
                    f"{BASE_URL}/api/applications", timeout=30
                ).json()
                if application["company_name"] == "TEST_Goal_Bulk"
            )
            created_ids.append(imported["app_id"])
            progress = new_user_session.get(f"{BASE_URL}/api/application-goal", timeout=30).json()
            assert progress["count"] == baseline + 3

            future_id = created_ids[3]
            moved_into_period = new_user_session.put(
                f"{BASE_URL}/api/applications/{future_id}",
                json={
                    "company_name": "TEST_Goal_3",
                    "job_title": "Goal Test",
                    "day_applied": today.isoformat(),
                    "start_date_tbd": True,
                    "status": "Applied",
                },
                timeout=30,
            )
            assert moved_into_period.status_code == 200
            progress = new_user_session.get(f"{BASE_URL}/api/application-goal", timeout=30).json()
            assert progress["count"] == baseline + 4

            completed = new_user_session.put(
                f"{BASE_URL}/api/application-goal",
                json={
                    "cadence": "weekly",
                    "target": max(1, progress["count"]),
                    "timezone": "America/Chicago",
                },
                timeout=30,
            ).json()
            assert completed["complete"] is True
            assert completed["remaining"] == 0
            assert completed["progress_percent"] == 100

            second = second_user_session.put(
                f"{BASE_URL}/api/application-goal",
                json={"cadence": "daily", "target": 3, "timezone": "UTC"},
                timeout=30,
            )
            assert second.status_code == 200
            assert second.json()["target"] == 3
            assert second_user_session.get(f"{BASE_URL}/api/application-goal", timeout=30).json()["cadence"] == "daily"
            assert new_user_session.get(f"{BASE_URL}/api/application-goal", timeout=30).json()["cadence"] == "weekly"

            new_user_session.delete(f"{BASE_URL}/api/applications/{created_ids[0]}", timeout=30)
            created_ids.pop(0)
            reduced = new_user_session.get(f"{BASE_URL}/api/application-goal", timeout=30).json()
            assert reduced["count"] == progress["count"] - 1

            invalid_payloads = [
                {"cadence": "monthly", "target": 5, "timezone": "UTC"},
                {"cadence": "daily", "target": 0, "timezone": "UTC"},
                {"cadence": "daily", "target": 101, "timezone": "UTC"},
                {"cadence": "daily", "target": 5, "timezone": "Not/A_Zone"},
            ]
            for payload in invalid_payloads:
                response = new_user_session.put(
                    f"{BASE_URL}/api/application-goal", json=payload, timeout=30
                )
                assert response.status_code == 422
        finally:
            for app_id in created_ids:
                new_user_session.delete(f"{BASE_URL}/api/applications/{app_id}", timeout=30)
            new_user_session.delete(f"{BASE_URL}/api/application-goal", timeout=30)
            second_user_session.delete(f"{BASE_URL}/api/application-goal", timeout=30)

        assert new_user_session.get(f"{BASE_URL}/api/application-goal", timeout=30).json() == {"configured": False}
        assert second_user_session.get(f"{BASE_URL}/api/application-goal", timeout=30).json() == {"configured": False}


# ---------- Data isolation ----------
class TestIsolation:
    def test_all_record_operations_are_user_scoped(self, new_user_session, second_user_session):
        payload = {
            "company_name": "TEST_PrivateOwner",
            "job_title": "Private Role",
            "day_applied": "2026-09-08",
            "start_date_tbd": True,
            "status": "Applied",
        }
        created = new_user_session.post(
            f"{BASE_URL}/api/applications", json=payload, timeout=30
        )
        assert created.status_code == 200
        app_id = created.json()["app_id"]

        try:
            owner_ids = {
                app["app_id"]
                for app in new_user_session.get(f"{BASE_URL}/api/applications", timeout=30).json()
            }
            other_ids = {
                app["app_id"]
                for app in second_user_session.get(f"{BASE_URL}/api/applications", timeout=30).json()
            }
            assert app_id in owner_ids
            assert app_id not in other_ids

            changed = dict(payload, company_name="TEST_Hijacked", status="Offer")
            attempts = [
                second_user_session.put(
                    f"{BASE_URL}/api/applications/{app_id}", json=changed, timeout=30
                ),
                second_user_session.post(
                    f"{BASE_URL}/api/applications/{app_id}/notes",
                    json={"text": "cross-user note"},
                    timeout=30,
                ),
                second_user_session.post(
                    f"{BASE_URL}/api/applications/{app_id}/attachments",
                    files={"file": ("private.txt", b"not allowed", "text/plain")},
                    data={"kind": "resume"},
                    timeout=30,
                ),
                second_user_session.delete(
                    f"{BASE_URL}/api/applications/{app_id}", timeout=30
                ),
            ]
            assert all(response.status_code == 404 for response in attempts)

            owner_record = next(
                app
                for app in new_user_session.get(f"{BASE_URL}/api/applications", timeout=30).json()
                if app["app_id"] == app_id
            )
            assert owner_record["company_name"] == "TEST_PrivateOwner"
            assert owner_record["status"] == "Applied"
            assert not any(
                event.get("text") == "cross-user note"
                for event in owner_record.get("activity", [])
            )
            assert owner_record.get("attachments", []) == []
        finally:
            new_user_session.delete(f"{BASE_URL}/api/applications/{app_id}", timeout=30)


# ---------- New: Notes, Activity, Interview, Month-only start ----------
class TestNotesAndActivity:
    def test_created_activity_present(self, new_user_session):
        payload = {"company_name": "TEST_Notes", "job_title": "Eng", "day_applied": "2026-01-10",
                   "start_date_tbd": True, "status": "Applied"}
        r = new_user_session.post(f"{BASE_URL}/api/applications", json=payload, timeout=30)
        assert r.status_code == 200
        created = r.json()
        assert isinstance(created.get("activity"), list)
        assert len(created["activity"]) >= 1
        assert created["activity"][0]["type"] == "created"
        app_id = created["app_id"]

        # Add note
        r = new_user_session.post(f"{BASE_URL}/api/applications/{app_id}/notes",
                                  json={"text": "First note about this app"}, timeout=30)
        assert r.status_code == 200, r.text
        doc = r.json()
        acts = doc.get("activity", [])
        notes = [a for a in acts if a.get("type") == "note"]
        assert len(notes) == 1
        assert notes[0]["text"] == "First note about this app"
        assert "at" in notes[0]

        # Add empty note -> validation error
        r = new_user_session.post(f"{BASE_URL}/api/applications/{app_id}/notes",
                                  json={"text": ""}, timeout=30)
        assert r.status_code == 422

        # Note on non-existent app -> 404
        r = new_user_session.post(f"{BASE_URL}/api/applications/nonexistent_id/notes",
                                  json={"text": "hi"}, timeout=30)
        assert r.status_code == 404

        # cleanup
        new_user_session.delete(f"{BASE_URL}/api/applications/{app_id}", timeout=30)

    def test_status_change_logs_activity(self, new_user_session):
        payload = {"company_name": "TEST_StatusEvt", "job_title": "Eng", "day_applied": "2026-01-10",
                   "start_date_tbd": True, "status": "Applied"}
        r = new_user_session.post(f"{BASE_URL}/api/applications", json=payload, timeout=30)
        app_id = r.json()["app_id"]

        # Update to Interviewing
        payload["status"] = "Interviewing"
        r = new_user_session.put(f"{BASE_URL}/api/applications/{app_id}", json=payload, timeout=30)
        assert r.status_code == 200
        doc = r.json()
        status_events = [a for a in doc.get("activity", []) if a.get("type") == "status"]
        assert len(status_events) >= 1
        last = status_events[-1]
        assert last["from"] == "Applied"
        assert last["to"] == "Interviewing"

        # Same-status update should NOT push another status event
        prev_count = len(status_events)
        r = new_user_session.put(f"{BASE_URL}/api/applications/{app_id}", json=payload, timeout=30)
        doc2 = r.json()
        new_status_events = [a for a in doc2.get("activity", []) if a.get("type") == "status"]
        assert len(new_status_events) == prev_count

        # Cleanup
        new_user_session.delete(f"{BASE_URL}/api/applications/{app_id}", timeout=30)

    def test_interview_date_and_month_only(self, new_user_session):
        payload = {
            "company_name": "TEST_Interview", "job_title": "Eng", "day_applied": "2026-01-10",
            "expected_start_date": "2027-06-01", "start_date_month_only": True,
            "start_date_tbd": False,
            "interview_date": "2026-09-15T14:00:00", "status": "Interviewing",
        }
        r = new_user_session.post(f"{BASE_URL}/api/applications", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        created = r.json()
        assert created["interview_date"] == "2026-09-15T14:00:00"
        assert created["start_date_month_only"] is True
        assert created["expected_start_date"] == "2027-06-01"

        # GET verifies persistence
        listing = new_user_session.get(f"{BASE_URL}/api/applications", timeout=30).json()
        got = next(a for a in listing if a["app_id"] == created["app_id"])
        assert got["interview_date"] == "2026-09-15T14:00:00"
        assert got["start_date_month_only"] is True

        # cleanup
        new_user_session.delete(f"{BASE_URL}/api/applications/{created['app_id']}", timeout=30)

    def test_notes_unauth(self):
        r = requests.post(f"{BASE_URL}/api/applications/whatever/notes", json={"text": "hi"}, timeout=30)
        assert r.status_code == 401

    def test_demo_seed_has_interview_and_month_only(self, demo_session):
        apps = demo_session.get(f"{BASE_URL}/api/applications", timeout=30).json()
        interviewing = [a for a in apps if a.get("status") == "Interviewing"]
        assert len(interviewing) >= 1
        with_iv = [a for a in interviewing if a.get("interview_date")]
        assert len(with_iv) >= 1, "Expected seeded Interviewing apps to have interview_date"
        month_only = [a for a in apps if a.get("start_date_month_only")]
        assert len(month_only) >= 1, "Expected seeded apps to have start_date_month_only"



# ---------- Attachments (S3-compatible object storage) ----------
class TestAttachments:
    def _make_app(self, session):
        payload = {"company_name": "TEST_Attach", "job_title": "Eng", "day_applied": "2026-02-01",
                   "start_date_tbd": True, "status": "Applied"}
        r = session.post(f"{BASE_URL}/api/applications", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        return r.json()["app_id"]

    def test_upload_download_delete_attachment(self, new_user_session):
        app_id = self._make_app(new_user_session)
        try:
            content = b"Hello resume PDF content %PDF-1.4"
            files = {"file": ("resume_TEST.pdf", content, "application/pdf")}
            data = {"kind": "resume"}
            r = new_user_session.post(
                f"{BASE_URL}/api/applications/{app_id}/attachments",
                files=files, data=data, timeout=60,
            )
            assert r.status_code == 200, r.text
            doc = r.json()
            atts = doc.get("attachments") or []
            assert len(atts) == 1
            att = atts[0]
            assert att["kind"] == "resume"
            assert att["name"] == "resume_TEST.pdf"
            assert att["size"] == len(content) or att["size"] > 0
            assert "id" in att
            assert "storage_path" not in att
            att_id = att["id"]

            # DOWNLOAD
            r = new_user_session.get(f"{BASE_URL}/api/applications/{app_id}/attachments/{att_id}", timeout=60)
            assert r.status_code == 200
            assert r.content == content
            assert "pdf" in r.headers.get("content-type", "").lower()

            # LIST reflects it
            listing = new_user_session.get(f"{BASE_URL}/api/applications", timeout=30).json()
            got = next(a for a in listing if a["app_id"] == app_id)
            assert len(got.get("attachments", [])) == 1

            # DELETE
            r = new_user_session.delete(f"{BASE_URL}/api/applications/{app_id}/attachments/{att_id}", timeout=30)
            assert r.status_code == 200
            assert r.json().get("attachments", []) == []

            # download after delete -> 404
            r = new_user_session.get(f"{BASE_URL}/api/applications/{app_id}/attachments/{att_id}", timeout=30)
            assert r.status_code == 404
        finally:
            new_user_session.delete(f"{BASE_URL}/api/applications/{app_id}", timeout=30)

    def test_multi_kind_upload(self, new_user_session):
        app_id = self._make_app(new_user_session)
        try:
            for kind, name, ct in [
                ("resume", "resume_TEST.txt", "text/plain"),
                ("job_description", "jd_TEST.txt", "text/plain"),
            ]:
                r = new_user_session.post(
                    f"{BASE_URL}/api/applications/{app_id}/attachments",
                    files={"file": (name, b"file body " + kind.encode(), ct)},
                    data={"kind": kind}, timeout=60,
                )
                assert r.status_code == 200, r.text
            doc = new_user_session.get(f"{BASE_URL}/api/applications", timeout=30).json()
            got = next(a for a in doc if a["app_id"] == app_id)
            kinds = sorted([a["kind"] for a in got.get("attachments", [])])
            assert kinds == ["job_description", "resume"]
        finally:
            new_user_session.delete(f"{BASE_URL}/api/applications/{app_id}", timeout=30)

    def test_attachment_per_user_isolation(self, new_user_session, demo_session):
        # Create app on new_user, attach a file
        app_id = self._make_app(new_user_session)
        try:
            r = new_user_session.post(
                f"{BASE_URL}/api/applications/{app_id}/attachments",
                files={"file": ("secret_TEST.txt", b"top-secret", "text/plain")},
                data={"kind": "resume"}, timeout=60,
            )
            assert r.status_code == 200
            att_id = r.json()["attachments"][0]["id"]

            # demo user cannot upload to new_user's app
            r = demo_session.post(
                f"{BASE_URL}/api/applications/{app_id}/attachments",
                files={"file": ("x_TEST.txt", b"x", "text/plain")},
                data={"kind": "resume"}, timeout=60,
            )
            assert r.status_code == 404

            # demo user cannot download
            r = demo_session.get(f"{BASE_URL}/api/applications/{app_id}/attachments/{att_id}", timeout=30)
            assert r.status_code == 404

            # demo user cannot delete
            r = demo_session.delete(f"{BASE_URL}/api/applications/{app_id}/attachments/{att_id}", timeout=30)
            assert r.status_code == 404
        finally:
            new_user_session.delete(f"{BASE_URL}/api/applications/{app_id}", timeout=30)

    def test_upload_unauth(self):
        r = requests.post(
            f"{BASE_URL}/api/applications/anything/attachments",
            files={"file": ("x.txt", b"x", "text/plain")}, data={"kind": "resume"}, timeout=30,
        )
        assert r.status_code == 401

    def test_upload_on_missing_app_returns_404(self, new_user_session):
        r = new_user_session.post(
            f"{BASE_URL}/api/applications/nonexistent_app_id/attachments",
            files={"file": ("x_TEST.txt", b"x", "text/plain")}, data={"kind": "resume"}, timeout=30,
        )
        assert r.status_code == 404


# ---------- User model exposes picture ----------
class TestUserPicture:
    def test_me_returns_picture_field(self, demo_session):
        me = demo_session.get(f"{BASE_URL}/api/auth/me", timeout=30).json()
        # picture key should exist (may be None for email users)
        assert "picture" in me
        assert "name" in me


# ---------- Skills & experience library ----------
class TestSkillsExperienceLibrary:
    def test_crud_evidence_counts_and_user_isolation(self, new_user_session, second_user_session):
        suffix = uuid.uuid4().hex[:8]
        skill_payload = {
            "name": f"Python {suffix}",
            "category": "Technical",
            "level": "Strong",
            "notes": "Used for data tooling and APIs",
        }
        created_skill = new_user_session.post(
            f"{BASE_URL}/api/library/skills", json=skill_payload, timeout=30,
        )
        assert created_skill.status_code == 200, created_skill.text
        skill = created_skill.json()
        skill_id = skill["skill_id"]
        assert skill["evidence_count"] == 0
        assert "user_id" not in skill

        duplicate = new_user_session.post(
            f"{BASE_URL}/api/library/skills",
            json={**skill_payload, "name": skill_payload["name"].upper()},
            timeout=30,
        )
        assert duplicate.status_code == 409

        experience_payload = {
            "type": "Project",
            "title": f"Portfolio analyzer {suffix}",
            "organization": "Personal project",
            "start_date": "2026-01-01",
            "end_date": "2026-04-01",
            "current": False,
            "description": "Built a private analysis workflow.",
            "resume_bullet": "Built an analysis workflow that reduced review time by 40%.",
            "outcome": "Reduced review time by 40%",
            "link": "https://example.com/project",
            "skill_ids": [skill_id],
        }
        created_experience = new_user_session.post(
            f"{BASE_URL}/api/library/experiences", json=experience_payload, timeout=30,
        )
        assert created_experience.status_code == 200, created_experience.text
        experience = created_experience.json()
        experience_id = experience["experience_id"]
        assert experience["skill_ids"] == [skill_id]
        assert "user_id" not in experience

        library = new_user_session.get(f"{BASE_URL}/api/library", timeout=30)
        assert library.status_code == 200
        data = library.json()
        returned_skill = next(item for item in data["skills"] if item["skill_id"] == skill_id)
        assert returned_skill["evidence_count"] == 1
        assert data["summary"]["evidenced_skill_count"] >= 1

        other_library = second_user_session.get(f"{BASE_URL}/api/library", timeout=30)
        assert other_library.status_code == 200
        assert all(item["skill_id"] != skill_id for item in other_library.json()["skills"])
        assert all(item["experience_id"] != experience_id for item in other_library.json()["experiences"])

        assert second_user_session.put(
            f"{BASE_URL}/api/library/skills/{skill_id}", json=skill_payload, timeout=30,
        ).status_code == 404
        assert second_user_session.delete(
            f"{BASE_URL}/api/library/experiences/{experience_id}", timeout=30,
        ).status_code == 404

        updated = new_user_session.put(
            f"{BASE_URL}/api/library/experiences/{experience_id}",
            json={**experience_payload, "current": True, "end_date": None, "outcome": "Shipped to users"},
            timeout=30,
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["current"] is True
        assert updated.json()["end_date"] is None
        assert updated.json()["outcome"] == "Shipped to users"

        removed_skill = new_user_session.delete(
            f"{BASE_URL}/api/library/skills/{skill_id}", timeout=30,
        )
        assert removed_skill.status_code == 200
        library_after_unlink = new_user_session.get(f"{BASE_URL}/api/library", timeout=30).json()
        returned_experience = next(
            item for item in library_after_unlink["experiences"] if item["experience_id"] == experience_id
        )
        assert returned_experience["skill_ids"] == []

        deleted = new_user_session.delete(
            f"{BASE_URL}/api/library/experiences/{experience_id}", timeout=30,
        )
        assert deleted.status_code == 200
        assert new_user_session.delete(
            f"{BASE_URL}/api/library/experiences/{experience_id}", timeout=30,
        ).status_code == 404

    def test_validation_and_authentication(self, new_user_session):
        invalid_skill = new_user_session.post(
            f"{BASE_URL}/api/library/skills",
            json={"name": "", "category": "Unknown", "level": "Impossible"},
            timeout=30,
        )
        assert invalid_skill.status_code == 422

        invalid_experience = new_user_session.post(
            f"{BASE_URL}/api/library/experiences",
            json={
                "type": "Project", "title": "Invalid link", "link": "javascript:alert(1)",
                "skill_ids": ["skill_not_owned"],
            },
            timeout=30,
        )
        assert invalid_experience.status_code == 422
        assert requests.get(f"{BASE_URL}/api/library", timeout=30).status_code == 401

    def test_personal_accomplishment_record(self, new_user_session):
        created = new_user_session.post(
            f"{BASE_URL}/api/library/experiences",
            json={
                "type": "Accomplishment",
                "title": "Won a student hackathon",
                "start_date": "2026-03-01",
                "description": "Built and presented a working prototype.",
                "outcome": "Selected as the winning project",
                "skill_ids": [],
            },
            timeout=30,
        )
        assert created.status_code == 200, created.text
        record = created.json()
        assert record["type"] == "Accomplishment"
        assert record["current"] is False
        try:
            library = new_user_session.get(f"{BASE_URL}/api/library", timeout=30).json()
            assert any(item["experience_id"] == record["experience_id"] for item in library["experiences"])
        finally:
            new_user_session.delete(
                f"{BASE_URL}/api/library/experiences/{record['experience_id']}", timeout=30,
            )

    def test_custom_showcase_order_and_isolation(self, new_user_session, second_user_session):
        suffix = uuid.uuid4().hex[:8]
        skill_ids = []
        experience_ids = []
        try:
            for name in (f"Leadership {suffix}", f"Research {suffix}"):
                response = new_user_session.post(
                    f"{BASE_URL}/api/library/skills",
                    json={"name": name, "category": "Leadership", "level": "Strong"},
                    timeout=30,
                )
                assert response.status_code == 200, response.text
                skill_ids.append(response.json()["skill_id"])
            for record_type, title in (("Work", f"Internship {suffix}"), ("Project", f"Project {suffix}")):
                response = new_user_session.post(
                    f"{BASE_URL}/api/library/experiences",
                    json={"type": record_type, "title": title, "skill_ids": []},
                    timeout=30,
                )
                assert response.status_code == 200, response.text
                experience_ids.append(response.json()["experience_id"])

            payload = {
                "skill_ids": [skill_ids[1], skill_ids[0], None],
                "experience_ids": [experience_ids[0], None, None],
                "project_ids": [None, experience_ids[1], None],
            }
            updated = new_user_session.put(
                f"{BASE_URL}/api/library/showcase", json=payload, timeout=30,
            )
            assert updated.status_code == 200, updated.text
            library = new_user_session.get(f"{BASE_URL}/api/library", timeout=30).json()
            skill_ranks = {item["skill_id"]: item.get("showcase_rank") for item in library["skills"]}
            record_ranks = {item["experience_id"]: item.get("showcase_rank") for item in library["experiences"]}
            assert skill_ranks[skill_ids[1]] == 1
            assert skill_ranks[skill_ids[0]] == 2
            assert record_ranks[experience_ids[0]] == 1
            assert record_ranks[experience_ids[1]] == 2

            cross_user = second_user_session.put(
                f"{BASE_URL}/api/library/showcase",
                json={"skill_ids": [skill_ids[0]], "experience_ids": [], "project_ids": []},
                timeout=30,
            )
            assert cross_user.status_code == 404

            duplicate = new_user_session.put(
                f"{BASE_URL}/api/library/showcase",
                json={"skill_ids": [skill_ids[0], skill_ids[0]], "experience_ids": [], "project_ids": []},
                timeout=30,
            )
            assert duplicate.status_code == 422
        finally:
            for experience_id in experience_ids:
                new_user_session.delete(f"{BASE_URL}/api/library/experiences/{experience_id}", timeout=30)
            for skill_id in skill_ids:
                new_user_session.delete(f"{BASE_URL}/api/library/skills/{skill_id}", timeout=30)
