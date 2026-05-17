"""Test the actual email generation prompt to see what Gemini returns."""
import os, json, re
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

import litellm
litellm.set_verbose = False

provider = os.getenv('LLM_PROVIDER', 'gemini')
model    = os.getenv('LLM_MODEL', 'gemini-2.0-flash')
model_str = f"{provider}/{model}"

# Replicate the exact prompt from generate_emails_node
prompt = (
    "You are a professional career coach writing outreach emails for a job seeker.\n"
    "Write a 3-email cadence to a hiring manager at Cognizant.\n"
    "Role applied for: Director - Transformation Head\n"
    "Candidate profile: GCC AI Practice Head\n"
    "Hiring manager name: the hiring manager\n\n"
    "Rules:\n"
    "- day1_body: introduce the candidate, mention something specific about the company, max 150 words\n"
    "- day3_body: add a specific value insight relevant to their work, max 100 words, "
    "do NOT use phrases: 'following up', 'checking in', 'just following', 'just checking'\n"
    "- day7_body: gentle close, leave door open, max 80 words, "
    "no pressure phrases like 'last chance', 'urgent', 'final'\n"
    "- subject: one concise subject line for all three emails\n\n"
    'Return ONLY valid JSON: {"subject": "...", "day1_body": "...", "day3_body": "...", "day7_body": "..."}'
)

print("=== Testing email generation prompt ===\n")

resp = litellm.completion(
    model=model_str,
    messages=[{"role": "user", "content": prompt}],
    response_format={"type": "json_object"},
)

raw = resp.choices[0].message.content or ""
print(f"Raw response ({len(raw)} chars):\n{raw[:500]}\n")

# Try to parse
try:
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1]
        if text.endswith("```"):
            text = text[:text.rfind("```")]
    data = json.loads(text.strip())
    print("JSON parsed OK")
    print(f"  subject:   {data.get('subject','')[:70]}")

    def wc(s): return len(s.split())

    d1 = data.get('day1_body','')
    d3 = data.get('day3_body','')
    d7 = data.get('day7_body','')

    print(f"  day1_body: {wc(d1)} words {'OK' if wc(d1) <= 150 else 'OVER LIMIT!'}")
    print(f"  day3_body: {wc(d3)} words {'OK' if wc(d3) <= 100 else 'OVER LIMIT!'}")
    print(f"  day7_body: {wc(d7)} words {'OK' if wc(d7) <= 80 else 'OVER LIMIT!'}")

    # Check forbidden phrases
    d3_forbidden = ["following up", "checking in", "just following", "just checking"]
    d7_pressure  = ["last chance", "final follow-up", "urgent", "time-sensitive"]
    for phrase in d3_forbidden:
        if phrase.lower() in d3.lower():
            print(f"  day3 FORBIDDEN PHRASE: '{phrase}'")
    for phrase in d7_pressure:
        if phrase.lower() in d7.lower():
            print(f"  day7 PRESSURE PHRASE: '{phrase}'")

    # Try Pydantic validation
    import sys
    sys.path.insert(0, 'C:/Agentic-AI/Proxim/agent')
    from agent.nodes.outreach_mailer import EmailDraftOutput
    try:
        draft = EmailDraftOutput(**data)
        print("\nPydantic validation: PASS")
        print("  Generation would SUCCEED")
    except Exception as e:
        print(f"\nPydantic validation: FAIL - {e}")
        print("  This is why generation keeps failing after 3 attempts!")

except Exception as e:
    print(f"JSON parse error: {e}")
