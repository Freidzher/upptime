#!/usr/bin/env python3
"""Runicore — единая точка входа.

Запуск: python main.py
  1. Заливает секреты из .env в GitHub (sync_secrets.py)
  2. Запускает Runicore Monitor (проверка сайтов + коммит истории)
  3. Запускает Static Site CI (деплой Pages)
  4. Ждёт результаты и печатает статусы

Workflow'ы также срабатывают сами: monitor — по cron */5, site — по push
(assets/history/api/index/site). main.py нужен для ручного запуска
"всё одним нажатием" и первичной настройки.
"""
import json
import subprocess
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).parent
ENV_FILE = ROOT / ".env"
REPO = "Freidzher/upptime"
API = f"https://api.github.com/repos/{REPO}/actions"


def token() -> str:
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
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
    status, data = call(f"{API}/workflows/{wf}/dispatches", t, "POST", {"ref": "master"})
    print(f"  dispatch {wf}:", "OK" if status == 204 else f"FAILED {status} {data}")
    return status == 204


def wait_run(t: str, wf: str, timeout_s: int = 420) -> str:
    """Ждёт завершения последнего прогона workflow."""
    time.sleep(10)
    for _ in range(timeout_s // 15):
        status, data = call(f"{API}/workflows/{wf}/runs?per_page=1", t)
        if status == 200 and data["workflow_runs"]:
            r = data["workflow_runs"][0]
            if r["status"] == "completed":
                print(f"  {wf}: {r['conclusion']}")
                return r["conclusion"]
        time.sleep(15)
    print(f"  {wf}: timeout")
    return "timeout"


def main() -> None:
    t = token()

    # 1. Секреты из .env -> GitHub
    print("[1/3] Секреты (sync_secrets.py)...")
    r = subprocess.run([sys.executable, str(ROOT / "sync_secrets.py")])
    if r.returncode != 0:
        raise SystemExit("sync_secrets.py упал — секреты не залиты.")

    # 2. Монитор
    print("[2/3] Монитор (Runicore Monitor)")
    if dispatch(t, "monitor.yml"):
        wait_run(t, "monitor.yml")

    # 3. Деплой сайта
    print("[3/3] Сайт (Static Site CI)")
    if dispatch(t, "site.yml"):
        wait_run(t, "site.yml")

    print("Готово. Сайт: https://freidzher.github.io/upptime/")


if __name__ == "__main__":
    main()