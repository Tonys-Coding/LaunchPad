"""Local OCR and conservative event-field extraction for flyer screenshots."""

from __future__ import annotations

from datetime import datetime, timedelta
from io import BytesIO
import re
from zoneinfo import ZoneInfo

import dateparser
from PIL import Image, ImageOps, UnidentifiedImageError
import pytesseract
from pytesseract import Output


MAX_IMAGE_PIXELS = 30_000_000
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS

MONTH = r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?(?:\s+)"
WEEKDAY = r"(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\.?,?\s+"
DATE_PATTERNS = [
    re.compile(rf"\b(?:{WEEKDAY})?{MONTH}\d{{1,2}}(?:st|nd|rd|th)?(?:,?\s+\d{{2,4}})?\b", re.I),
    re.compile(rf"\b\d{{1,2}}(?:st|nd|rd|th)?\s+{MONTH}(?:\d{{2,4}})?\b", re.I),
    re.compile(r"\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b"),
    re.compile(r"\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b"),
]
TIME_TOKEN = re.compile(
    r"(?<![\d:.])((?:1[0-2]|0?[1-9])(?:[:.][0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?)|(?:[01]?\d|2[0-3])[:.][0-5]\d)(?!\d)",
    re.I,
)
SHARED_SUFFIX_RANGE = re.compile(
    r"(?<!\d)(1[0-2]|0?[1-9])(?:[:.]([0-5]\d))?\s*(?:-|–|—|to)\s*(1[0-2]|0?[1-9])(?:[:.]([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)",
    re.I,
)
LOCATION_PREFIX = re.compile(r"^(?:location|where|venue|place|address)\s*[:\-]\s*(.+)$", re.I)
ADDRESS_HINT = re.compile(r"\b(?:room|building|hall|auditorium|library|center|centre|street|st\.|avenue|ave\.|road|rd\.|boulevard|blvd\.|suite|online|virtual|zoom)\b", re.I)
ROOM_CODE = re.compile(r"\b[A-Z]{2,8}\s*\d{1,4}(?:[.\-]\d{1,4})+\b")
URL_PATTERN = re.compile(r"https?://\S+|www\.\S+", re.I)

CATEGORY_KEYWORDS = [
    ("Career Fair", ("career fair", "job fair", "employer fair", "recruiting fair")),
    ("Interview", ("interview", "recruiter screen", "hiring manager")),
    ("Deadline", ("deadline", "due date", "submission due", "applications close", "last day to apply")),
    ("Job Search", ("job search", "resume", "résumé", "networking", "recruiting", "career workshop", "hiring event", "career opportunities", "early career")),
    ("Academic", ("lecture", "exam", "midterm", "final exam", "class", "course", "study", "academic", "university", "college", "student")),
    ("Work", ("workshop", "conference", "webinar", "meeting", "office", "team", "work")),
    ("Personal", ("birthday", "anniversary", "appointment", "party", "personal", "family")),
]


class FlyerImageError(ValueError):
    """Raised when a flyer image cannot be safely decoded or read."""


def _prepare_image(data: bytes) -> tuple[Image.Image, Image.Image]:
    try:
        with Image.open(BytesIO(data)) as candidate:
            candidate.verify()
        with Image.open(BytesIO(data)) as candidate:
            width, height = candidate.size
            if width * height > MAX_IMAGE_PIXELS:
                raise FlyerImageError("Image dimensions are too large")
            image = candidate.convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise FlyerImageError("The uploaded file is not a readable image") from exc

    longest = max(image.size)
    if longest < 1600:
        scale = min(2.5, 1600 / max(longest, 1))
        image = image.resize(
            (round(image.width * scale), round(image.height * scale)),
            Image.Resampling.LANCZOS,
        )
    elif longest > 3200:
        image.thumbnail((3200, 3200), Image.Resampling.LANCZOS)
    return image, ImageOps.autocontrast(ImageOps.grayscale(image))


def _ocr_document(image: Image.Image, psm: int) -> dict:
    data = pytesseract.image_to_data(
        image, lang="eng", config=f"--oem 1 --psm {psm}", output_type=Output.DICT
    )
    grouped: dict[tuple[int, int, int], dict] = {}
    for index, value in enumerate(data["text"]):
        word = value.strip()
        if not word:
            continue
        key = (data["block_num"][index], data["par_num"][index], data["line_num"][index])
        line = grouped.setdefault(key, {
            "words": [], "left": image.width, "top": image.height,
            "right": 0, "bottom": 0, "confidences": [],
        })
        line["words"].append(word)
        line["left"] = min(line["left"], data["left"][index])
        line["top"] = min(line["top"], data["top"][index])
        line["right"] = max(line["right"], data["left"][index] + data["width"][index])
        line["bottom"] = max(line["bottom"], data["top"][index] + data["height"][index])
        confidence = float(data["conf"][index])
        if confidence >= 0:
            line["confidences"].append(confidence)

    lines = []
    for line in grouped.values():
        text = " ".join(line.pop("words"))
        confidences = line.pop("confidences")
        line.update({
            "text": text,
            "width": line["right"] - line["left"],
            "height": line["bottom"] - line["top"],
            "confidence": sum(confidences) / len(confidences) if confidences else 0,
        })
        lines.append(line)
    lines.sort(key=lambda item: (item["top"], item["left"]))
    text = "\n".join(line["text"] for line in lines)
    score = sum(
        len(re.sub(r"\W", "", line["text"])) * max(line["confidence"], 10) / 100
        for line in lines
    )
    return {"text": text, "lines": lines, "width": image.width, "height": image.height, "score": score}


