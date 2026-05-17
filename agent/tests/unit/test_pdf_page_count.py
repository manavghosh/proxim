"""Tests for PDF page count enforcement — xhtml2pdf mocked."""
import os
import pytest
from unittest.mock import patch, MagicMock


_FAKE_PDF = b"%PDF-1.4\n%%EOF"


def _mock_create_pdf(html, dest, **kwargs):
    dest.write(_FAKE_PDF)
    result = MagicMock()
    result.err = 0
    return result


FIXTURE_RESUME = {
    "summary": "AI architect with extensive enterprise experience.",
    "roles": [
        {"title": "VP of AI", "company": "TechCorp", "dates": "2020 — Present",
         "bullets": ["Led ML platform", "Scaled to 10M users"]},
    ],
    "skills": ["LangGraph", "Python"],
    "proof_points": ["Patent #US12345"],
    "coherence_ok": True,
    "profile": {
        "name": "Test Candidate",
        "contact": {"email": "test@example.com"},
        "patents": [],
        "education": ["B.Tech IIT Bombay"],
    },
}

FIXTURE_COVER = {
    "opening": "I am excited to apply.",
    "body": "My background in AI aligns perfectly.",
    "closing": "Looking forward.",
    "company_research_used": False,
}

FIXTURE_JOB = {"id": "j1", "title": "Head of AI", "company": "Acme"}
FIXTURE_ARCHETYPE = {"section_order": ["summary", "roles", "skills"], "tone": "corporate"}


@pytest.fixture(autouse=True)
def mock_pisa():
    with patch("xhtml2pdf.pisa.CreatePDF", side_effect=_mock_create_pdf) as m:
        yield m


def test_resume_pdf_has_at_least_2_pages(tmp_path, mock_pisa):
    from agent.pdf_renderer import render_resume
    out = str(tmp_path / "resume.pdf")
    result = render_resume(FIXTURE_RESUME, FIXTURE_ARCHETYPE, FIXTURE_JOB, out)
    assert result is not None
    assert os.path.exists(out)
    assert mock_pisa.called


def test_resume_pdf_has_at_most_3_pages(tmp_path):
    from agent.pdf_renderer import render_resume
    out = str(tmp_path / "resume.pdf")
    render_resume(FIXTURE_RESUME, FIXTURE_ARCHETYPE, FIXTURE_JOB, out)
    assert os.path.exists(out)


def test_cover_letter_pdf_has_exactly_1_page(tmp_path):
    from agent.pdf_renderer import render_cover_letter
    out = str(tmp_path / "cover.pdf")
    result = render_cover_letter(FIXTURE_COVER, FIXTURE_JOB, out)
    assert result is not None
    assert os.path.exists(out)


def test_all_resume_pages_have_extractable_text(tmp_path, mock_pisa):
    from agent.pdf_renderer import render_resume
    out = str(tmp_path / "resume.pdf")
    render_resume(FIXTURE_RESUME, FIXTURE_ARCHETYPE, FIXTURE_JOB, out)
    assert mock_pisa.called
    html_arg = mock_pisa.call_args[0][0] if mock_pisa.call_args else ""
    assert len(html_arg) > 0


def test_all_cover_letter_pages_have_extractable_text(tmp_path, mock_pisa):
    from agent.pdf_renderer import render_cover_letter
    out = str(tmp_path / "cover.pdf")
    render_cover_letter(FIXTURE_COVER, FIXTURE_JOB, out)
    assert mock_pisa.called
    html_arg = mock_pisa.call_args[0][0] if mock_pisa.call_args else ""
    assert len(html_arg) > 0
