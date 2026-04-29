# Phase 1 Foundation Implementation Plan

> ⚠️ **OBSOLETE — DO NOT EXECUTE.** This plan was written for FastAPI + SQLAlchemy + Python.
> The stack has changed to **Next.js 15 + Drizzle ORM + Vercel AI SDK** (constitution v1.1.0).
> Run `/speckit-plan` to regenerate this plan before implementation begins.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the candidate profile foundation — CV upload with inline Markdown editing, async structured parsing via Claude, and a preferences form with a pipeline readiness gate.

**Architecture:** Single `/settings` Next.js page backed by two FastAPI routers (`/api/cv` and `/api/preferences`). CV upload converts file to Markdown server-side; candidate edits inline before saving. On save, SHA256 hash is computed and an async background parse job fires Claude via LiteLLM. Preferences stored as JSONB; seniority level + geographic preference are required for pipeline activation. `candidate_id` FK exists but is nullable — no auth in Phase 1, ready for multi-user post-MVP.

**Tech Stack:** Python 3.11 / FastAPI / SQLAlchemy asyncio / asyncpg / Alembic / Neon PostgreSQL / python-docx / pypdf / LiteLLM / TypeScript / Next.js 14 / Tailwind CSS

---

## Phases

| Phase | Tasks | Deliverable | Safe pause point |
|-------|-------|-------------|-----------------|
| **A — Backend Foundation** | 1–2 | FastAPI app running, DB connected | ✅ After Task 2 |
| **B — Backend Data & Services** | 3–8 | All backend endpoints + CV parser working | ✅ After Task 8 |
| **C — Backend Preferences & Readiness** | 9–10 | Full backend API complete, all tests passing | ✅ After Task 10 |
| **D — Frontend** | 11–15 | Settings page fully functional end-to-end | ✅ After Task 15 |

---

## File Map

```
backend/
├── pyproject.toml
├── alembic.ini
├── alembic/versions/001_create_candidates.py
├── src/
│   ├── __init__.py
│   ├── main.py
│   ├── config.py
│   ├── database.py
│   ├── models/candidate.py
│   ├── schemas/
│   │   ├── candidate.py
│   │   ├── parsed_profile.py
│   │   └── preferences.py
│   ├── routers/
│   │   ├── cv.py
│   │   ├── preferences.py
│   │   └── candidate.py
│   └── services/
│       ├── hash_service.py
│       ├── cv_converter.py
│       └── cv_parser.py
└── tests/
    ├── conftest.py
    ├── fixtures/sample.md
    ├── unit/
    │   ├── test_hash_service.py
    │   ├── test_cv_converter.py
    │   └── test_cv_parser.py
    └── integration/
        ├── test_cv_endpoints.py
        └── test_preferences_endpoints.py

frontend/
├── src/
│   ├── types/candidate.ts
│   ├── lib/api.ts
│   ├── components/
│   │   ├── cv/
│   │   │   ├── CVUploader.tsx
│   │   │   ├── MarkdownEditor.tsx
│   │   │   └── ParseStatusBadge.tsx
│   │   ├── preferences/PreferencesForm.tsx
│   │   └── shared/PipelineReadinessIndicator.tsx
│   └── app/settings/page.tsx
```

---

## Task 1: Backend project setup

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/src/__init__.py`
- Create: `backend/src/main.py`
- Create: `backend/src/config.py`
- Create: `backend/.env.example`

- [ ] **Step 1: Create `backend/pyproject.toml`**

```toml
[project]
name = "proxim-backend"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "sqlalchemy[asyncio]>=2.0",
    "asyncpg>=0.29",
    "alembic>=1.13",
    "python-multipart>=0.0.9",
    "python-docx>=1.1",
    "pypdf>=4.0",
    "litellm>=1.40",
    "pydantic>=2.7",
    "pydantic-settings>=2.3",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.23",
    "httpx>=0.27",
    "pytest-mock>=3.14",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

- [ ] **Step 2: Create `backend/src/config.py`**

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str
    llm_provider: str = "anthropic"
    llm_model: str = "claude-sonnet-4-6"

    class Config:
        env_file = ".env"

settings = Settings()
```

- [ ] **Step 3: Create `backend/src/main.py`**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from src.routers import cv, preferences, candidate

app = FastAPI(title="Proxim API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(cv.router)
app.include_router(preferences.router)
app.include_router(candidate.router)
```

- [ ] **Step 4: Create `backend/.env.example`**

```
DATABASE_URL=postgresql+asyncpg://user:password@host/proxim
LLM_PROVIDER=anthropic
LLM_MODEL=claude-sonnet-4-6
ANTHROPIC_API_KEY=sk-ant-...
```

- [ ] **Step 5: Install deps and verify startup**

```bash
cd backend
uv sync
uv run uvicorn src.main:app --reload
```

Expected: `Application startup complete.` at `http://localhost:8000`

- [ ] **Step 6: Commit**

```bash
git add backend/
git commit -m "chore: scaffold FastAPI backend for Phase 1"
```

---

## Task 2: Database connection

**Files:**
- Create: `backend/src/database.py`
- Create: `backend/tests/conftest.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/conftest.py`:

```python
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from src.main import app
from src.database import Base, get_session

TEST_DB_URL = "postgresql+asyncpg://user:password@host/proxim_test"

@pytest.fixture(scope="session")
async def engine():
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()

@pytest.fixture
async def session(engine):
    async_session = async_sessionmaker(engine, expire_on_commit=False)
    async with async_session() as s:
        yield s
        await s.rollback()

@pytest.fixture
async def client(session):
    async def override_get_session():
        yield session
    app.dependency_overrides[get_session] = override_get_session
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()
```

- [ ] **Step 2: Create `backend/src/database.py`**

```python
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from src.config import settings

engine = create_async_engine(settings.database_url)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

async def get_session() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
```

