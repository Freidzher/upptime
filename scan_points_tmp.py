import json
from datetime import datetime, timezone

for s in ("server1", "server2", "server3", "server6"):
    pts = json.load(open(f"api/{s}/points.json", encoding="utf-8"))
    print(s, "total", len(pts))
    prev = None
    for p in pts:
        t = datetime.fromisoformat(p["ts"])
        if prev and (t - prev).total_seconds() > 600:
            print("  hole:", prev.isoformat(), "->", t.isoformat(), "=", round((t - prev).total_seconds() / 60), "min")
        prev = t
    # последние 3 точки
    for p in pts[-3:]:
        print("  tail:", p["ts"], p["ok"], p["code"], p["ms"])