def ocr_flyer_document(data: bytes) -> dict:
    """Run complementary OCR layouts and keep the clearest structured result."""
    color, grayscale = _prepare_image(data)
    documents = [_ocr_document(color, 3), _ocr_document(grayscale, 6)]
    return max(documents, key=lambda document: document["score"])


def ocr_flyer(data: bytes) -> str:
    """Compatibility wrapper for callers that only need text."""
    return ocr_flyer_document(data)["text"].strip()


def _normalized_lines(text: str) -> list[str]:
    return [
        re.sub(r"\s+", " ", line).strip(" |•")
        for line in text.replace("\u2019", "'").splitlines()
        if re.sub(r"\s+", " ", line).strip(" |•")
    ]


def _parse_date(text: str, timezone_name: str, relative_base: datetime) -> datetime | None:
    matches: list[tuple[int, str]] = []
    for pattern in DATE_PATTERNS:
        matches.extend((match.start(), match.group(0)) for match in pattern.finditer(text))
    for _, candidate in sorted(matches):
        parsed = dateparser.parse(candidate, settings={
            "DATE_ORDER": "MDY",
            "PREFER_DATES_FROM": "current_period",
            "RELATIVE_BASE": relative_base.replace(tzinfo=None),
            "RETURN_AS_TIMEZONE_AWARE": False,
        })
        if parsed:
            if not re.search(r"\b\d{4}\b", candidate) and (relative_base.date() - parsed.date()).days > 30:
                parsed = parsed.replace(year=parsed.year + 1)
            return parsed.replace(tzinfo=ZoneInfo(timezone_name))
    return None


def _time_value(token: str) -> tuple[int, int]:
    cleaned = token.lower().replace("a.m.", "am").replace("p.m.", "pm").replace(" ", "")
    suffix = cleaned[-2:] if cleaned.endswith(("am", "pm")) else None
    if suffix:
        cleaned = cleaned[:-2]
    cleaned = cleaned.replace(".", ":")
    hour_text, _, minute_text = cleaned.partition(":")
    hour = int(hour_text)
    minute = int(minute_text or "0")
    if suffix == "am" and hour == 12:
        hour = 0
    elif suffix == "pm" and hour != 12:
        hour += 12
    return hour, minute


def _parse_times(text: str) -> tuple[tuple[int, int] | None, tuple[int, int] | None]:
    shared = SHARED_SUFFIX_RANGE.search(text)
    if shared:
        suffix = shared.group(5)
        start = _time_value(f"{shared.group(1)}:{shared.group(2) or '00'} {suffix}")
        end = _time_value(f"{shared.group(3)}:{shared.group(4) or '00'} {suffix}")
        return start, end
    tokens = [match.group(1) for match in TIME_TOKEN.finditer(text)]
    if not tokens:
        return None, None
    values = [_time_value(token) for token in tokens[:2]]
    return values[0], values[1] if len(values) > 1 else None


def _infer_category(text: str) -> str:
    lowered = text.lower()
    for category, keywords in CATEGORY_KEYWORDS:
        if any(keyword in lowered for keyword in keywords):
            return category
    if "career" in lowered and "opportun" in lowered:
        return "Job Search"
    return "Other"


def _clean_title(value: str) -> str:
    value = re.sub(r"^[^A-Za-z0-9]+", "", value).strip()
    corrections = {
        r"\bfron\b": "From",
        r"\bcan(?:h|n|i|hi)?pus\b": "Campus",
        r"\bteeh\b": "Tech",
        r"\bearhy\b": "Early",
    }
    for pattern, replacement in corrections.items():
        value = re.sub(pattern, replacement, value, flags=re.I)
    return re.sub(r"\s+", " ", value).strip(" |•")[:160]


def _layout_title(line_hints: list[dict] | None, image_height: int | None) -> str | None:
    if not line_hints or not image_height:
        return None
    candidates = [
        line for line in line_hints
        if line.get("top", image_height) < image_height * 0.58
        and line.get("confidence", 0) >= 10
        and len(re.sub(r"[^A-Za-z]", "", line.get("text", ""))) >= 4
    ]
    if not candidates:
        return None
    max_height = max(line.get("height", 0) for line in candidates)
    large = [line for line in candidates if line.get("height", 0) >= max(16, max_height * 0.68)]
    if not large:
        return None
    groups: list[list[dict]] = []
    for line in sorted(large, key=lambda item: item["top"]):
        if not groups:
            groups.append([line])
            continue
        previous = groups[-1][-1]
        gap = line["top"] - previous["bottom"]
        if gap <= max(previous["height"], line["height"]) * 1.45:
            groups[-1].append(line)
        else:
            groups.append([line])
    ranked = []
    for group in groups:
        combined = " ".join(item["text"] for item in group)
        if len(combined) > 180:
            continue
        score = sum(item["height"] * max(len(item["text"].split()), 1) for item in group)
        score += len(group) * 35
        score -= group[0]["top"] * 0.05
        ranked.append((score, combined))
    return _clean_title(max(ranked)[1]) if ranked else None


