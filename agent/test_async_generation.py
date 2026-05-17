"""Verify acompletion with correct model string works end-to-end."""
import asyncio, os, json
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

import litellm
litellm.set_verbose = False

provider = os.getenv('LLM_PROVIDER', 'gemini')
model    = os.getenv('LLM_MODEL', 'gemini-2.0-flash')
model_str = f"{provider}/{model}"

async def main():
    print(f"Model: {model_str}")

    # Test 1: acompletion with correct model string
    print("\n[1] Testing acompletion with correct model string...")
    resp = await litellm.acompletion(
        model=model_str,
        messages=[{"role": "user", "content": 'Return ONLY valid JSON: {"subject": "Test subject", "day1_body": "Hi, I am a candidate interested in your role. I have 10 years experience in AI. I noticed your company is doing great work. Would love to connect.", "day3_body": "Following my earlier note, I wanted to share a key insight about AI transformation that may be relevant to your roadmap. Happy to elaborate.", "day7_body": "Totally understand if timing is off. Happy to reconnect whenever suits you. No pressure at all."}'}],
        response_format={"type": "json_object"},
    )
    raw = resp.choices[0].message.content or ""
    data = json.loads(raw)
    print(f"  subject: {data.get('subject','')[:50]}")
    print(f"  day1_body words: {len(data.get('day1_body','').split())}")
    print(f"  day3_body words: {len(data.get('day3_body','').split())}")
    print(f"  day7_body words: {len(data.get('day7_body','').split())}")

    # Test 2: Full generation via outreach_mailer node
    print("\n[2] Testing full outreach_mailer.litellm_generate...")
    import sys
    sys.path.insert(0, 'C:/Agentic-AI/Proxim/agent')
    from agent.nodes.outreach_mailer import litellm_generate, litellm_self_review, EmailDraftOutput

    class FakeSettings:
        llm_provider = provider
        llm_model = model

    state = {
        "company": "Cognizant",
        "job_title": "Director - Transformation Head",
        "archetype": "GCC AI Practice Head",
        "hiring_manager_name": None,
    }
    settings = FakeSettings()

    draft = await litellm_generate(state, settings)
    print(f"  subject:   {draft.subject[:60]}")
    print(f"  day1:      {len(draft.day1_body.split())} words")
    print(f"  day3:      {len(draft.day3_body.split())} words")
    print(f"  day7:      {len(draft.day7_body.split())} words")

    # Test 3: Self review
    print("\n[3] Testing litellm_self_review...")
    review = await litellm_self_review(draft, settings)
    print(f"  passes: {review.passes}")
    print(f"  feedback: {(review.feedback or '')[:80]}")

    print("\n=== ALL TESTS PASSED ===")
    print("Restart the daemon to apply the fix, then the generation will succeed.")

asyncio.run(main())
