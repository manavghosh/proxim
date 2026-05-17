"""
Test the Gemini API key against all 4 LLM use cases in the Python agent:
  1. Scoring engine  (scoring_engine.py)
  2. Resume engine   (resume_engine.py)
  3. LinkedIn notes  (nodes/linkedin_connector.py)
  4. Email drafts    (nodes/outreach_mailer.py)
"""
import os, sys, json, time, asyncio
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'), override=True)
sys.path.insert(0, os.path.dirname(__file__))

import litellm
litellm.set_verbose = False

from agent.config import settings

MODEL    = f"{settings.llm_provider}/{settings.llm_model}"
API_KEY  = settings.gemini_api_key if settings.llm_provider == "gemini" else settings.anthropic_api_key

print(f"Provider : {settings.llm_provider}")
print(f"Model    : {settings.llm_model}")
print(f"API key  : {API_KEY[:8]}...{API_KEY[-4:]} ({len(API_KEY)} chars)")
print(f"Full str : {MODEL}")
print()

results = {}

def check(label, ok, detail=""):
    icon = "PASS" if ok else "FAIL"
    print(f"  [{icon}] {label}" + (f" — {detail}" if detail else ""))
    results[label] = ok
    return ok


# ── 1. SCORING ENGINE ─────────────────────────────────────────────────────────
print("=" * 60)
print("1. Scoring Engine (scoring_engine.py)")
print("   Uses: litellm.completion + explicit api_key")
print("=" * 60)
try:
    t = time.time()
    resp = litellm.completion(
        model=MODEL,
        api_key=API_KEY,
        messages=[{"role": "user", "content":
            'Return ONLY valid JSON with this exact structure (short values ok): '
            '{"gate": {"roleLevelMatch": {"score": 4, "reasoning": "good fit"}, '
            '"aiStackAlignment": {"score": 4, "reasoning": "aligned"}}, '
            '"weighted": {"compensation": {"score": 4, "reasoning": "ok"}, '
            '"companyStage": {"score": 3, "reasoning": "ok"}, '
            '"interviewProbability": {"score": 4, "reasoning": "ok"}, '
            '"thoughtLeadership": {"score": 4, "reasoning": "ok"}, '
            '"geography": {"score": 5, "reasoning": "match"}, '
            '"growthTrajectory": {"score": 3, "reasoning": "ok"}, '
            '"domainResonance": {"score": 4, "reasoning": "ok"}, '
            '"hiringUrgency": {"score": 3, "reasoning": "ok"}}, '
            '"summary": "Good fit", "grade": "B", "archetype": "AI Leader"}'
        }],
        response_format={"type": "json_object"},
        temperature=0.1,
        max_tokens=500,
    )
    data = json.loads(resp.choices[0].message.content)
    elapsed = time.time() - t
    has_gate   = "gate" in data
    has_weighted = "weighted" in data
    check("Scoring engine: returns structured JSON",  has_gate and has_weighted,
          f"{elapsed:.1f}s — grade={data.get('grade','?')}")
except Exception as e:
    check("Scoring engine: returns structured JSON", False, str(e)[:100])

# ── 2. RESUME ENGINE ──────────────────────────────────────────────────────────
print()
print("=" * 60)
print("2. Resume Engine (resume_engine.py)")
print("   Uses: litellm.completion + explicit api_key")
print("=" * 60)
try:
    t = time.time()
    resp = litellm.completion(
        model=MODEL,
        api_key=API_KEY,
        messages=[{"role": "user", "content":
            'Return ONLY valid JSON: {"headline": "Senior AI Leader", '
            '"summary": "15 years driving AI transformation.", '
            '"bullets": ["Led 50-person AI team", "Delivered $10M savings"]}'
        }],
        response_format={"type": "json_object"},
        temperature=0.2,
        max_tokens=300,
    )
    data = json.loads(resp.choices[0].message.content)
    elapsed = time.time() - t
    check("Resume engine: returns personalised content",
          "headline" in data and "bullets" in data,
          f"{elapsed:.1f}s — headline='{data.get('headline','?')[:40]}'")
except Exception as e:
    check("Resume engine: returns personalised content", False, str(e)[:100])

# ── 3. LINKEDIN NOTES ─────────────────────────────────────────────────────────
print()
print("=" * 60)
print("3. LinkedIn Notes (linkedin_connector.py)")
print("   Uses: litellm.completion WITHOUT explicit api_key (env var only)")
print("=" * 60)
try:
    t = time.time()
    # This mirrors linkedin_connector.py exactly — no api_key param
    resp = litellm.completion(
        model="gemini/gemini-2.0-flash",
        messages=[{"role": "user", "content":
            'Return ONLY valid JSON: {"note_a": "Hi Sarah, I noticed your work on AI at Cognizant. '
            'Would love to connect and share insights.", '
            '"note_b": "Sarah, your leadership in digital transformation is impressive. '
            'Happy to exchange ideas."}'
        }],
        response_format={"type": "json_object"},
    )
    data = json.loads(resp.choices[0].message.content)
    elapsed = time.time() - t
    check("LinkedIn notes: works WITHOUT explicit api_key",
          "note_a" in data and "note_b" in data,
          f"{elapsed:.1f}s — env var picked up correctly")
