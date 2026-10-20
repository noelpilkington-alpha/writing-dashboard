"""Compare the freshly written data/2026-27/data.json with the committed HEAD version."""
import json, subprocess, sys
from collections import Counter
new = json.load(open("data/2026-27/data.json", encoding="utf-8"))
old = json.loads(subprocess.run(["git", "show", "HEAD:data/2026-27/data.json"], capture_output=True, text=True, encoding="utf-8").stdout)
print("as_of  old", old["as_of"], " new", new["as_of"], " | session", new.get("session"))
on = {s["email"].lower(): s for s in old["students"]}; nn = {s["email"].lower(): s for s in new["students"]}
print(f"students old {len(on)}  new {len(nn)}  added {len(set(nn)-set(on))}  dropped {len(set(on)-set(nn))}")
print("fetch_failures new:", len(new.get("fetch_failures", [])))
def stat(label, f):
    o = [f(s) for s in old["students"]]; n = [f(s) for s in new["students"]]
    print(f"{label:28s} old {sum(x or 0 for x in o):>10,}   new {sum(x or 0 for x in n):>10,}")
stat("sum xp", lambda s: (s.get("xp") or {}).get("total") if isinstance(s.get("xp"), dict) else s.get("xp"))
stat("students with >=1 test", lambda s: 1 if s.get("all_tests") else 0)
stat("total tests", lambda s: len(s.get("all_tests") or []))
stat("deep dives", lambda s: 1 if (s.get("deep_dive") or {}).get("details") else 0)
stat("completed G8", lambda s: 1 if s.get("completed_g8") else 0)
stat("grades advanced", lambda s: s.get("grades_advanced") or 0)
up = down = same = 0; downs = []
for e, s in nn.items():
    if e in on and on[e].get("hmg") is not None and s.get("hmg") is not None:
        d = s["hmg"] - on[e]["hmg"]
        if d > 0: up += 1
        elif d < 0: down += 1; downs.append((s["name"], on[e]["hmg"], s["hmg"], len(on[e].get("all_tests") or []), len(s.get("all_tests") or [])))
        else: same += 1
print(f"HMG vs HEAD: up {up}  down {down}  same {same}")
for row in downs[:25]: print("   HMG down:", row)
print("HMG dist new:", sorted(Counter(s.get("hmg") for s in new["students"]).items(), key=lambda kv: (kv[0] is None, kv[0])))
print("campus top:", Counter(s.get("campus") for s in new["students"]).most_common(8))
inact = Counter((s.get("inactivity") or {}).get("flag") or (s.get("inactivity") or {}).get("status") for s in new["students"])
print("inactivity:", inact.most_common(5))
