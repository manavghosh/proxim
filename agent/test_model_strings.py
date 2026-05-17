import litellm, os, time
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

litellm.set_verbose = False

tests = [
    ("OLD (no prefix)", "gemini-2.0-flash"),
    ("NEW (with prefix)", "gemini/gemini-2.0-flash"),
]

for label, model in tests:
    print(f"\nTesting {label}: model={model}")
    start = time.time()
    try:
        resp = litellm.completion(
            model=model,
            messages=[{"role": "user", "content": "Say: hello"}],
            max_tokens=20,
        )
        content = resp.choices[0].message.content
        print(f"  SUCCESS in {time.time()-start:.1f}s: {content[:50]}")
    except Exception as e:
        print(f"  FAIL in {time.time()-start:.1f}s: [{type(e).__name__}] {str(e)[:150]}")
