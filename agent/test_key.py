import os, litellm
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'), override=True)

provider = os.getenv('LLM_PROVIDER', '')
model    = os.getenv('LLM_MODEL', '')
model_str = f"{provider}/{model}"
print(f'Model: {model_str}')

litellm.set_verbose = False
try:
    resp = litellm.completion(
        model=model_str,
        messages=[{'role': 'user', 'content': 'Return ONLY valid JSON: {"subject": "Test", "day1_body": "Hi, I am reaching out regarding the Director role at Cognizant. I have 15 years experience in AI transformation and GCC practice leadership. Would love to connect.", "day3_body": "A quick insight from recent GCC deployments: structured AI governance cuts risk by 40 percent in large enterprises. Happy to share specifics if useful.", "day7_body": "Totally understand if timing is not right. Happy to reconnect whenever suits you. No pressure at all."}'}],
        response_format={'type': 'json_object'},
        max_tokens=500,
    )
    import json
    data = json.loads(resp.choices[0].message.content)
    print(f'SUCCESS')
    print(f'  subject:   {data.get("subject","")[:60]}')
    print(f'  day1_body: {len(data.get("day1_body","").split())} words')
    print(f'  day3_body: {len(data.get("day3_body","").split())} words')
    print(f'  day7_body: {len(data.get("day7_body","").split())} words')
except Exception as e:
    print(f'FAIL [{type(e).__name__}]: {str(e)[:200]}')