def _infer_title(lines: list[str], line_hints: list[dict] | None = None, image_height: int | None = None) -> str | None:
    layout_title = _layout_title(line_hints, image_height)
    if layout_title:
        return layout_title
    generic = {
        "event", "events", "join us", "save the date", "you are invited",
        "register now", "free event", "don't miss it", "dont miss it",
    }
    scored: list[tuple[int, int, str]] = []
    for index, line in enumerate(lines[:18]):
        if not 3 <= len(line) <= 160 or URL_PATTERN.search(line):
            continue
        lowered = line.lower().strip("!.,: ")
        if lowered in generic or LOCATION_PREFIX.match(line):
            continue
        score = 30 - index
        word_count = len(line.split())
        if 2 <= word_count <= 10:
            score += 7
        if line.isupper() and any(character.isalpha() for character in line):
            score += 4
        if any(pattern.search(line) for pattern in DATE_PATTERNS) or TIME_TOKEN.search(line):
            score -= 18
        if re.search(r"\b(?:register|tickets?|rsvp|admission|location|where|when|presented by|hosted by)\b", line, re.I):
            score -= 10
        if re.search(r"\b(?:university|college|department|association|organization|foundation)\b", line, re.I):
            score -= 4
        scored.append((score, -index, line))
    if not scored:
        return None
    return _clean_title(max(scored)[2])


def _infer_location(lines: list[str]) -> str | None:
    for line in lines:
        match = LOCATION_PREFIX.match(line)
        if match and match.group(1).strip():
            return match.group(1).strip()[:300]
    for line in lines:
        cleaned = re.sub(r"^[^A-Za-z0-9]+", "", line).strip()
        if (ADDRESS_HINT.search(cleaned) or ROOM_CODE.search(cleaned)) and not TIME_TOKEN.search(cleaned) and len(cleaned) <= 300:
            room = ROOM_CODE.search(cleaned)
            return (room.group(0) if room else cleaned)[:300]
    return None


def extract_event_fields(
    text: str,
    *,
    timezone_name: str = "UTC",
    source_url: str | None = None,
    now: datetime | None = None,
    line_hints: list[dict] | None = None,
    image_height: int | None = None,
) -> dict:
    """Convert OCR text into a conservative, reviewable event draft."""
    ZoneInfo(timezone_name)
    relative_base = now or datetime.now(ZoneInfo(timezone_name))
    lines = _normalized_lines(text)
    normalized = "\n".join(lines)
    title = _infer_title(lines, line_hints, image_height)
    event_date = _parse_date(normalized, timezone_name, relative_base)
    start_time, end_time = _parse_times(normalized)
    category = _infer_category(normalized)
    location = _infer_location(lines)

    fields: dict[str, object] = {"timezone": timezone_name, "category": category}
    confidence: dict[str, str] = {"category": "medium" if category != "Other" else "low"}
    warnings: list[str] = []

    if title:
        fields["title"] = title
        confidence["title"] = "medium"
    else:
        warnings.append("We couldn't confidently find the event name.")

    if event_date:
        date_value = event_date.date()
        fields["start_date"] = date_value.isoformat()
        fields["end_date"] = date_value.isoformat()
        confidence["date"] = "medium"
        if start_time:
            start_dt = datetime.combine(date_value, datetime.min.time(), tzinfo=ZoneInfo(timezone_name)).replace(
                hour=start_time[0], minute=start_time[1]
            )
            if end_time:
                end_dt = datetime.combine(date_value, datetime.min.time(), tzinfo=ZoneInfo(timezone_name)).replace(
                    hour=end_time[0], minute=end_time[1]
                )
                if end_dt <= start_dt:
                    end_dt += timedelta(days=1)
            else:
                end_dt = start_dt + timedelta(hours=1)
                warnings.append("Only one time was found, so the event was set to one hour.")
            fields.update({
                "all_day": False,
                "start_time": start_dt.strftime("%H:%M"),
                "end_time": end_dt.strftime("%H:%M"),
                "end_date": end_dt.date().isoformat(),
            })
            confidence["time"] = "medium"
        else:
            fields["all_day"] = True
            warnings.append("No time was found. The draft is marked as all day—please confirm it.")
    else:
        warnings.append("We couldn't confidently find a date. Please choose one before saving.")

    if location:
        fields["location"] = location
        confidence["location"] = "medium"
    if normalized:
        fields["description"] = normalized[:2500]
    if source_url:
        fields["source_url"] = source_url

    reviewed = [key for key in ("title", "category", "start_date", "start_time", "location") if fields.get(key)]
    return {
        "fields": fields,
        "confidence": confidence,
        "warnings": warnings,
        "found_fields": reviewed,
        "ocr_preview": normalized[:500],
    }