- [ ] **Step 3: Run test to verify import works**

```bash
cd backend
uv run python -c "from src.database import Base, get_session; print('OK')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/src/database.py backend/tests/conftest.py
git commit -m "chore: add async database connection and test fixtures"
```

---

## Task 3: Candidates table — ORM model + migration

**Files:**
- Create: `backend/src/models/candidate.py`
- Create: `backend/alembic.ini`
- Create: `backend/alembic/versions/001_create_candidates.py`
- Create: `backend/tests/unit/test_candidate_model.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_candidate_model.py`:

```python
import pytest
from src.models.candidate import Candidate, ParseStatus

async def test_candidate_defaults(session):
    c = Candidate()
    session.add(c)
    await session.commit()
    await session.refresh(c)

    assert c.id is not None
    assert c.candidate_id is None
    assert c.base_cv_md is None
    assert c.base_cv_hash is None
    assert c.parsed_profile is None
    assert c.parse_status == ParseStatus.pending
    assert c.preferences == {}
    assert c.created_at is not None
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend
uv run pytest tests/unit/test_candidate_model.py -v
```

Expected: `ImportError` — module not found

- [ ] **Step 3: Create `backend/src/models/candidate.py`**

```python
import uuid
import enum
from datetime import datetime
from sqlalchemy import String, Text, Enum as SAEnum, DateTime, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from src.database import Base

class ParseStatus(enum.Enum):
    pending = "pending"
    parsing = "parsing"
    ready = "ready"
    failed = "failed"

class Candidate(Base):
    __tablename__ = "candidates"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    candidate_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    base_cv_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    base_cv_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    parsed_profile: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    parse_status: Mapped[ParseStatus] = mapped_column(
        SAEnum(ParseStatus, name="parse_status_enum"), default=ParseStatus.pending
    )
    preferences: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
```

- [ ] **Step 4: Run test to verify it passes**

```bash
uv run pytest tests/unit/test_candidate_model.py -v
```

Expected: `PASSED`

- [ ] **Step 5: Create Alembic migration**

```bash
uv run alembic init alembic
```

Edit `alembic/env.py` — replace the `target_metadata` line:
```python
from src.models.candidate import Base
target_metadata = Base.metadata
```

Then create the migration:
```bash
uv run alembic revision --autogenerate -m "create candidates table"
```

Run against the real database:
```bash
uv run alembic upgrade head
```

Expected: `Running upgrade -> <hash>, create candidates table`

- [ ] **Step 6: Commit**

```bash
git add backend/src/models/ backend/alembic/ backend/alembic.ini backend/tests/unit/test_candidate_model.py
git commit -m "feat: add candidates table ORM model and migration"
```

---

## Task 4: Hash service

**Files:**
- Create: `backend/src/services/hash_service.py`
- Create: `backend/tests/unit/test_hash_service.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/unit/test_hash_service.py`:

```python
from src.services.hash_service import compute_sha256

def test_same_content_produces_same_hash():
    h1 = compute_sha256("hello world")
    h2 = compute_sha256("hello world")
    assert h1 == h2

def test_different_content_produces_different_hash():
    h1 = compute_sha256("hello world")
    h2 = compute_sha256("hello world!")
    assert h1 != h2

def test_hash_is_64_hex_chars():
    h = compute_sha256("any content")
    assert len(h) == 64
    assert all(c in "0123456789abcdef" for c in h)

def test_empty_string_has_known_hash():
    # SHA256 of empty string is well-known
    h = compute_sha256("")
    assert h == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
```

- [ ] **Step 2: Run to verify they fail**

```bash
uv run pytest tests/unit/test_hash_service.py -v
```

Expected: `ImportError`

- [ ] **Step 3: Create `backend/src/services/hash_service.py`**

```python
import hashlib

def compute_sha256(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
uv run pytest tests/unit/test_hash_service.py -v
```

Expected: `4 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/hash_service.py backend/tests/unit/test_hash_service.py
git commit -m "feat: add SHA256 hash service"
```

---

## Task 5: CV converter service

**Files:**
- Create: `backend/src/services/cv_converter.py`
- Create: `backend/tests/fixtures/sample.md`
- Create: `backend/tests/unit/test_cv_converter.py`

- [ ] **Step 1: Create fixture file**

Create `backend/tests/fixtures/sample.md`:
```markdown
# Manav Ghosh

manav@example.com | Bengaluru

## Summary

Senior AI leader with 15+ years experience.

## Experience

### Head of AI — Acme Corp (2020–present)

- Built $2B platform serving 50M users
- Led team of 40 engineers across 3 continents

## Skills

Python, LangGraph, FastAPI, LLM Engineering

## Education

B.Tech Computer Science — IIT Delhi, 2008
```

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/unit/test_cv_converter.py`:

```python
import pytest
from pathlib import Path
from src.services.cv_converter import convert_to_markdown, ConversionError

FIXTURES = Path(__file__).parent.parent / "fixtures"

def test_md_passthrough():
    content = (FIXTURES / "sample.md").read_bytes()
    result = convert_to_markdown(content, "sample.md")
    assert "Manav Ghosh" in result
    assert "LangGraph" in result

def test_unsupported_format_raises():
    with pytest.raises(ConversionError, match="Unsupported format"):
        convert_to_markdown(b"data", "resume.xlsx")

def test_file_with_no_text_raises():
    # Minimal valid PDF with no extractable text
    with pytest.raises(ConversionError, match="No text"):
        convert_to_markdown(b"%PDF-1.4\n%%EOF\n", "empty.pdf")

def test_result_is_non_empty_string():
    content = (FIXTURES / "sample.md").read_bytes()
    result = convert_to_markdown(content, "sample.md")
    assert isinstance(result, str)
    assert len(result.strip()) > 0
