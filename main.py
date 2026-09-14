#!/usr/bin/env python3
"""Runicore — единая точка входа.

Запуск: python main.py
  1. Заливает секреты из .env в GitHub (sync_secrets.py)
  2. Запускает Monitor (проверка сайтов + коммит истории)
  3. Запускает Static Site CI (деплой Pages)
  4. Ждёт результаты и печатает статусы

owner/repo берутся из config.json — там же меняется автор и репозиторий.
Workflow'ы также срабатывают сами: Monitor — по cron */5, Site — по push.

Подкоманды (без аргументов — полный цикл выше):
  python main.py status              — последние прогоны workflow
  python main.py schedule            — прогоны по cron (диагностика расписания)
  python main.py dispatch site|monitor — запустить один workflow
"""
import argparse
import json
import subprocess
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).parent
ENV_FILE = ROOT / ".env"
CONFIG_FILE = ROOT / "config.json"
API = "https://api.github.com/repos/{owner}/{repo}/actions"


def load_json(path: Path, default):
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return default
    return default


def cfg() -> dict:
    return load_json(CONFIG_FILE, {})


def repo_actions() -> str:
    c = cfg()
    if not c.get("owner") or not c.get("repo"):
        raise SystemExit("Укажите owner и repo в config.json")
    return API.format(owner=c["owner"], repo=c["repo"])


def token() -> str:
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        key, _, value = line.partition("=")
        if key.strip() == "FINE_GRAINED_TOKEN" and value.strip():
            return value.strip()
    raise SystemExit("FINE_GRAINED_TOKEN не задан в .env")


def call(url: str, t: str, method: str = "GET", payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {t}")
    req.add_header("Accept", "application/vnd.github+json")
    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read()
            return resp.status, json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def dispatch(t: str, wf: str) -> bool:
    base = repo_actions()
    status, data = call(f"{base}/workflows/{wf}/dispatches", t, "POST", {"ref": "master"})
    print(f"  dispatch {wf}:", "OK" if status == 204 else f"FAILED {status} {data}")
    return status == 204


def wait_run(t: str, wf: str, timeout_s: int = 420) -> str:
    """Ждёт завершения последнего прогона workflow."""
    base = repo_actions()
    time.sleep(10)
    for _ in range(timeout_s // 15):
        status, data = call(f"{base}/workflows/{wf}/runs?per_page=1", t)
        if status == 200 and data["workflow_runs"]:
            r = data["workflow_runs"][0]
            if r["status"] == "completed":
                print(f"  {wf}: {r['conclusion']}")
                return r["conclusion"]
        time.sleep(15)
    print(f"  {wf}: timeout")
    return "timeout"


def cmd_status(t: str, event: str = None) -> None:
    url = f"{repo_actions()}/runs?per_page=10"
    if event:
        url += f"&event={event}"
    status, data = call(url, t)
    if status != 200:
        print(status, data)
        return
    for r in data["workflow_runs"]:
        print(f"{r['name']} | {r['event']} | {r['status']} | {r.get('conclusion')} | {r['created_at']}")


def main() -> None:
    t = token()

    parser = argparse.ArgumentParser(description="Runicore — полный цикл или подкоманда")
    sub = parser.add_subparsers(dest="cmd")
    sub.add_parser("status", help="последние прогоны workflow")
    sub.add_parser("schedule", help="прогоны по cron (диагностика расписания)")
    p_disp = sub.add_parser("dispatch", help="запустить один workflow")
    p_disp.add_argument("workflow", choices=["site", "monitor"], help="site.yml или monitor.yml")
    args = parser.parse_args()

    if args.cmd == "status":
        cmd_status(t)
        return
    if args.cmd == "schedule":
        cmd_status(t, event="schedule")
        return
    if args.cmd == "dispatch":
        wf = "site.yml" if args.workflow == "site" else "monitor.yml"
        dispatch(t, wf)
        return

    # Полный цикл (по умолчанию)

    # 1. Секреты из .env -> GitHub
    print("[1/3] Секреты (sync_secrets.py)...")
    r = subprocess.run([sys.executable, str(ROOT / "sync_secrets.py")])
    if r.returncode != 0:
        raise SystemExit("sync_secrets.py упал — секреты не залиты.")

    # 2. Монитор
    print("[2/3] Монитор (Monitor)")
    if dispatch(t, "monitor.yml"):
        wait_run(t, "monitor.yml")

    # 3. Деплой сайта
    print("[3/3] Сайт (Static Site CI)")
    if dispatch(t, "site.yml"):
        wait_run(t, "site.yml")

    c = cfg()
    print(f"Готово. Сайт: https://{c['owner']}.github.io/{c['repo']}/")


if __name__ == "__main__":
    main()