except Exception as e:
    check("LinkedIn notes: works WITHOUT explicit api_key", False, str(e)[:100])
    # Diagnose
    env_key = os.environ.get("GEMINI_API_KEY", "")
    print(f"  GEMINI_API_KEY in os.environ: {'YES' if env_key else 'NO (pydantic-settings does not set os.environ)'}")

# ── 4. EMAIL GENERATION (acompletion, no explicit key) ────────────────────────
print()
print("=" * 60)
print("4. Outreach Mailer (nodes/outreach_mailer.py)")
print("   Uses: litellm.acompletion WITHOUT explicit api_key")
print("=" * 60)
async def test_acompletion():
    t = time.time()
    resp = await litellm.acompletion(
        model=MODEL,
        messages=[{"role": "user", "content":
            'Return ONLY valid JSON: {"subject": "AI Leadership at Cognizant", '
            '"day1_body": "Hi, I am a GCC AI Practice Head reaching out about your Director role. '
            'Your work on enterprise AI transformation is impressive.", '
            '"day3_body": "One insight from recent deployments: structured AI governance reduces '
            'risk by 40 percent. Happy to share specifics.", '
            '"day7_body": "Totally understand if timing is off. Happy to reconnect whenever."}'
        }],
        response_format={"type": "json_object"},
    )
    data = json.loads(resp.choices[0].message.content)
    elapsed = time.time() - t
    return data, elapsed

try:
    data, elapsed = asyncio.run(test_acompletion())
    check("Email drafts: acompletion WITHOUT explicit api_key",
          "subject" in data and "day1_body" in data,
          f"{elapsed:.1f}s — subject='{data.get('subject','?')[:40]}'")
except Exception as e:
    check("Email drafts: acompletion WITHOUT explicit api_key", False, str(e)[:100])
    env_key = os.environ.get("GEMINI_API_KEY", "")
    print(f"  GEMINI_API_KEY in os.environ: {'YES' if env_key else 'NO'}")
    print(f"  Fix needed: pass api_key=settings.gemini_api_key explicitly")

# ── 5. EMAIL GENERATION (with explicit api_key — the fix) ────────────────────
print()
print("=" * 60)
print("5. Email Drafts WITH explicit api_key (proposed fix)")
print("=" * 60)
async def test_acompletion_with_key():
    t = time.time()
    resp = await litellm.acompletion(
        model=MODEL,
        api_key=API_KEY,
        messages=[{"role": "user", "content":
            'Return ONLY valid JSON: {"subject": "AI Leadership opportunity", '
            '"day1_body": "Hi, reaching out about the Director - Transformation Head role. '
            'My experience leading GCC AI practices could be valuable.", '
            '"day3_body": "A quick insight: AI-first transformation delivers 3x faster outcomes. '
            'Happy to elaborate.", '
            '"day7_body": "No rush at all. Happy to connect whenever timing works."}'
        }],
        response_format={"type": "json_object"},
    )
    data = json.loads(resp.choices[0].message.content)
    return data, time.time() - t

try:
    data, elapsed = asyncio.run(test_acompletion_with_key())
    check("Email drafts: acompletion WITH explicit api_key",
          "subject" in data and "day1_body" in data,
          f"{elapsed:.1f}s — subject='{data.get('subject','?')[:40]}'")
except Exception as e:
    check("Email drafts: acompletion WITH explicit api_key", False, str(e)[:100])

# ── Next.js CV Parser (informational) ─────────────────────────────────────────
print()
print("=" * 60)
print("6. Next.js CV Parser (src/lib/llm.ts + cv-parser.ts)")
print("   Uses: @ai-sdk/google with GEMINI_API_KEY from .env.local")
print("=" * 60)
env_local = "C:/Agentic-AI/Proxim/.env.local"
if os.path.exists(env_local):
    with open(env_local) as f:
        lines = [l.strip() for l in f if 'GEMINI' in l or 'LLM' in l]
    for l in lines:
        parts = l.split('=', 1)
        if len(parts) == 2 and 'KEY' in parts[0]:
            print(f"  {parts[0]}={parts[1][:8]}...{parts[1][-4:]}")
        else:
            print(f"  {l}")
    print("  (tested separately via Next.js API — not testable from Python)")
    check("CV parser config: .env.local has LLM vars", bool(lines), f"{len(lines)} vars found")
else:
    print(f"  .env.local not found at {env_local}")
    check("CV parser config: .env.local exists", False, "file missing")

# ── Summary ───────────────────────────────────────────────────────────────────
print()
print("=" * 60)
print("  SUMMARY")
print("=" * 60)
passed = sum(1 for v in results.values() if v)
total  = len(results)
for name, val in results.items():
    print(f"  [{'PASS' if val else 'FAIL'}] {name}")
print(f"\n  {passed}/{total} passed")

if not results.get("LinkedIn notes: works WITHOUT explicit api_key") or \
   not results.get("Email drafts: acompletion WITHOUT explicit api_key"):
    print()
    print("  ACTION NEEDED:")
    print("  linkedin_connector.py and outreach_mailer.py must pass api_key explicitly.")
    print("  scoring_engine.py pattern: api_key=settings.gemini_api_key")