```

- [ ] **Step 3: Run to verify they fail**

```bash
uv run pytest tests/unit/test_cv_converter.py -v
```

Expected: `ImportError`

- [ ] **Step 4: Create `backend/src/services/cv_converter.py`**

```python
import io
from pathlib import Path

class ConversionError(Exception):
    pass

def convert_to_markdown(file_content: bytes, filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix == ".md":
        return file_content.decode("utf-8")
    elif suffix == ".docx":
        return _docx_to_markdown(file_content)
    elif suffix == ".pdf":
        return _pdf_to_markdown(file_content)
    else:
        raise ConversionError(f"Unsupported format: {suffix}. Accepted: .md, .docx, .pdf")

def _docx_to_markdown(content: bytes) -> str:
    from docx import Document
    doc = Document(io.BytesIO(content))
    lines = []
    for para in doc.paragraphs:
        text = para.text.strip()
        if not text:
            lines.append("")
            continue
        style = para.style.name
        if style.startswith("Heading 1"):
            lines.append(f"# {text}")
        elif style.startswith("Heading 2"):
            lines.append(f"## {text}")
        elif style.startswith("Heading 3"):
            lines.append(f"### {text}")
        elif "List" in style:
            lines.append(f"- {text}")
        else:
            lines.append(text)
    result = "\n".join(lines)
    if not result.strip():
        raise ConversionError("No text could be extracted from this DOCX file")
    return result

def _pdf_to_markdown(content: bytes) -> str:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(content))
    pages = [page.extract_text() or "" for page in reader.pages]
    result = "\n\n".join(p.strip() for p in pages if p.strip())
    if not result:
        raise ConversionError("No text could be extracted from this PDF. It may be a scanned image.")
    return result
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
uv run pytest tests/unit/test_cv_converter.py -v
```

Expected: `4 passed`

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/cv_converter.py backend/tests/fixtures/sample.md backend/tests/unit/test_cv_converter.py
git commit -m "feat: add CV converter service (PDF/DOCX/MD → Markdown)"
```

---

## Task 6: CV convert endpoint

**Files:**
- Create: `backend/src/schemas/candidate.py`
- Create: `backend/src/routers/cv.py`
- Create: `backend/tests/integration/test_cv_endpoints.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/integration/test_cv_endpoints.py`:

```python
import pytest
from pathlib import Path

FIXTURES = Path(__file__).parent.parent / "fixtures"

async def test_convert_md_returns_markdown(client):
    content = (FIXTURES / "sample.md").read_bytes()
    response = await client.post(
        "/api/cv/convert",
        files={"file": ("sample.md", content, "text/markdown")},
    )
    assert response.status_code == 200
    data = response.json()
    assert "markdown" in data
    assert "Manav Ghosh" in data["markdown"]

async def test_convert_rejects_unsupported_format(client):
    response = await client.post(
        "/api/cv/convert",
        files={"file": ("resume.xlsx", b"data", "application/octet-stream")},
    )
    assert response.status_code == 400
    assert "Unsupported" in response.json()["detail"]

async def test_convert_rejects_file_over_10mb(client):
    big_content = b"x" * (10 * 1024 * 1024 + 1)
    response = await client.post(
        "/api/cv/convert",
        files={"file": ("big.md", big_content, "text/markdown")},
    )
    assert response.status_code == 413
```

- [ ] **Step 2: Run to verify they fail**

```bash
uv run pytest tests/integration/test_cv_endpoints.py::test_convert_md_returns_markdown -v
```

Expected: `404 Not Found` or `ImportError`

- [ ] **Step 3: Create `backend/src/schemas/candidate.py`**

```python
from pydantic import BaseModel
from uuid import UUID
from datetime import datetime
from src.models.candidate import ParseStatus

class CVConvertResponse(BaseModel):
    markdown: str

class CVSaveRequest(BaseModel):
    markdown: str

class CVResponse(BaseModel):
    id: UUID
    base_cv_md: str | None
    base_cv_hash: str | None
    parse_status: ParseStatus

    model_config = {"from_attributes": True}
```

- [ ] **Step 4: Create `backend/src/routers/cv.py`**

```python
from fastapi import APIRouter, UploadFile, File, Depends, BackgroundTasks, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.database import get_session
from src.models.candidate import Candidate, ParseStatus
from src.schemas.candidate import CVConvertResponse, CVSaveRequest, CVResponse
from src.services.cv_converter import convert_to_markdown, ConversionError
from src.services.hash_service import compute_sha256

router = APIRouter(prefix="/api/cv", tags=["cv"])
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB

async def _get_or_create_candidate(session: AsyncSession) -> Candidate:
    result = await session.execute(select(Candidate).limit(1))
    candidate = result.scalar_one_or_none()
    if not candidate:
        candidate = Candidate()
        session.add(candidate)
        await session.commit()
        await session.refresh(candidate)
    return candidate

@router.post("/convert", response_model=CVConvertResponse)
async def convert_cv(file: UploadFile = File(...)):
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File exceeds 10MB limit")
    try:
        markdown = convert_to_markdown(content, file.filename or "upload.md")
    except ConversionError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return CVConvertResponse(markdown=markdown)

@router.get("", response_model=CVResponse)
async def get_cv(session: AsyncSession = Depends(get_session)):
    candidate = await _get_or_create_candidate(session)
    return CVResponse.model_validate(candidate)
```

- [ ] **Step 5: Register router in `backend/src/main.py`**

`src/main.py` already imports `cv` router — verify it's included:
```python
app.include_router(cv.router)
```

- [ ] **Step 6: Run convert tests to verify they pass**

```bash
uv run pytest tests/integration/test_cv_endpoints.py -k "convert" -v
```

Expected: `3 passed`

- [ ] **Step 7: Commit**

```bash
git add backend/src/schemas/candidate.py backend/src/routers/cv.py
git commit -m "feat: add CV convert endpoint with 10MB guard"
```

---

## Task 7: CV save endpoint with hash-change detection

