"""Backend API tests for CareerTrack."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
# Fallback: frontend .env has REACT_APP_BACKEND_URL, but pytest env might not
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

DEMO_EMAIL = "demo@careertrack.com"
DEMO_PASSWORD = "demo1234"


@pytest.fixture(scope="module")
def demo_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


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


# ---------- Auth ----------
class TestAuth:
    def test_login_success(self, demo_session):
        r = demo_session.get(f"{BASE_URL}/api/auth/me", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["email"] == DEMO_EMAIL
        assert "user_id" in data
        assert data["auth_provider"] == "email"

    def test_login_invalid(self):
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": DEMO_EMAIL, "password": "wrong"}, timeout=30)
        assert r.status_code == 401

    def test_register_and_me(self, new_user_session):
        r = new_user_session.get(f"{BASE_URL}/api/auth/me", timeout=30)
        assert r.status_code == 200
        assert r.json()["email"] == new_user_session._email

    def test_register_duplicate_email(self, new_user_session):
        r = requests.post(f"{BASE_URL}/api/auth/register",
                          json={"email": new_user_session._email, "password": "password123", "name": "Dup"},
                          timeout=30)
        assert r.status_code == 400

    def test_me_unauthenticated(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", timeout=30)
        assert r.status_code == 401

    def test_logout(self):
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/login",
                   json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}, timeout=30)
        assert r.status_code == 200
        r = s.post(f"{BASE_URL}/api/auth/logout", timeout=30)
        assert r.status_code == 200
        r = s.get(f"{BASE_URL}/api/auth/me", timeout=30)
        assert r.status_code == 401


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


# ---------- Bulk import & follow_up_date ----------
class TestBulkAndFollowUp:
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


# ---------- Data isolation ----------
class TestIsolation:
    def test_user_scope(self, new_user_session, demo_session):
        # new user should have 0 apps
        r = new_user_session.get(f"{BASE_URL}/api/applications", timeout=30)
        my_apps = r.json()
        # get demo's app_ids
        demo_apps = demo_session.get(f"{BASE_URL}/api/applications", timeout=30).json()
        demo_ids = {a["app_id"] for a in demo_apps}
        my_ids = {a["app_id"] for a in my_apps}
        assert demo_ids.isdisjoint(my_ids)

        # new user cannot delete demo's app
        if demo_apps:
            r = new_user_session.delete(f"{BASE_URL}/api/applications/{demo_apps[0]['app_id']}", timeout=30)
            assert r.status_code == 404
