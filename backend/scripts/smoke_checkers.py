"""Rule 5 smoke test: load LettuceDetect + MiniCheck (HHEM fallback) on CPU and score a toy example."""
import sys
import time

sys.stdout.reconfigure(encoding="utf-8")
ctx = ["The Aquila X2 has a 2-year warranty. The UV LED module is covered for 3 years."]
ans = "The Aquila X2 has a 2-year warranty. It also includes free filters for life."

t = time.time()
from lettucedetect.models.inference import HallucinationDetector
det = HallucinationDetector(method="transformer", model_path="KRLabsOrg/lettucedect-base-modernbert-en-v1", device="cpu")
print("lettuce spans:", det.predict(context=ctx, question="What is the warranty?", answer=ans, output_format="spans"),
      f"{time.time() - t:.0f}s")

t = time.time()
try:
    from minicheck.minicheck import MiniCheck
    mc = MiniCheck(model_name="flan-t5-large", cache_dir=None)
    labels, probs, _, _ = mc.score(docs=[ctx[0], ctx[0]], claims=["The Aquila X2 has a 2-year warranty.",
                                                                 "It also includes free filters for life."])
    print("minicheck:", labels, [round(float(p), 3) for p in probs], f"{time.time() - t:.0f}s")
except Exception as e:
    print("MINICHECK FAILED:", repr(e)[:300])
    from transformers import AutoModelForSequenceClassification
    m = AutoModelForSequenceClassification.from_pretrained("vectara/hallucination_evaluation_model", trust_remote_code=True)
    print("hhem:", m.predict([(ctx[0], "The Aquila X2 has a 2-year warranty."), (ctx[0], "It includes free filters for life.")]))