**Files:**
- Modify: `backend/src/routers/cv.py`
- Modify: `backend/tests/integration/test_cv_endpoints.py`

- [ ] **Step 1: Write the failing tests — append to `test_cv_endpoints.py`**

```python
async def test_save_cv_stores_markdown(client):
    markdown = "# Test CV\n\nSome content."
    response = await client.post("/api/cv/save", json={"markdown": markdown})
    assert response.status_code == 200
    data = response.json()
    assert data["base_cv_md"] == markdown
    assert len(data["base_cv_hash"]) == 64
    assert data["parse_status"] == "pending"

async def test_save_cv_identical_content_is_noop(client):
    markdown = "# Identical CV"
    await client.post("/api/cv/save", json={"markdown": markdown})
    r1 = await client.get("/api/cv")
    await client.post("/api/cv/save", json={"markdown": markdown})
    r2 = await client.get("/api/cv")
    assert r1.json()["base_cv_hash"] == r2.json()["base_cv_hash"]

async def test_save_cv_changed_content_updates_hash(client):
    await client.post("/api/cv/save", json={"markdown": "# Version 1"})
    r1 = await client.get("/api/cv")
    await client.post("/api/cv/save", json={"markdown": "# Version 2"})
    r2 = await client.get("/api/cv")
    assert r1.json()["base_cv_hash"] != r2.json()["base_cv_hash"]
```

- [ ] **Step 2: Run to verify they fail**

```bash
uv run pytest tests/integration/test_cv_endpoints.py -k "save" -v
```

Expected: `404 Not Found`

- [ ] **Step 3: Add save endpoint to `backend/src/routers/cv.py`**

Add after the `get_cv` route:

```python
@router.post("/save", response_model=CVResponse)
async def save_cv(
    body: CVSaveRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
):
    new_hash = compute_sha256(body.markdown)
    candidate = await _get_or_create_candidate(session)

    if candidate.base_cv_hash == new_hash:
        return CVResponse.model_validate(candidate)

    candidate.base_cv_md = body.markdown
    candidate.base_cv_hash = new_hash
    candidate.parse_status = ParseStatus.pending
    candidate.parsed_profile = None
    await session.commit()
    await session.refresh(candidate)

    background_tasks.add_task(_trigger_parse, str(candidate.id))
    return CVResponse.model_validate(candidate)

async def _trigger_parse(candidate_id: str):
    from src.services.cv_parser import parse_cv_async
    await parse_cv_async(candidate_id)
```

- [ ] **Step 4: Run save tests to verify they pass**

```bash
uv run pytest tests/integration/test_cv_endpoints.py -k "save" -v
```

Expected: `3 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/src/routers/cv.py backend/tests/integration/test_cv_endpoints.py
git commit -m "feat: add CV save endpoint with hash-change detection and parse trigger"
```

---

## Task 8: CV parser service (Claude via LiteLLM)

**Files:**
- Create: `backend/src/schemas/parsed_profile.py`
- Create: `backend/src/services/cv_parser.py`
- Create: `backend/tests/unit/test_cv_parser.py`

- [ ] **Step 1: Create `backend/src/schemas/parsed_profile.py`**

```python
from pydantic import BaseModel

class Role(BaseModel):
    title: str
    company: str
    dates: str
    bullets: list[str] = []

class ParsedProfile(BaseModel):
    name: str = ""
    contact: dict[str, str] = {}
    summary: str = ""
    roles: list[Role] = []
    skills: list[str] = []
    patents: list[str] = []
    projects: list[str] = []
    education: list[str] = []
    certifications: list[str] = []
    awards: list[str] = []
```

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/unit/test_cv_parser.py`:

```python
import pytest
import json
from unittest.mock import AsyncMock, patch, MagicMock
from src.services.cv_parser import _call_claude
from src.schemas.parsed_profile import ParsedProfile

VALID_PROFILE = {
    "name": "Manav Ghosh",
    "contact": {"email": "manav@example.com"},
    "summary": "Senior AI leader",
    "roles": [{"title": "Head of AI", "company": "Acme", "dates": "2020-present", "bullets": ["Led 40 engineers"]}],
    "skills": ["Python", "LangGraph"],
    "patents": [], "projects": [], "education": [], "certifications": [], "awards": []
}

async def test_call_claude_returns_parsed_profile(mock_litellm):
    mock_litellm.return_value.choices[0].message.content = json.dumps(VALID_PROFILE)
    result = await _call_claude("# Manav Ghosh\n\nSenior AI leader")
    profile = ParsedProfile.model_validate(result)
    assert profile.name == "Manav Ghosh"

async def test_call_claude_raises_on_invalid_json(mock_litellm):
    mock_litellm.return_value.choices[0].message.content = "not json"
    with pytest.raises(Exception):
        await _call_claude("some cv")

@pytest.fixture
def mock_litellm(mocker):
    return mocker.patch("src.services.cv_parser.litellm.acompletion", new_callable=AsyncMock)
```

- [ ] **Step 3: Run to verify they fail**

```bash
uv run pytest tests/unit/test_cv_parser.py -v
```

Expected: `ImportError`

- [ ] **Step 4: Create `backend/src/services/cv_parser.py`**

```python
import json
import litellm
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from src.config import settings
from src.schemas.parsed_profile import ParsedProfile

PARSE_PROMPT = """You are a CV parsing assistant. Extract all information from the CV below into JSON.
Return ONLY valid JSON — no explanation, no markdown, no code fences.
Match this exact schema: name, contact (object), summary, roles (array of: title, company, dates, bullets),
skills, patents, projects, education, certifications, awards.
Prefer empty arrays over omitting fields. Never fabricate information not present in the CV.

CV:
{cv_markdown}"""

