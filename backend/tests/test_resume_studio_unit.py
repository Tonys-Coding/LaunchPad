import io
import sys
import zipfile
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from resume_studio import (
    ResumeContent,
    apply_suggestions,
    extract_resume_file,
    parse_resume_text,
    render_docx,
)


SAMPLE_TEXT = """Tony Student
tony@example.com | 312-555-1212

SUMMARY
Computer science student building reliable web products.

SKILLS
Python, React, MongoDB

EXPERIENCE
Software Engineering Intern | Example Co
- Built a private job-tracking workflow
- Reduced duplicate data entry by 30%

PROJECTS
LaunchPad
- Designed a career application workspace
"""


def test_local_parser_finds_contact_sections_and_bullets():
    content, contact = parse_resume_text(SAMPLE_TEXT)
    assert contact["preferred_email"] == "tony@example.com"
    assert contact["phone"] == "312-555-1212"
    assert [skill.name for skill in content.skills] == ["Python", "React", "MongoDB"]
    assert content.experience[0].title == "Software Engineering Intern"
    assert content.experience[0].organization == "Example Co"
    assert "30%" in content.experience[0].bullets[1]
    assert content.projects[0].title == "LaunchPad"


def test_text_import_rejects_binary_and_scanned_content():
    with pytest.raises(HTTPException, match="binary"):
        extract_resume_file(b"text\x00binary", "resume.txt")
    with pytest.raises(HTTPException, match="No readable"):
        extract_resume_file(b"short", "resume.txt")


def test_docx_validation_rejects_macro_payload():
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, "w") as archive:
        archive.writestr("[Content_Types].xml", "types")
        archive.writestr("word/document.xml", "document")
        archive.writestr("word/vbaProject.bin", b"macro")
    with pytest.raises(HTTPException, match="Macro-enabled"):
        extract_resume_file(payload.getvalue(), "resume.docx")


def test_suggestions_apply_only_after_acceptance_without_mutating_master():
    master = ResumeContent(
        summary="Original summary",
        experience=[{"item_id": "entry", "title": "Intern", "bullets": ["Built tools"]}],
    ).model_dump()
    result = apply_suggestions(master, [
        {"status": "accepted", "section": "summary", "suggested": "Focused summary"},
        {"status": "accepted", "section": "experience", "item_id": "entry", "bullet_index": 0, "suggested": "Built reliable tools"},
        {"status": "rejected", "section": "summary", "suggested": "Rejected summary"},
    ])
    assert master["summary"] == "Original summary"
    assert master["experience"][0]["bullets"] == ["Built tools"]
    assert result["summary"] == "Focused summary"
    assert result["experience"][0]["bullets"] == ["Built reliable tools"]


def test_docx_export_contains_profile_and_resume_text():
    content = ResumeContent(
        summary="Privacy-minded engineer",
        skills=[{"name": "Python"}],
        projects=[{"title": "LaunchPad", "organization": "Personal", "bullets": ["Built a career workspace"]}],
    ).model_dump()
    result = render_docx(content, {
        "full_name": "Tony Student", "preferred_email": "tony@example.com",
        "city": "Chicago", "region": "IL",
    }, "standard")
    assert result.startswith(b"PK")
    from docx import Document
    document = Document(io.BytesIO(result))
    text = "\n".join(paragraph.text for paragraph in document.paragraphs)
    assert "Tony Student" in text
    assert "Privacy-minded engineer" in text
    assert "LaunchPad" in text
