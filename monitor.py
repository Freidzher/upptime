#!/usr/bin/env python3
"""Runicore Monitor — собственная система мониторинга доступности.

Хранение как у Upptime:
  history/{slug}.yml      — последняя проверка сайта (YAML)
  history/summary.json    — агрегированная сводка (аптайм/время за day/week/month/year)
  api/{slug}/points.json  — сырые точки {ts, ok, code, ms} (для графиков)
  api/{slug}/favicon.ico  — иконка сайта (скачивается при проверке; домен нигде не публикуется)
  api/{slug}/uptime*.json, api/{slug}/response-time*.json — бейджи shields-style
  api/incidents.json      — открытые инциденты
  api/incidents-log.json  — журнал закрытых инцидентов

Конфиг: config.json (owner, repo, names, interval_minutes, history_days, timeout).
Секреты приходят через SECRETS_CONTEXT (Actions) или .env (локально).
Служебные (FINE_GRAINED_TOKEN, GH_TOKEN) исключаются. URL нигде не публикуются.
Автор: Freidzher
"""
import json
import os
import time
import urllib.request
import urllib.error
import urllib.parse
import ssl
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).parent
CONFIG_FILE = ROOT / "config.json"
HISTORY_DIR = ROOT / "history"
API_DIR = ROOT / "api"
ENV_FILE = ROOT / ".env"

SERVICE_KEYS = {"FINE_GRAINED_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"}
ctx = ssl.create_default_context()


def repo_slug(config: dict) -> str:
    if not config.get("owner") or not config.get("repo"):
        raise SystemExit("Укажите owner и repo в config.json")
    return f"{config['owner']}/{config['repo']}"


def load_env() -> None:
    if not ENV_FILE.exists():
        return
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


def load_secrets() -> dict:
    raw = os.environ.get("SECRETS_CONTEXT")
    if raw:
        try:
            data = json.loads(raw)
            return {k: v for k, v in data.items() if v}
        except json.JSONDecodeError:
            pass
    return dict(os.environ)


def pretty_name(key: str) -> str:
    return key.replace("_", " ").strip().title()


def slugify(key: str) -> str:
    return key.strip().lower().replace("_", "-")


def discover_sites(config: dict, secrets: dict) -> dict:
    custom = config.get("names", {})
    sites = {}
    for key, value in secrets.items():
        if key in SERVICE_KEYS or key.startswith(("GITHUB_", "RUNNER_", "CI")):
            continue
        if not value or not value.startswith(("http://", "https://")):
            continue
        sites[key] = {
            "slug": slugify(key),
            "name": custom.get(key, pretty_name(key)),
            "url": value,
            "timeout": config.get("timeout", 10),
        }
    return sites


def fetch_favicon(url: str, dest: Path, timeout: int = 10) -> bool:
    """Скачивает favicon по конечному пути (следуя редиректам) в api/{slug}/favicon.ico.

    Порядок: /favicon.ico исходного URL (с редиректами), затем DuckDuckGo.
    Домен сайта нигде не публикуется — иконка хранится локально в репо.
    """
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    final_url = url
    try:
        # Разрешаем редиректы вручную, чтобы узнать конечный URL
        opener = urllib.request.build_opener(NoRedirect)
        req = urllib.request.Request(url, headers={"User-Agent": "RunicoreMonitor/1.0"})
        try:
            with opener.open(req, timeout=timeout) as resp:
                if 300 <= resp.status < 400:
                    final_url = resp.headers.get("Location") or url
        except urllib.error.HTTPError as e:
            if 300 <= e.code < 400:
                final_url = e.headers.get("Location") or url

        host = urllib.parse.urlparse(final_url).netloc or urllib.parse.urlparse(url).netloc
        base = "{0.scheme}://{0.netloc}".format(urllib.parse.urlparse(final_url))
        candidates = (
            f"{base}/favicon.ico",
            f"https://icons.duckduckgo.com/ip3/{urllib.parse.urlparse(final_url).netloc}.ico",
        )
        for icon_url in candidates:
            try:
                # urlopen сам следует редиректам
                req = urllib.request.Request(icon_url, headers={"User-Agent": "RunicoreMonitor/1.0"})
                with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
                    data = resp.read()
                if data and len(data) > 100:
                    dest.write_bytes(data)
                    return True
            except Exception:
                continue
    except Exception:
        pass
    return False