async def parse_cv_async(candidate_id: str) -> None:
    engine = create_async_engine(settings.database_url)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        from src.models.candidate import Candidate, ParseStatus
        from sqlalchemy import select
        result = await session.execute(select(Candidate).where(Candidate.id == candidate_id))
        candidate = result.scalar_one_or_none()
        if not candidate or not candidate.base_cv_md:
            return

        candidate.parse_status = ParseStatus.parsing
        await session.commit()

        try:
            profile_dict = await _call_claude(candidate.base_cv_md)
            candidate.parsed_profile = profile_dict
            candidate.parse_status = ParseStatus.ready
        except Exception:
            candidate.parse_status = ParseStatus.failed

        await session.commit()
    await engine.dispose()

async def _call_claude(cv_markdown: str) -> dict:
    response = await litellm.acompletion(
        model=f"anthropic/{settings.llm_model}",
        messages=[{"role": "user", "content": PARSE_PROMPT.format(cv_markdown=cv_markdown)}],
        response_format={"type": "json_object"},
    )
    raw = response.choices[0].message.content
    data = json.loads(raw)
    profile = ParsedProfile.model_validate(data)
    return profile.model_dump()
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
uv run pytest tests/unit/test_cv_parser.py -v
```

Expected: `2 passed`

- [ ] **Step 6: Commit**

```bash
git add backend/src/schemas/parsed_profile.py backend/src/services/cv_parser.py backend/tests/unit/test_cv_parser.py
git commit -m "feat: add CV parser service using Claude via LiteLLM"
```

---

## Task 9: Preferences endpoints

**Files:**
- Create: `backend/src/schemas/preferences.py`
- Create: `backend/src/routers/preferences.py`
- Create: `backend/tests/integration/test_preferences_endpoints.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/integration/test_preferences_endpoints.py`:

```python
async def test_get_preferences_returns_empty_dict_by_default(client):
    response = await client.get("/api/preferences")
    assert response.status_code == 200
    assert response.json()["preferences"] == {}

async def test_save_required_preferences(client):
    response = await client.put("/api/preferences", json={
        "seniority_levels": ["CAIO", "VP AI"],
        "geographic_preference": "Remote"
    })
    assert response.status_code == 200
    prefs = response.json()["preferences"]
    assert prefs["seniority_levels"] == ["CAIO", "VP AI"]
    assert prefs["geographic_preference"] == "Remote"

async def test_partial_update_does_not_clear_other_fields(client):
    await client.put("/api/preferences", json={"seniority_levels": ["CAIO"]})
    await client.put("/api/preferences", json={"geographic_preference": "Remote"})
    response = await client.get("/api/preferences")
    prefs = response.json()["preferences"]
    assert prefs["seniority_levels"] == ["CAIO"]
    assert prefs["geographic_preference"] == "Remote"
```

- [ ] **Step 2: Run to verify they fail**

```bash
uv run pytest tests/integration/test_preferences_endpoints.py -v
```

Expected: `404 Not Found`

- [ ] **Step 3: Create `backend/src/schemas/preferences.py`**

```python
from pydantic import BaseModel

class CompensationBand(BaseModel):
    min: int
    max: int
    currency: str = "INR"

class PreferencesRequest(BaseModel):
    seniority_levels: list[str] | None = None
    geographic_preference: str | None = None
    company_stages: list[str] | None = None
    compensation_band: CompensationBand | None = None
    target_companies: list[str] | None = None
    preferred_domains: list[str] | None = None

class PreferencesResponse(BaseModel):
    preferences: dict
```

- [ ] **Step 4: Create `backend/src/routers/preferences.py`**

```python
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from src.database import get_session
from src.schemas.preferences import PreferencesRequest, PreferencesResponse
from src.routers.cv import _get_or_create_candidate

router = APIRouter(prefix="/api/preferences", tags=["preferences"])

@router.get("", response_model=PreferencesResponse)
async def get_preferences(session: AsyncSession = Depends(get_session)):
    candidate = await _get_or_create_candidate(session)
    return PreferencesResponse(preferences=candidate.preferences or {})

@router.put("", response_model=PreferencesResponse)
async def update_preferences(
    body: PreferencesRequest,
    session: AsyncSession = Depends(get_session),
):
    candidate = await _get_or_create_candidate(session)
    current = dict(candidate.preferences or {})
    updates = body.model_dump(exclude_none=True)
    current.update(updates)
    candidate.preferences = current
    await session.commit()
    await session.refresh(candidate)
    return PreferencesResponse(preferences=candidate.preferences)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
uv run pytest tests/integration/test_preferences_endpoints.py -v
```

Expected: `3 passed`

- [ ] **Step 6: Commit**

```bash
git add backend/src/schemas/preferences.py backend/src/routers/preferences.py backend/tests/integration/test_preferences_endpoints.py
git commit -m "feat: add preferences endpoints with partial-update merge"
```

---

## Task 10: Pipeline readiness endpoint

**Files:**
- Create: `backend/src/routers/candidate.py`
- Append tests to `backend/tests/integration/test_preferences_endpoints.py`

- [ ] **Step 1: Write the failing tests — append to `test_preferences_endpoints.py`**

```python
async def test_readiness_false_when_no_cv_or_preferences(client):
    response = await client.get("/api/candidate/readiness")
    assert response.status_code == 200
    data = response.json()
    assert data["ready"] is False
    assert len(data["missing"]) > 0

async def test_readiness_true_when_cv_and_required_preferences_set(client):
    await client.post("/api/cv/save", json={"markdown": "# CV"})
    await client.put("/api/preferences", json={
        "seniority_levels": ["CAIO"],
        "geographic_preference": "Remote"
    })
    response = await client.get("/api/candidate/readiness")
    data = response.json()
    assert data["ready"] is True
    assert data["missing"] == []

async def test_readiness_false_when_only_seniority_set(client):
    await client.post("/api/cv/save", json={"markdown": "# CV"})
    await client.put("/api/preferences", json={"seniority_levels": ["CAIO"]})
    response = await client.get("/api/candidate/readiness")
    data = response.json()
    assert data["ready"] is False
    assert any("geographic" in m.lower() for m in data["missing"])
