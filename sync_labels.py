#!/usr/bin/env python3
"""Runicore Sync Labels — синхронизация лейблов мониторинга в GitHub репозитории.

Приводит лейблы репозитория к разрешённому списку:
  incident    — падение сервиса (ставится автоматически монитором);
  maintenance — плановые техработы (точки жёлтые, из аптайма исключены);
  annulled    — аннулировано (точки серые, из аптайма исключены);
  hidden      — скрыто полностью (точки зелёные, аптайм зелёный, событие не показывается).
Недостающие — создаются, все прочие — удаляются.
Запуск: python sync_labels.py
Автор: Freidzher
"""
import json
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).parent

ALLOWED_LABELS = {
    "incident": ("FF4F6D", "Падение сервиса (ставится автоматически монитором)"),
    "maintenance": ("F1C40F", "Плановые техработы: точки жёлтые, из аптайма исключены"),
    "annulled": ("8A9B8F", "Аннулировано: точки серые, из аптайма исключены, в истории серым"),
    "hidden": ("4A554D", "Скрыто полностью: аптайм зелёный, событие не показывается"),
}


def token() -> str:
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            key, _, value = line.partition("=")
            if key.strip() == "FINE_GRAINED_TOKEN" and value.strip():
                return value.strip()
    raise SystemExit("FINE_GRAINED_TOKEN не задан в .env")


def repo() -> str:
    cfg = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
    return f"{cfg['owner']}/{cfg['repo']}"


def api(path: str, method: str = "GET", payload=None):
    req = urllib.request.Request(f"https://api.github.com{path}", method=method)
    req.add_header("Authorization", f"Bearer {token()}")
    req.add_header("Accept", "application/vnd.github+json")
    data = json.dumps(payload).encode() if payload is not None else None
    if data:
        req.data = data
    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read()
            return resp.status, json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        print(f"  API {method} {path} -> HTTP {e.code}: {e.read().decode()[:200]}")
        return e.code, None


def main() -> None:
    r = repo()
    status, existing = api(f"/repos/{r}/labels?per_page=100")
    if status != 200 or existing is None:
        raise SystemExit(f"Не удалось получить лейблы ({status})")

    allowed = set(ALLOWED_LABELS)
    names = {l["name"] for l in existing}
    created = deleted = 0

    # 1. Удаляем всё лишнее
    for name in sorted(names - allowed):
        status, _ = api(f"/repos/{r}/labels/{urllib.parse.quote(name)}", "DELETE")
        print(f"{name}: {'удалён' if status == 204 else f'FAILED ({status})'}")
        deleted += status == 204

    # 2. Создаём недостающие служебные
    for name, (color, desc) in ALLOWED_LABELS.items():
        if name in names:
            print(f"{name}: уже существует")
            continue
        status, _ = api(f"/repos/{r}/labels", "POST",
                        {"name": name, "color": color, "description": desc})
        print(f"{name}: {'OK' if status in (201, 204) else f'FAILED ({status})'}")
        created += status in (201, 204)

    print(f"Готово. Создано: {created}, удалено: {deleted}. Остались только: {', '.join(sorted(allowed))}")


if __name__ == "__main__":
    main()