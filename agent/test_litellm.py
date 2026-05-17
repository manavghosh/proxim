import os, sys
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

provider = os.getenv('LLM_PROVIDER', 'gemini')
model    = os.getenv('LLM_MODEL', 'gemini-2.0-flash')
key      = os.getenv('GEMINI_API_KEY', '')
model_str = f"{provider}/{model}"

print(f"provider={provider}")
print(f"model={model}")
print(f"key present={bool(key)} length={len(key)}")
print(f"model_str={model_str}")
print()

import litellm
litellm.set_verbose = False

print("Calling litellm.completion...")
try:
    resp = litellm.completion(
        model=model_str,
        messages=[{"role": "user", "content": 'Return only valid JSON: {"test": true, "message": "hello"}'}],
        response_format={"type": "json_object"},
    )
    content = resp.choices[0].message.content
    print(f"SUCCESS: {content[:200]}")
except Exception as e:
    print(f"FAIL [{type(e).__name__}]: {str(e)[:400]}")