```

- [ ] **Step 2: Run to verify they fail**

```bash
uv run pytest tests/integration/test_preferences_endpoints.py -k "readiness" -v
```

Expected: `404 Not Found`

- [ ] **Step 3: Create `backend/src/routers/candidate.py`**

```python
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from src.database import get_session
from src.routers.cv import _get_or_create_candidate

router = APIRouter(prefix="/api/candidate", tags=["candidate"])

@router.get("/readiness")
async def get_readiness(session: AsyncSession = Depends(get_session)):
    candidate = await _get_or_create_candidate(session)
    prefs = candidate.preferences or {}

    cv_saved = bool(candidate.base_cv_md)
    seniority_set = bool(prefs.get("seniority_levels"))
    location_set = bool(prefs.get("geographic_preference"))

    missing = []
    if not cv_saved:
        missing.append("Upload and save your CV")
    if not seniority_set:
        missing.append("Set your target seniority level")
    if not location_set:
        missing.append("Set your geographic preference")

    return {
        "ready": cv_saved and seniority_set and location_set,
        "missing": missing,
        "parse_status": candidate.parse_status.value,
    }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
uv run pytest tests/integration/test_preferences_endpoints.py -v
```

Expected: `6 passed`

- [ ] **Step 5: Run full backend test suite**

```bash
uv run pytest -v
```

Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add backend/src/routers/candidate.py backend/tests/integration/test_preferences_endpoints.py
git commit -m "feat: add pipeline readiness endpoint"
```

---

## Task 11: Frontend types and API client

**Files:**
- Create: `frontend/src/types/candidate.ts`
- Create: `frontend/src/lib/api.ts`

- [ ] **Step 1: Create `frontend/src/types/candidate.ts`**

```typescript
export type ParseStatus = "pending" | "parsing" | "ready" | "failed";

export interface Role {
  title: string;
  company: string;
  dates: string;
  bullets: string[];
}

export interface ParsedProfile {
  name: string;
  contact: Record<string, string>;
  summary: string;
  roles: Role[];
  skills: string[];
  patents: string[];
  projects: string[];
  education: string[];
  certifications: string[];
  awards: string[];
}

export interface Preferences {
  seniority_levels?: string[];
  geographic_preference?: string;
  company_stages?: string[];
  compensation_band?: { min: number; max: number; currency: string };
  target_companies?: string[];
  preferred_domains?: string[];
}

export interface Candidate {
  id: string;
  base_cv_md: string | null;
  base_cv_hash: string | null;
  parse_status: ParseStatus;
  parsed_profile: ParsedProfile | null;
  preferences: Preferences;
}

export interface PipelineReadiness {
  ready: boolean;
  missing: string[];
  parse_status: ParseStatus;
}
```

- [ ] **Step 2: Create `frontend/src/lib/api.ts`**

```typescript
import type { Candidate, Preferences, PipelineReadiness } from "@/types/candidate";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function convertCV(file: File): Promise<{ markdown: string }> {
  const form = new FormData();
  form.append("file", file);
  return request("/api/cv/convert", { method: "POST", body: form });
}

export async function saveCV(markdown: string): Promise<Candidate> {
  return request("/api/cv/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markdown }),
  });
}

export async function getCV(): Promise<Candidate> {
  return request("/api/cv");
}

export async function getPreferences(): Promise<{ preferences: Preferences }> {
  return request("/api/preferences");
}

export async function updatePreferences(
  updates: Partial<Preferences>
): Promise<{ preferences: Preferences }> {
  return request("/api/preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
}

export async function getReadiness(): Promise<PipelineReadiness> {
  return request("/api/candidate/readiness");
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/ frontend/src/lib/api.ts
git commit -m "feat: add TypeScript types and API client for Phase 1"
```

---

## Task 12: CVUploader and MarkdownEditor components

**Files:**
- Create: `frontend/src/components/cv/CVUploader.tsx`
- Create: `frontend/src/components/cv/MarkdownEditor.tsx`

- [ ] **Step 1: Create `frontend/src/components/cv/CVUploader.tsx`**

```typescript
"use client";

import { useRef, useState } from "react";
import { convertCV } from "@/lib/api";

interface Props {
  onConverted: (markdown: string) => void;
}

const ACCEPTED = ".md,.docx,.pdf";
const MAX_MB = 10;

export function CVUploader({ onConverted }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleFile(file: File) {
    setError(null);
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`File exceeds ${MAX_MB}MB limit.`);
      return;
    }
    setLoading(true);
    try {
      const { markdown } = await convertCV(file);
      onConverted(markdown);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Conversion failed. Try a different file.");
    } finally {
      setLoading(false);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "Converting…" : "Upload CV"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={handleChange}
      />
      <p className="text-xs text-gray-500">Accepted: .md, .docx, .pdf · Max {MAX_MB}MB</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Create `frontend/src/components/cv/MarkdownEditor.tsx`**

```typescript
"use client";

import { useState } from "react";
import { saveCV } from "@/lib/api";
import type { Candidate } from "@/types/candidate";

interface Props {
  initialMarkdown: string;
  onSaved: (candidate: Candidate) => void;
}

