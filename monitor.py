#!/usr/bin/env python3
"""Runicore Monitor — собственная система мониторинга доступности.

Секреты приходят целиком через SECRETS_CONTEXT (динамически из workflow)
или из локального .env. Служебные (FINE_GRAINED_TOKEN, GH_TOKEN) исключаются.
Имена сайтов — из config.json (names), иначе генерируются из ключа.
История хранится по ключу секрета (стабильно при смене имени).
Автор: Freidzher
"""
import json
import os
import time
import urllib.request
import urllib.error
import ssl
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent
CONFIG_FILE = ROOT / "config.json"
DATA = ROOT / "data"
HISTORY_FILE = DATA / "status.json"
INCIDENTS_FILE = DATA / "incidents.json"      # текущие открытые
INCIDENTS_LOG = DATA / "incidents_log.json"   # журнал всех (для сайта)
ENV_FILE = ROOT / ".env"

SERVICE_KEYS = {"FINE_GRAINED_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"}
ctx = ssl.create_default_context()
REPO = os.environ.get("GITHUB_REPOSITORY", "Freidzher/upptime")


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
    """Все секреты: из SECRETS_CONTEXT (Actions) или .env (локально)."""
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


def discover_sites(config: dict, secrets: dict) -> dict:
    custom = config.get("names", {})
    sites = {}
    for key, value in secrets.items():
        if key in SERVICE_KEYS or key.startswith(("GITHUB_", "RUNNER_", "CI")):
            continue
        if not value or not value.startswith(("http://", "https://")):
            continue
        sites[key] = {
            "name": custom.get(key, pretty_name(key)),
            "url": value,
            "timeout": config.get("timeout", 10),
        }
    return sites


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
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def load_log() -> list:
    if INCIDENTS_LOG.exists():
        return json.loads(INCIDENTS_LOG.read_text(encoding="utf-8"))
    return []


def open_incident(key: str, name: str, result: dict, incidents: dict) -> None:
    issue = gh_api(f"/repos/{REPO}/issues", "POST", {
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


def close_incident(key: str, incidents: dict, last_ok_ts: str) -> None:
    info = incidents.pop(key, None)
    if not info:
        return
    num = info["issue_number"]
    opened = datetime.fromisoformat(info["opened"]).replace(tzinfo=timezone.utc)
    closed = datetime.fromisoformat(last_ok_ts).replace(tzinfo=timezone.utc)
    minutes = max(1, round((closed - opened).total_seconds() / 60))
    gh_api(f"/repos/{REPO}/issues/{num}", "POST", {
        "body": f"✅ {info.get('name', key)} восстановлено в {last_ok_ts}. Устранено за ~{minutes} мин."
    })
    gh_api(f"/repos/{REPO}/issues/{num}", "PATCH", {"state": "closed"})
    # Журнал для сайта
    log = load_log()
    log.append({
        "name": info.get("name", key),
        "issue_number": num,
        "opened": info["opened"],
        "resolved": last_ok_ts,
        "minutes": minutes,
    })
    INCIDENTS_LOG.write_text(json.dumps(log[-100:], ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Incident issue #{num} closed for {key}")


def migrate(history: dict, config: dict) -> dict:
    """Старый формат {name: [points]} -> новый {key: {name, points}}."""
    custom = config.get("names", {})
    if any(isinstance(v, list) for v in history.values()):
        new_hist = {}
        for old_key, val in history.items():
            if isinstance(val, list):
                new_hist[old_key] = {"name": custom.get(old_key, pretty_name(old_key)), "points": val}
            else:
                new_hist[old_key] = val
        return new_hist
    return history


def main() -> None:
    load_env()
    config = load_json(CONFIG_FILE, {})
    secrets = load_secrets()
    sites = discover_sites(config, secrets)
    if not sites:
        raise SystemExit("Не найдено ни одного сайта (секретов с URL).")

    history = load_json(HISTORY_FILE, {})
    incidents = load_json(INCIDENTS_FILE, {})
    history = migrate(history, config)

    for key, site in sites.items():
        name = site["name"]
        result = check_site(name, site["url"], site["timeout"])
        entry = history.setdefault(key, {"name": name, "points": []})
        entry["name"] = name  # всегда актуальное имя
        entry["points"].append(result)
        max_points = int(config.get("history_days", 90)) * 24 * 12
        if len(entry["points"]) > max_points:
            entry["points"] = entry["points"][-max_points:]

        if not result["ok"] and key not in incidents:
            open_incident(key, name, result, incidents)
        elif result["ok"] and key in incidents:
            close_incident(key, incidents, result["ts"])

    DATA.mkdir(exist_ok=True)
    HISTORY_FILE.write_text(json.dumps(history, ensure_ascii=False, indent=1), encoding="utf-8")
    INCIDENTS_FILE.write_text(json.dumps(incidents, ensure_ascii=False, indent=1), encoding="utf-8")
    if not INCIDENTS_LOG.exists():
        INCIDENTS_LOG.write_text("[]", encoding="utf-8")
    print("Saved:", HISTORY_FILE, INCIDENTS_FILE)


if __name__ == "__main__":
    main()