def check_site(name: str, url: str, timeout: int = 10) -> dict:
    start = time.monotonic()
    ok, code = False, 0
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "RunicoreMonitor/1.0"})
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            code, ok = resp.status, 200 <= resp.status < 400
    except urllib.error.HTTPError as e:
        code = e.code
    except Exception:
        pass
    ms = round((time.monotonic() - start) * 1000)
    print(f"{name}: {'UP' if ok else 'DOWN'} ({code}) {ms}ms")
    return {"ts": datetime.now(timezone.utc).isoformat(timespec="seconds"), "ok": ok, "code": code, "ms": ms}


def gh_api(path: str, method: str = "GET", payload=None):
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if not token:
        return None
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(f"https://api.github.com{path}", data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", "application/vnd.github+json")
    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read()
            return json.loads(body) if body else None
    except Exception as e:
        print("GitHub API error:", e)
        return None


def load_json(path: Path, default):
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return default
    return default


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


def load_log() -> list:
    return load_json(API_DIR / "incidents-log.json", [])


def open_incident(key: str, name: str, result: dict, incidents: dict, repo: str) -> None:
    issue = gh_api(f"/repos/{repo}/issues", "POST", {
        "title": f"{name} is down",
        "body": (
            f"**{name}** недоступен.\n\n"
            f"- Время: {result['ts']}\n"
            f"- HTTP code: {result['code']}\n"
            f"- Response time: {result['ms']} ms\n\n"
            f"Комментарии — репорты инцидента. Закроется автоматически при восстановлении."
        ),
        "labels": ["incident"],
    })
    if issue:
        incidents[key] = {"issue_number": issue["number"], "opened": result["ts"], "name": name}
        print(f"Incident issue #{issue['number']} opened for {name}")


def close_incident(key: str, incidents: dict, last_ok_ts: str, repo: str) -> None:
    info = incidents.pop(key, None)
    if not info:
        return
    num = info["issue_number"]
    opened = datetime.fromisoformat(info["opened"]).replace(tzinfo=timezone.utc)
    closed = datetime.fromisoformat(last_ok_ts).replace(tzinfo=timezone.utc)
    minutes = max(1, round((closed - opened).total_seconds() / 60))
    gh_api(f"/repos/{repo}/issues/{num}", "POST", {
        "body": f"✅ {info.get('name', key)} восстановлено в {last_ok_ts}. Устранено за ~{minutes} мин."
    })
    gh_api(f"/repos/{repo}/issues/{num}", "PATCH", {"state": "closed"})
    log = load_log()
    log.append({
        "name": info.get("name", key),
        "slug": slugify(key),
        "issue_number": num,
        "opened": info["opened"],
        "resolved": last_ok_ts,
        "minutes": minutes,
    })
    write_json(API_DIR / "incidents-log.json", log[-100:])
    print(f"Incident issue #{num} closed for {key}")


# ---------- Хранение в стиле Upptime ----------

def badge(label: str, message: str, color: str) -> dict:
    return {"schemaVersion": 1, "label": label, "message": message, "color": color}


def pct_color(p: float) -> str:
    if p >= 99.5:
        return "brightgreen"
    if p >= 95:
        return "green"
    if p >= 90:
        return "yellowgreen"
    if p >= 80:
        return "orange"
    return "red"


def rt_color(ms: float) -> str:
    if ms < 300:
        return "brightgreen"
    if ms < 800:
        return "green"
    if ms < 1000:
        return "yellow"
    return "red"


def window(points: list, hours: float) -> list:
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).timestamp()
    return [p for p in points if _ts(p) > cutoff]


def _ts(p: dict) -> float:
    return datetime.fromisoformat(p["ts"]).timestamp()


def uptime_pct(points: list, hours: float) -> float:
    w = window(points, hours)
    if not w:
        return 100.0
    return 100.0 * sum(1 for p in w if p["ok"]) / len(w)


def avg_ms(points: list, hours: float) -> float:
    w = [p for p in window(points, hours) if p["ok"]]
    return round(sum(p["ms"] for p in w) / len(w)) if w else 0


def daily_minutes_down(points_list: list, interval_min: int) -> dict:
    """Примерное время простоя по дням: failed-проверки * интервал."""
    out = {}
    for p in points_list:
        if not p["ok"]:
            day = p["ts"][:10]
            out[day] = out.get(day, 0) + interval_min
    return out