export function MarkdownEditor({ initialMarkdown, onSaved }: Props) {
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const candidate = await saveCV(markdown);
      onSaved(candidate);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          Review and correct the converted Markdown before saving.
        </p>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 text-sm"
        >
          {saving ? "Saving…" : "Save CV"}
        </button>
      </div>
      <textarea
        value={markdown}
        onChange={(e) => setMarkdown(e.target.value)}
        rows={24}
        className="w-full font-mono text-sm border rounded p-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
        spellCheck={false}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/cv/
git commit -m "feat: add CVUploader and MarkdownEditor components"
```

---

## Task 13: ParseStatusBadge with polling

**Files:**
- Create: `frontend/src/components/cv/ParseStatusBadge.tsx`

- [ ] **Step 1: Create `frontend/src/components/cv/ParseStatusBadge.tsx`**

```typescript
"use client";

import { useEffect, useState } from "react";
import { getCV } from "@/lib/api";
import type { ParseStatus } from "@/types/candidate";

interface Props {
  initialStatus: ParseStatus;
}

const LABELS: Record<ParseStatus, string> = {
  pending: "Pending parse",
  parsing: "Parsing CV…",
  ready: "Profile ready",
  failed: "Parse failed",
};

const COLOURS: Record<ParseStatus, string> = {
  pending: "bg-gray-100 text-gray-600",
  parsing: "bg-yellow-100 text-yellow-700",
  ready: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

const POLL_INTERVAL_MS = 3000;

export function ParseStatusBadge({ initialStatus }: Props) {
  const [status, setStatus] = useState<ParseStatus>(initialStatus);

  useEffect(() => {
    if (status === "ready" || status === "failed") return;
    const id = setInterval(async () => {
      try {
        const candidate = await getCV();
        setStatus(candidate.parse_status);
      } catch {
        // silent — keep polling
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [status]);

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${COLOURS[status]}`}>
      {status === "parsing" && (
        <span className="mr-1 h-2 w-2 rounded-full bg-yellow-500 animate-pulse" />
      )}
      {LABELS[status]}
    </span>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/cv/ParseStatusBadge.tsx
git commit -m "feat: add ParseStatusBadge with 3s polling"
```

---

## Task 14: PreferencesForm component

**Files:**
- Create: `frontend/src/components/preferences/PreferencesForm.tsx`

- [ ] **Step 1: Create `frontend/src/components/preferences/PreferencesForm.tsx`**

```typescript
"use client";

import { useState } from "react";
import { updatePreferences } from "@/lib/api";
import type { Preferences } from "@/types/candidate";

const SENIORITY_OPTIONS = ["CAIO", "CTO", "VP AI", "Head of AI", "Distinguished Engineer", "AI Practice Head"];
const LOCATION_OPTIONS = ["Remote", "Hybrid", "Bengaluru-based", "Open to relocation"];
const COMPANY_STAGE_OPTIONS = ["Startup Series B–D", "GCC", "Indian Enterprise", "Product Co", "Consultancy"];
const DOMAIN_OPTIONS = ["BFSI", "E-commerce", "SaaS", "Healthcare", "Defence"];

interface Props {
  initialPreferences: Preferences;
  onSaved: (prefs: Preferences) => void;
}

export function PreferencesForm({ initialPreferences, onSaved }: Props) {
  const [prefs, setPrefs] = useState<Preferences>(initialPreferences);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function toggleMulti(key: keyof Preferences, value: string) {
    const current = (prefs[key] as string[] | undefined) ?? [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    setPrefs({ ...prefs, [key]: next });
  }

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (!prefs.seniority_levels?.length) errors.seniority_levels = "Select at least one seniority level";
    if (!prefs.geographic_preference) errors.geographic_preference = "Select a geographic preference";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setError(null);
    setSaving(true);
    try {
      const { preferences } = await updatePreferences(prefs);
      onSaved(preferences);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Seniority — REQUIRED */}
      <fieldset>
        <legend className="text-sm font-medium text-gray-900">
          Target Seniority <span className="text-red-500">*</span>
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {SENIORITY_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => toggleMulti("seniority_levels", opt)}
              className={`px-3 py-1 rounded-full text-sm border ${
                prefs.seniority_levels?.includes(opt)
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-700 border-gray-300 hover:border-blue-400"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
        {fieldErrors.seniority_levels && (
          <p className="mt-1 text-xs text-red-600">{fieldErrors.seniority_levels}</p>
        )}
      </fieldset>

      {/* Geographic preference — REQUIRED */}
      <fieldset>
        <legend className="text-sm font-medium text-gray-900">
          Geographic Preference <span className="text-red-500">*</span>
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {LOCATION_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setPrefs({ ...prefs, geographic_preference: opt })}
              className={`px-3 py-1 rounded-full text-sm border ${
                prefs.geographic_preference === opt
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-700 border-gray-300 hover:border-blue-400"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
        {fieldErrors.geographic_preference && (
          <p className="mt-1 text-xs text-red-600">{fieldErrors.geographic_preference}</p>
        )}
      </fieldset>

      {/* Company stage — optional */}
      <fieldset>
        <legend className="text-sm font-medium text-gray-900">Company Stage <span className="text-gray-400 font-normal">(optional)</span></legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {COMPANY_STAGE_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => toggleMulti("company_stages", opt)}
              className={`px-3 py-1 rounded-full text-sm border ${
                prefs.company_stages?.includes(opt)
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-700 border-gray-300 hover:border-blue-400"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      </fieldset>

      {/* Target companies — optional */}
      <div>
        <label className="text-sm font-medium text-gray-900">
          Target Companies <span className="text-gray-400 font-normal">(optional — one per line)</span>
        </label>
        <textarea
          rows={4}
          className="mt-2 w-full border rounded p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="JPMC India&#10;Walmart Global Tech&#10;Freshworks"
          value={(prefs.target_companies ?? []).join("\n")}
          onChange={(e) =>
            setPrefs({
              ...prefs,
              target_companies: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
            })
          }
        />
      </div>

      {/* Domains — optional */}
      <fieldset>
        <legend className="text-sm font-medium text-gray-900">Preferred Domains <span className="text-gray-400 font-normal">(optional)</span></legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {DOMAIN_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => toggleMulti("preferred_domains", opt)}
              className={`px-3 py-1 rounded-full text-sm border ${
                prefs.preferred_domains?.includes(opt)
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-700 border-gray-300 hover:border-blue-400"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save Preferences"}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/preferences/
git commit -m "feat: add PreferencesForm with required field validation"
```

---

## Task 15: PipelineReadinessIndicator and Settings page

**Files:**
- Create: `frontend/src/components/shared/PipelineReadinessIndicator.tsx`
- Create: `frontend/src/app/settings/page.tsx`

- [ ] **Step 1: Create `frontend/src/components/shared/PipelineReadinessIndicator.tsx`**

```typescript
import type { PipelineReadiness } from "@/types/candidate";

interface Props {
  readiness: PipelineReadiness;
}

export function PipelineReadinessIndicator({ readiness }: Props) {
  if (readiness.ready) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 rounded-lg">
        <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
        <span className="text-sm font-medium text-green-800">Pipeline ready to run</span>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg space-y-1">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
        <span className="text-sm font-medium text-amber-800">Pipeline not ready</span>
      </div>
      <ul className="ml-4 space-y-0.5">
        {readiness.missing.map((item) => (
          <li key={item} className="text-xs text-amber-700">• {item}</li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Create `frontend/src/app/settings/page.tsx`**

```typescript
"use client";

import { useEffect, useState } from "react";
import { getCV, getReadiness } from "@/lib/api";
import { CVUploader } from "@/components/cv/CVUploader";
import { MarkdownEditor } from "@/components/cv/MarkdownEditor";
import { ParseStatusBadge } from "@/components/cv/ParseStatusBadge";
import { PreferencesForm } from "@/components/preferences/PreferencesForm";
import { PipelineReadinessIndicator } from "@/components/shared/PipelineReadinessIndicator";
import type { Candidate, Preferences, PipelineReadiness } from "@/types/candidate";

export default function SettingsPage() {
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [convertedMarkdown, setConvertedMarkdown] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<PipelineReadiness | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const [cv, r] = await Promise.all([getCV(), getReadiness()]);
    setCandidate(cv);
    setReadiness(r);
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  function handleConverted(markdown: string) {
    setConvertedMarkdown(markdown);
  }

  function handleCVSaved(updated: Candidate) {
    setCandidate(updated);
    setConvertedMarkdown(null);
    refresh();
  }

  function handlePreferencesSaved(prefs: Preferences) {
    if (candidate) setCandidate({ ...candidate, preferences: prefs });
    refresh();
  }

  if (loading) return <div className="p-8 text-gray-500">Loading…</div>;

  const markdownToEdit = convertedMarkdown ?? candidate?.base_cv_md;

  return (
    <main className="max-w-3xl mx-auto p-8 space-y-10">
      <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>

      {readiness && <PipelineReadinessIndicator readiness={readiness} />}

      {/* CV Section */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-medium text-gray-800">CV</h2>
          {candidate && <ParseStatusBadge initialStatus={candidate.parse_status} />}
        </div>
        <CVUploader onConverted={handleConverted} />
        {markdownToEdit && (
          <MarkdownEditor
            initialMarkdown={markdownToEdit}
            onSaved={handleCVSaved}
          />
        )}
        {!markdownToEdit && candidate?.base_cv_md && (
          <p className="text-sm text-gray-500">
            CV saved. Re-upload to replace it.
          </p>
        )}
      </section>

      {/* Preferences Section */}
      <section className="space-y-4">
        <h2 className="text-lg font-medium text-gray-800">Preferences</h2>
        <PreferencesForm
          initialPreferences={candidate?.preferences ?? {}}
          onSaved={handlePreferencesSaved}
        />
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 4: Start dev server and verify the settings page loads**

```bash
# Terminal 1 — backend
cd backend && uv run uvicorn src.main:app --reload

# Terminal 2 — frontend
cd frontend && npm run dev
```

Open `http://localhost:3000/settings`. Verify:
- Pipeline readiness indicator shows (amber — not ready)
- Upload button is present
- Preferences form renders with all fields
- Upload a `.md` file → editor appears → edit → Save → parse badge appears

- [ ] **Step 5: Run full test suite**

```bash
cd backend && uv run pytest -v
```

Expected: All tests pass

- [ ] **Step 6: Final commit**

```bash
git add frontend/src/
git commit -m "feat: add settings page wiring CV upload, editor, parse badge, preferences, and readiness indicator"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| CV upload accepts .md, .docx, .pdf | Task 5 (`convert_to_markdown`), Task 6 (convert endpoint) |
| 10MB file size limit | Task 6 (MAX_FILE_SIZE constant) |
| Convert to Markdown, return to frontend | Task 6 (convert endpoint) |
| Inline Markdown editor before save | Task 12 (MarkdownEditor) |
| SHA256 hash computed on save | Task 4 (hash service), Task 7 (save endpoint) |
| No re-parse when hash unchanged | Task 7 (save endpoint hash comparison test) |
| Async background parse fires on save | Task 7 (`background_tasks.add_task`) |
| parse_status polling in UI | Task 13 (ParseStatusBadge) |
| Parse failure preserves prior profile | Task 8 (cv_parser.py — only overwrites on success) |
| Preferences stored as JSONB, partial update | Task 9 |
| Seniority + location required, rest optional | Task 14 (validate() in PreferencesForm) |
| Pipeline readiness gate | Task 10 (readiness endpoint), Task 15 (indicator) |
| `candidate_id` FK nullable (multi-user ready) | Task 3 (ORM model) |
| Settings page, two independent sections | Task 15 (settings/page.tsx) |

No gaps found.

**Placeholder scan:** No TBDs, TODOs, or "implement later" found.

**Type consistency:** `ParseStatus`, `Candidate`, `Preferences`, `PipelineReadiness` used consistently across types, API client, and all components. Backend `parse_status` enum values (`pending/parsing/ready/failed`) match frontend `ParseStatus` type exactly.

---

Plan complete and saved to `docs/superpowers/plans/2026-04-26-phase-1-foundation.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
