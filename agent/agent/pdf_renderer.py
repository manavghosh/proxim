"""PDF renderer — xhtml2pdf (pure Python, no GTK required)."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader


_TEMPLATES_DIR = Path(__file__).parent / "templates"
_FONTS_DIR     = Path(__file__).parent / "assets" / "fonts"

_JINJA_ENV = Environment(
    loader=FileSystemLoader(str(_TEMPLATES_DIR)),
    autoescape=False,
)


def _resolve_font_path() -> str:
    for name in ("Aptos.ttf", "Calibri.ttf"):
        p = _FONTS_DIR / name
        if p.exists():
            return str(p).replace("\\", "/")
    for system in (r"C:\Windows\Fonts\Calibri.ttf", r"C:\Windows\Fonts\Georgia.ttf"):
        if os.path.exists(system):
            return system.replace("\\", "/")
    return ""


_FONT_PATH = _resolve_font_path()


def _render_html(template_name: str, context: dict) -> str:
    t = _JINJA_ENV.get_template(template_name)
    return t.render(**context)


def _write_pdf(html_string: str, output_path: str) -> bytes:
    from xhtml2pdf import pisa
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "wb") as f:
        result = pisa.CreatePDF(html_string, dest=f, encoding="utf-8")
        if result.err:
            raise RuntimeError(f"xhtml2pdf error: {result.err}")
    with open(output_path, "rb") as f:
        return f.read()


def render_resume(
    personalised: dict,
    archetype_config: Any,
    job: dict,
    output_path: str,
) -> bytes:
    from datetime import date
    section_order = (
        archetype_config.get("section_order", ["summary", "roles", "skills"])
        if isinstance(archetype_config, dict)
        else getattr(archetype_config, "section_order", ["summary", "roles", "skills"])
    )
    context = {
        "profile":      personalised.get("profile", {}),
        "personalised": _PersonalisedResumeView(personalised),
        "section_order": section_order,
        "font_path":    _FONT_PATH,
        "job":          job,
        "date":         date.today().strftime("%B %d, %Y"),
    }
    html = _render_html("resume.html.j2", context)
    return _write_pdf(html, output_path)


def render_cover_letter(
    cover_letter: dict,
    job: dict,
    output_path: str,
    profile: dict | None = None,
) -> bytes:
    from datetime import date
    context = {
        "cover_letter": _CoverLetterView(cover_letter),
        "job":          job,
        "profile":      profile or {},
        "font_path":    _FONT_PATH,
        "date":         date.today().strftime("%B %d, %Y"),
    }
    html = _render_html("cover_letter.html.j2", context)
    return _write_pdf(html, output_path)


class _PersonalisedResumeView:
    def __init__(self, data: dict) -> None:
        self._d = data

    def __getattr__(self, name: str) -> Any:
        v = self._d.get(name, [] if name in ("roles", "skills", "proof_points") else "")
        if name == "roles" and isinstance(v, list):
            return [_RoleView(r) for r in v]
        return v


class _RoleView:
    def __init__(self, data: dict) -> None:
        self._d = data
    def __getattr__(self, name: str) -> Any:
        return self._d.get(name, [] if name == "bullets" else "")


class _CoverLetterView:
    def __init__(self, data: dict) -> None:
        self._d = data
    def __getattr__(self, name: str) -> Any:
        return self._d.get(name, "")
