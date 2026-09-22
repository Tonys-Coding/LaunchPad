"""Unit tests for Calendar validation, encryption, and idempotent Google mapping."""
import asyncio
import os
from datetime import datetime, timedelta
from pathlib import Path
import sys
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "launchpad_unit")
os.environ.setdefault("GOOGLE_CALENDAR_TOKEN_KEY", "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: E402
from flyer_extract import extract_event_fields  # noqa: E402


def test_application_goal_validation_and_period_boundaries():
    goal = server.ApplicationGoalInput(
        cadence="weekly", target=8, timezone=" America/Chicago ",
    )
    assert goal.timezone == "America/Chicago"

    fixed = datetime(2026, 9, 9, 18, 0, tzinfo=ZoneInfo("UTC"))
    today, start, end = server.application_goal_period("weekly", goal.timezone, fixed)
    assert today.isoformat() == "2026-09-09"
    assert start.isoformat() == "2026-09-07"
    assert end.isoformat() == "2026-09-13"

    today, start, end = server.application_goal_period("daily", goal.timezone, fixed)
    assert today == start == end

    with pytest.raises(ValueError):
        server.ApplicationGoalInput(cadence="weekly", target=0, timezone="UTC")
    with pytest.raises(ValueError):
        server.ApplicationGoalInput(cadence="monthly", target=5, timezone="UTC")
    with pytest.raises(ValueError):
        server.ApplicationGoalInput(cadence="daily", target=5, timezone="Not/A_Zone")


def test_event_validation_defaults_and_encryption():
    event = server.EventInput(
        title=" Lecture ", category="Academic", all_day=False,
        starts_at="2026-09-14T14:00:00-05:00", timezone="America/Chicago",
        icon="book-open", reminder_minutes=15, source_url="https://example.edu/lecture",
        organizer=" Computer Science Club ",
    )
    assert event.title == "Lecture"
    assert event.organizer == "Computer Science Club"
    assert event.ends_at - event.starts_at == timedelta(hours=1)
    assert event.source_url == "https://example.edu/lecture"
    assert server.EventInput(
        title="School", category="Academic", all_day=True,
        start_date="2026-09-14", timezone="UTC", image_icon="noto:school",
    ).image_icon == "noto:school"
    ciphertext = server.encrypt_refresh_token("refresh-token")
    assert "refresh-token" not in ciphertext
    assert server.decrypt_refresh_token(ciphertext) == "refresh-token"


def test_flyer_text_extracts_reviewable_event_fields():
    result = extract_event_fields(
        """FALL TECHNOLOGY CAREER FAIR
        Thursday, September 17, 2026
        4:30 PM - 7:00 PM
        Location: Student Union Grand Hall
        Meet employers from across the region
        Register at careers.example.edu""",
        timezone_name="America/Chicago",
        source_url="https://example.edu/career-fair",
        now=datetime(2026, 9, 9, 9, 0, tzinfo=ZoneInfo("America/Chicago")),
    )
    fields = result["fields"]
    assert fields["category"] == "Career Fair"
    assert fields["start_date"] == "2026-09-17"
    assert fields["start_time"] == "16:30"
    assert fields["end_time"] == "19:00"
    assert fields["location"] == "Student Union Grand Hall"
    assert fields["source_url"] == "https://example.edu/career-fair"
    assert fields["all_day"] is False


def test_flyer_without_time_is_flagged_for_review():
    result = extract_event_fields(
        "Scholarship application deadline\nOctober 2, 2026\nSubmit through the student portal",
        timezone_name="America/Chicago",
        now=datetime(2026, 9, 9, 9, 0, tzinfo=ZoneInfo("America/Chicago")),
    )
    assert result["fields"]["category"] == "Deadline"
    assert result["fields"]["all_day"] is True
    assert any("No time was found" in warning for warning in result["warnings"])


def test_stylized_multiline_flyer_uses_layout_room_code_and_shared_meridiem():
    text = """W^2C
    Fron Canhpus to
    Career
    Unlocking Early Teeh
    Opportunities
    Wednesday, September 9th
    7.00 - 8:00 PM
    SCI 2.230"""
    line_hints = [
        {"text": "W^2C", "top": 8, "bottom": 30, "height": 22, "confidence": 55},
        {"text": "Fron Canhpus to", "top": 70, "bottom": 125, "height": 55, "confidence": 76},
        {"text": "Career", "top": 130, "bottom": 178, "height": 48, "confidence": 68},
        {"text": "Unlocking Early Teeh", "top": 185, "bottom": 240, "height": 55, "confidence": 80},
        {"text": "Opportunities", "top": 245, "bottom": 298, "height": 53, "confidence": 70},
        {"text": "Wednesday, September 9th", "top": 525, "bottom": 565, "height": 40, "confidence": 80},
        {"text": "7.00 - 8:00 PM", "top": 580, "bottom": 620, "height": 40, "confidence": 90},
        {"text": "SCI 2.230", "top": 650, "bottom": 690, "height": 40, "confidence": 90},
    ]
    result = extract_event_fields(
        text,
        timezone_name="America/Chicago",
        now=datetime(2026, 9, 9, 9, 0, tzinfo=ZoneInfo("America/Chicago")),
        line_hints=line_hints,
        image_height=780,
    )
    fields = result["fields"]
    assert fields["title"] == "From Campus to Career Unlocking Early Tech Opportunities"
    assert fields["category"] == "Job Search"
    assert fields["start_date"] == "2026-09-09"
    assert fields["start_time"] == "19:00"
    assert fields["end_time"] == "20:00"
    assert fields["location"] == "SCI 2.230"


def test_google_event_body_uses_exclusive_all_day_end_and_private_metadata():
    body = server.google_event_body({
        "event_id": "evt_1", "title": "Deadline", "description": None,
        "organizer": "W²C", "location": None, "all_day": True, "start_date": "2026-09-20",
        "end_date": "2026-09-22", "reminder_minutes": 1440,
    }, "lp12345")
    assert body["start"] == {"date": "2026-09-20"}
    assert body["end"] == {"date": "2026-09-23"}
    assert body["visibility"] == "private"
    assert body["description"].startswith("Organized by: W²C")
    assert body["extendedProperties"]["private"]["launchpad_event_id"] == "evt_1"
    assert body["reminders"]["overrides"] == [{"method": "popup", "minutes": 1440}]


def test_ai_flyer_fields_are_allowlisted_and_validated():
    fields = server.validate_ai_flyer_fields({
        "title": " From Campus to Career ",
        "organizer": " W²C ",
        "category": "Job Search",
        "all_day": False,
        "start_date": "2026-09-09",
        "end_date": "not-a-date",
        "start_time": "19:00",
        "end_time": "20:00",
        "location": " SCI 2.230 ",
        "description": "Early tech opportunities",
        "unexpected": "never returned",
    }, "America/Chicago", "https://example.edu/flyer")
    assert fields == {
        "timezone": "America/Chicago",
        "category": "Job Search",
        "title": "From Campus to Career",
        "organizer": "W²C",
        "location": "SCI 2.230",
        "description": "Early tech opportunities",
        "start_date": "2026-09-09",
        "end_date": "2026-09-09",
        "all_day": False,
        "start_time": "19:00",
        "end_time": "20:00",
        "source_url": "https://example.edu/flyer",
    }


def test_application_capture_builds_local_draft_and_ignores_job_board_domain():
    result = server.extract_application_fields(
        """Northstar Labs
        Software Engineering Intern
        Build Python services for our data platform
        Chicago, IL
        $28 per hour""",
        "https://www.linkedin.com/jobs/view/123",
    )
    fields = result["fields"]
    assert fields["company_name"] == "Northstar Labs"
    assert fields["job_title"] == "Software Engineering Intern"
    assert fields["pay_amount"] == 28
    assert fields["pay_period"] == "hourly"
    assert "company_domain" not in fields
    assert "Software Engineering Intern" in fields["description"]


def test_ai_application_fields_are_allowlisted_and_validated():
    fields = server.validate_ai_application_fields({
        "company_name": " Northstar Labs ",
        "job_title": " Platform Engineering Intern ",
        "company_domain": "https://www.northstar.example/careers",
        "expected_start_date": "2027-06-01",
        "start_date_tbd": True,
        "pay_amount": 32,
        "pay_period": "hourly",
        "description": "Hybrid in Chicago",
        "status": "Offer",
        "unexpected": "never returned",
    }, "https://www.linkedin.com/jobs/view/123")
    assert fields == {
        "company_name": "Northstar Labs",
        "job_title": "Platform Engineering Intern",
        "company_domain": "northstar.example",
        "expected_start_date": "2027-06-01",
        "start_date_tbd": False,
        "pay_amount": 32.0,
        "pay_period": "hourly",
        "description": "Hybrid in Chicago",
    }


def test_application_page_capture_input_bounds_page_data():
    capture = server.ApplicationPageCaptureInput(
        source_url="https://jobs.example.com/roles/123",
        page_text="Software Engineering Intern at Northstar Labs",
        structured_fields={"company_name": "Northstar Labs"},
        timezone="America/Chicago",
    )
    assert capture.timezone == "America/Chicago"
    with pytest.raises(ValueError):
        server.ApplicationPageCaptureInput(
            page_text="A readable job listing",
            structured_fields={},
            timezone="Not/A_Zone",
        )
    with pytest.raises(ValueError):
        server.ApplicationPageCaptureInput(
            page_text="A readable job listing",
            structured_fields={"description": "x" * 10001},
            timezone="UTC",
        )


def test_gemini_flyer_request_uses_configured_flash_lite_and_structured_output(monkeypatch):
    captured = {}

    class FakeResponse:
        status_code = 200

        @staticmethod
        def json():
            return {
                "candidates": [{"content": {"parts": [{"text": '{"title":"Career Night","organizer":"W²C"}'}]}}],
                "usageMetadata": {"promptTokenCount": 100, "candidatesTokenCount": 20},
            }

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def post(self, url, **kwargs):
            captured.update({"url": url, **kwargs})
            return FakeResponse()

    monkeypatch.setattr(server.httpx, "AsyncClient", lambda **_: FakeClient())
    parsed, usage = asyncio.run(server.improve_flyer_with_gemini(
        b"image", "image/png", "America/Chicago", "Career Night",
    ))
    assert parsed["organizer"] == "W²C"
    assert usage["promptTokenCount"] == 100
    assert f"/{server.GEMINI_MODEL}:generateContent" in captured["url"]
    config = captured["json"]["generationConfig"]
    assert config["responseMimeType"] == "application/json"
    assert config["thinkingConfig"] == {"thinkingLevel": "MINIMAL"}
    assert config["maxOutputTokens"] == 700


def test_gemini_application_request_uses_structured_output(monkeypatch):
    captured = {}

    class FakeResponse:
        status_code = 200

        @staticmethod
        def json():
            return {
                "candidates": [{"content": {"parts": [{"text": '{"company_name":"Northstar Labs","job_title":"Engineering Intern"}'}]}}],
                "usageMetadata": {"promptTokenCount": 120, "candidatesTokenCount": 24},
            }

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def post(self, url, **kwargs):
            captured.update({"url": url, **kwargs})
            return FakeResponse()

    monkeypatch.setattr(server.httpx, "AsyncClient", lambda **_: FakeClient())
    parsed, usage = asyncio.run(server.improve_application_with_gemini(
        b"image", "image/png", "America/Chicago", "Engineering Intern", "https://example.com/jobs/1",
    ))
    assert parsed["company_name"] == "Northstar Labs"
    assert usage["promptTokenCount"] == 120
    config = captured["json"]["generationConfig"]
    assert config["responseJsonSchema"] == server.AI_APPLICATION_SCHEMA
    assert config["thinkingConfig"] == {"thinkingLevel": "MINIMAL"}
    assert config["maxOutputTokens"] == 900


def test_gemini_application_page_request_is_text_only_and_structured(monkeypatch):
    captured = {}

    class FakeResponse:
        status_code = 200

        @staticmethod
        def json():
            return {
                "candidates": [{"content": {"parts": [{"text": '{"company_name":"Northstar Labs","job_title":"Engineering Intern"}'}]}}],
                "usageMetadata": {"promptTokenCount": 80, "candidatesTokenCount": 20},
            }

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def post(self, url, **kwargs):
            captured.update({"url": url, **kwargs})
            return FakeResponse()

    monkeypatch.setattr(server.httpx, "AsyncClient", lambda **_: FakeClient())
    parsed, usage = asyncio.run(server.improve_application_page_with_gemini(
        "Engineering Intern at Northstar Labs",
        {"company_name": "Northstar Labs"},
        "America/Chicago",
        "https://jobs.example.com/roles/123",
    ))
    assert parsed["job_title"] == "Engineering Intern"
    assert usage["promptTokenCount"] == 80
    parts = captured["json"]["contents"][0]["parts"]
    assert len(parts) == 1
    assert "inlineData" not in parts[0]
    assert "Structured browser data" in parts[0]["text"]
    assert captured["json"]["generationConfig"]["responseJsonSchema"] == server.AI_APPLICATION_SCHEMA


class FakeCollection:
    def __init__(self, record):
        self.record = record

    async def find_one(self, query):
        if all(self.record.get(key) == value for key, value in query.items()):
            return dict(self.record)
        return None

    async def update_one(self, query, update):
        if all(self.record.get(key) == value for key, value in query.items()):
            self.record.update(update.get("$set", {}))


def test_google_sync_retries_without_creating_duplicates(monkeypatch):
    user = {"user_id": "user_1"}
    event = {
        "user_id": "user_1", "event_id": "evt_1", "title": "Interview",
        "description": None, "location": None, "all_day": False,
        "starts_at": "2026-09-18T15:00:00Z", "ends_at": "2026-09-18T16:00:00Z",
        "timezone": "America/Chicago", "reminder_minutes": 30,
    }
    connection = {
        "user_id": "user_1", "calendar_id": "launchpad@example.com",
        "refresh_token_ciphertext": "unused-in-mock",
    }
    fake_events = FakeCollection(event)
    fake_connections = FakeCollection(connection)
    monkeypatch.setattr(server, "db", SimpleNamespace(
        events=fake_events, google_calendar_connections=fake_connections,
    ))
    calls = []

    async def first_google_api(connection_doc, method, path, **kwargs):
        calls.append((method, path, kwargs.get("body", {}).get("id")))
        if method == "PUT":
            return 404, {}
        return 201, {"htmlLink": "https://calendar.google.com/event"}

    monkeypatch.setattr(server, "google_api", first_google_api)
    first = asyncio.run(server.sync_event_to_google(user, event))
    google_id = first["google_event_id"]
    assert [call[0] for call in calls] == ["PUT", "POST"]
    assert calls[0][2] == calls[1][2] == google_id

    calls.clear()

    async def retry_google_api(connection_doc, method, path, **kwargs):
        calls.append((method, path, kwargs.get("body", {}).get("id")))
        return 200, {"htmlLink": "https://calendar.google.com/event"}

    monkeypatch.setattr(server, "google_api", retry_google_api)
    second = asyncio.run(server.sync_event_to_google(user, first))
    assert second["google_event_id"] == google_id
    assert len(calls) == 1 and calls[0][0] == "PUT"


def test_expired_google_token_marks_connection_for_reauthorization(monkeypatch):
    connection = {
        "user_id": "user_1",
        "calendar_id": "launchpad@example.com",
        "refresh_token_ciphertext": "encrypted",
        "email": "student@example.com",
    }
    fake_connections = FakeCollection(connection)
    monkeypatch.setattr(server, "db", SimpleNamespace(google_calendar_connections=fake_connections))
    monkeypatch.setattr(server, "decrypt_refresh_token", lambda _: "refresh-token")

    class FakeResponse:
        status_code = 400

        def json(self):
            return {"error": "invalid_grant"}

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def post(self, *_args, **_kwargs):
            return FakeResponse()

    monkeypatch.setattr(server.httpx, "AsyncClient", lambda **_: FakeClient())

    with pytest.raises(server.CalendarSyncError, match="google_reauthorization_required"):
        asyncio.run(server.google_access_token(connection))

    assert fake_connections.record["reauthorization_required"] is True
    public = server.integration_to_public(fake_connections.record)
    assert public["connected"] is False
    assert public["has_connection"] is True
    assert public["requires_reauthorization"] is True
