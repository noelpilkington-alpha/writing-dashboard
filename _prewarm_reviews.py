"""One-off: pre-fetch review documents for every failed test in the current loop
population so the loop collector run hits the disk cache. Safe to re-run."""
import json, logging, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from writing_automation.review_fetcher import fetch_review
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("prewarm")
data = json.load(open(Path(__file__).resolve().parent / "data/2026-27/data.json", encoding="utf-8"))
jobs = {}
for s in data["students"]:
    for dd in s.get("deep_dive", {}).get("details", []):
        for t in dd.get("tests", []):
            for at in s.get("all_tests", []):
                if at.get("name") == t.get("name") and at.get("date") == t.get("date") and at.get("assignment_id"):
                    jobs[at["assignment_id"]] = (at.get("score"), at.get("date"))
log.info("%d distinct attempts to warm", len(jobs))
ok = none = 0
t0 = time.time()
with ThreadPoolExecutor(max_workers=4) as ex:
    futs = {ex.submit(fetch_review, aid, score=sc, score_date=dt): aid for aid, (sc, dt) in jobs.items()}
    for i, f in enumerate(as_completed(futs), 1):
        try:
            md = f.result()
        except Exception as e:
            log.warning("aid %s: %s", futs[f], e); md = None
        if md: ok += 1
        else: none += 1
        if i % 20 == 0:
            log.info("progress %d/%d (ok=%d none=%d, %.0fs)", i, len(jobs), ok, none, time.time() - t0)
log.info("done: ok=%d none=%d in %.0fs", ok, none, time.time() - t0)
