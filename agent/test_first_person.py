import asyncio, os, sys
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'), override=True)
sys.path.insert(0, os.path.dirname(__file__))

from agent.config import settings
from agent.nodes.outreach_mailer import litellm_generate

state = {
    'job_id': 'test', 'candidate_id': 'test',
    'company': 'Cognizant',
    'job_title': 'Director - Transformation Head',
    'archetype': 'GCC AI Practice Head',
    'archetype_confidence': 0.9,
    'hiring_manager_name': 'Nandhini N',
    'cadence_id': 'test',
    'discovered_email': 'nandhini.n@cognizant.com',
    'email_confidence': 99, 'email_source': 'domain_search',
    'subject': None, 'day1_body': None, 'day3_body': None,
    'day7_body': None, 'generation_attempts': 0,
    'status': 'generating', 'error': None,
}

async def main():
    draft = await litellm_generate(state, settings)

    print(f"Subject: {draft.subject}")
    print()
    print("=== DAY 1 ===")
    print(draft.day1_body)
    print()
    print("=== DAY 3 ===")
    print(draft.day3_body)
    print()
    print("=== DAY 7 ===")
    print(draft.day7_body)
    print()

    print("=== VOICE CHECK ===")
    third_person_phrases = ['the candidate', 'this individual', 'they are eager', 'their background', 'this person']
    all_ok = True
    for day, body in [('Day 1', draft.day1_body), ('Day 3', draft.day3_body), ('Day 7', draft.day7_body)]:
        has_first  = any(p in body for p in ['I ', "I've", 'I am', 'I have', 'My ', 'my '])
        has_third  = any(p in body.lower() for p in third_person_phrases)
        ok = has_first and not has_third
        all_ok = all_ok and ok
        icon = 'PASS' if ok else 'FAIL'
        print(f"  [{icon}] {day}: first_person={has_first} third_person_leak={has_third}")

    print()
    print("Overall voice: CORRECT (candidate writes directly)" if all_ok else "PROBLEM: still third-person")

asyncio.run(main())