def write_site_files(slug: str, points: list, last: dict) -> None:
    api = API_DIR / slug
    api.mkdir(parents=True, exist_ok=True)

    # Сырые точки для графиков (хранится 90 дней)
    max_points = 90 * 24 * 12
    write_json(api / "points.json", points[-max_points:])

    # Последняя проверка (history/{slug}.yml, как у Upptime, но без URL)
    start_time = points[0]["ts"] if points else last["ts"]
    (HISTORY_DIR / f"{slug}.yml").write_text(
        f"status: {'up' if last['ok'] else 'down'}\n"
        f"code: {last['code']}\n"
        f"responseTime: {last['ms']}\n"
        f"lastUpdated: {last['ts']}\n"
        f"startTime: {start_time}\n"
        f"generator: Runicore\n",
        encoding="utf-8",
    )

    # Бейджи
    windows = {"": 24 * 365, "-day": 24, "-week": 24 * 7, "-month": 24 * 30, "-year": 24 * 365}
    labels = {"": "", "-day": " 24h", "-week": " 7d", "-month": " 30d", "-year": " 1y"}
    for suffix, hours in windows.items():
        p = uptime_pct(points, hours) if points else 100.0
        write_json(api / f"uptime{suffix}.json",
                   badge(f"uptime{labels[suffix]}", f"{p:.2f}%", pct_color(p)))
        m = avg_ms(points, hours)
        if m:
            write_json(api / f"response-time{suffix}.json",
                       badge(f"response time{labels[suffix]}", f"{m} ms", rt_color(m)))


def build_summary(sites: dict, history_points: dict, interval_min: int) -> list:
    summary = []
    for key, site in sites.items():
        slug = site["slug"]
        points = history_points.get(slug, [])
        last = points[-1] if points else {"ok": True, "ms": 0, "code": 0, "ts": ""}
        summary.append({
            "name": site["name"],
            "slug": slug,
            "status": "up" if (points and last["ok"]) else "down",
            "uptime": f"{uptime_pct(points, 24 * 90):.2f}%",
            "uptimeDay": f"{uptime_pct(points, 24):.2f}%",
            "uptimeWeek": f"{uptime_pct(points, 24 * 7):.2f}%",
            "uptimeMonth": f"{uptime_pct(points, 24 * 30):.2f}%",
            "uptimeYear": f"{uptime_pct(points, 24 * 365):.2f}%",
            "time": avg_ms(points, 24 * 90),
            "timeDay": avg_ms(points, 24),
            "timeWeek": avg_ms(points, 24 * 7),
            "timeMonth": avg_ms(points, 24 * 30),
            "timeYear": avg_ms(points, 24 * 365),
            "dailyMinutesDown": daily_minutes_down(points, interval_min),
        })
    return summary


def main() -> None:
    load_env()
    config = load_json(CONFIG_FILE, {})
    secrets = load_secrets()
    sites = discover_sites(config, secrets)
    if not sites:
        raise SystemExit("Не найдено ни одного сайта (секретов с URL).")

    interval_min = int(config.get("interval_minutes", 5))
    incidents = load_json(API_DIR / "incidents.json", {})
    repo = repo_slug(config)

    HISTORY_DIR.mkdir(exist_ok=True)

    for key, site in sites.items():
        slug, name = site["slug"], site["name"]
        result = check_site(name, site["url"], site["timeout"])

        api = API_DIR / slug
        api.mkdir(parents=True, exist_ok=True)
        if not (api / "favicon.ico").exists():
            fetch_favicon(site["url"], api / "favicon.ico", site["timeout"])

        points = load_json(api / "points.json", [])
        points.append(result)
        max_points = int(config.get("history_days", 90)) * 24 * 12
        if len(points) > max_points:
            points = points[-max_points:]
        write_json(api / "points.json", points)

        write_site_files(slug, points, result)

        if not result["ok"] and key not in incidents:
            open_incident(key, name, result, incidents, repo)
        elif result["ok"] and key in incidents:
            close_incident(key, incidents, result["ts"], repo)

    # Итоговый summary по всем сайтам
    history_points = {s["slug"]: load_json(API_DIR / s["slug"] / "points.json", []) for s in sites.values()}
    write_json(HISTORY_DIR / "summary.json", build_summary(sites, history_points, interval_min))

    write_json(API_DIR / "incidents.json", incidents)
    if not load_log():
        write_json(API_DIR / "incidents-log.json", [])
    print("Saved:", HISTORY_DIR / "summary.json")


if __name__ == "__main__":
    main()