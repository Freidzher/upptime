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
Формат секрета (разделитель '|', без пробелов):
  '[ID|]цель[|icon-url]', где цель:
    'https://site'                   — HTTP/HTTPS-сайт;
    '1.2.3.4' или 'host.example.com' — машина: проверка SSH-порта 22 (TCP, без авторизации);
  ID — необязательный числовой идентификатор для сортировки/группировки:
    целое ('1') — группа/ВМ (заголовок), дробное ('1.1') — вложенный в неё сервис.
Служебные (FINE_GRAINED_TOKEN, GH_TOKEN) исключаются. URL/IP нигде не публикуются.
Автор: Freidzher
"""
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
import urllib.parse
import ssl
import socket
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).parent
CONFIG_FILE = ROOT / "config.json"
HISTORY_DIR = ROOT / "history"
API_DIR = ROOT / "api"
ENV_FILE = ROOT / ".env"

SERVICE_KEYS = {"FINE_GRAINED_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"}
ctx = ssl.create_default_context()

# Безопасный вывод: не падать на не-CP1251 символах в консоли Windows
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


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


EMOJI_RE = re.compile(
    "[\U0001F000-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\u2190-\u21FF]"
    "(?:\uFE0F|\u200D[\U0001F000-\U0001FAFF\u2600-\u27BF])*")


# Хост без схемы: домен или IPv4 (буквы/цифры/точки/дефисы, без пробелов и слэшей)
HOST_RE = re.compile(r"^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$")
# Числовой идентификатор сортировки/группировки: '1', '1.1', '2.10'
GROUP_ID_RE = re.compile(r"^\d+(?:\.\d+)?$")


def discover_sites(config: dict, secrets: dict) -> dict:
    """Формат секрета — '[ID|]цель[|icon-url]', разделитель '|' (без пробелов):
      'https://site|https://icon-url'  — HTTP/HTTPS-сайт (+ необязательная иконка);
      '1.2.3.4' или 'host.example.com' — машина: проверка SSH-порта 22 (TCP, без авторизации);
      '1|https://site'                 — сервис группы '1' (целый ID = группа/ВМ),
      '1.1|https://site'               — вложенный сервис группы '1'.
    """
    custom = config.get("names", {})
    sites = {}
    for key, value in secrets.items():
        if key in SERVICE_KEYS or key.startswith(("GITHUB_", "RUNNER_", "CI")):
            continue
        if not value:
            continue
        parts = [p.strip() for p in value.split("|") if p.strip()]
        if not parts:
            continue
        group, is_group = "", False
        if GROUP_ID_RE.match(parts[0]) and len(parts) > 1:
            group = parts[0]
            is_group = "." not in group  # целый ID — группа/ВМ, дробный — вложенный сервис
            parts = parts[1:]
        target = parts[0]
        icon_url = parts[1] if len(parts) > 1 and parts[1].startswith(("http://", "https://")) else ""
        if target.startswith(("http://", "https://")):
            kind = "http"
        elif HOST_RE.match(target):
            kind = "ssh"  # IP или домен без схемы -> TCP-проверка порта 22
        else:
            continue  # не похоже ни на URL, ни на хост — пропускаем
        sites[key] = {
            "slug": slugify(key),
            "name": custom.get(key, pretty_name(key)),
            "kind": kind,
            "url": target,
            "icon_url": icon_url,
            "group": group,
            "is_group": is_group,
            "timeout": config.get("timeout", 10),
        }
    return sites


def fetch_favicon(url: str, api_dir: Path, timeout: int = 10) -> str:
    """Скачивает favicon (ico/png/svg) в api/{slug}/favicon.{ext}.

    Возвращает имя файла ('favicon.ico'|'favicon.png'|'favicon.svg') или ''.
    Приоритет: прямой URL > /favicon.ico > /favicon.png > /favicon.svg > DuckDuckGo.
    Старые favicon.* с другим расширением удаляются.
    """
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    def save(data: bytes, ext: str) -> str:
        # Удаляем старые иконки с другим расширением
        for old in api_dir.glob("favicon.*"):
            if old.name != f"favicon.{ext}":
                old.unlink(missing_ok=True)
        (api_dir / f"favicon.{ext}").write_bytes(data)
        return f"favicon.{ext}"

    try:
        # Если URL уже ведёт на иконку (ico/png/svg) — скачиваем напрямую
        lower = url.lower()
        for ext in ("ico", "png", "svg"):
            if lower.endswith("." + ext):
                try:
                    req = urllib.request.Request(url, headers={"User-Agent": "RunicoreMonitor/1.0"})
                    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
                        data = resp.read()
                    if data and len(data) > 100:
                        return save(data, ext)
                except Exception:
                    pass
                break

        # Разрешаем редиректы вручную, чтобы узнать конечный URL
        opener = urllib.request.build_opener(NoRedirect)
        req = urllib.request.Request(url, headers={"User-Agent": "RunicoreMonitor/1.0"})
        try:
            with opener.open(req, timeout=timeout) as resp:
                if 300 <= resp.status < 400:
                    url = resp.headers.get("Location") or url
        except urllib.error.HTTPError as e:
            if 300 <= e.code < 400:
                url = e.headers.get("Location") or url

        host = urllib.parse.urlparse(url).netloc
        base = "{0.scheme}://{0.netloc}".format(urllib.parse.urlparse(url))
        candidates = (
            (f"{base}/favicon.ico", "ico"),
            (f"{base}/favicon.png", "png"),
            (f"{base}/favicon.svg", "svg"),
            (f"https://icons.duckduckgo.com/ip3/{host}.ico", "ico"),
        )
        for icon_url, ext in candidates:
            try:
                req = urllib.request.Request(icon_url, headers={"User-Agent": "RunicoreMonitor/1.0"})
                with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
                    data = resp.read()
                if data and len(data) > 100:
                    return save(data, ext)
            except Exception:
                continue
    except Exception:
        pass
    return ""


def _open(req: urllib.request.Request, timeout: int):
    return urllib.request.urlopen(req, timeout=timeout, context=ctx)


def _single_check(url: str, timeout: int) -> tuple:
    """Одна попытка проверки. Возвращает (ok, code)."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "RunicoreMonitor/1.0"})
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            return True, resp.status
    except urllib.error.HTTPError as e:
        return True, e.code  # HTTP-ответ = сервер жив
    except urllib.error.URLError as e:
        if isinstance(getattr(e, "reason", None), ssl.SSLCertVerificationError):
            try:
                req2 = urllib.request.Request(url, headers={"User-Agent": "RunicoreMonitor/1.0"})
                with urllib.request.urlopen(req2, timeout=timeout, context=ssl._create_unverified_context()) as resp:
                    return True, resp.status
            except urllib.error.HTTPError as e2:
                return True, e2.code
            except Exception:
                return False, 0
        return False, 0
    except Exception:
        return False, 0


def check_site(name: str, url: str, timeout: int = 10) -> dict:
    """3 попытки проверки: если 2+ успешных — работает, если все 3 неудачные — падение."""
    start = time.monotonic()
    successes = 0
    last_code = 0
    for attempt in range(3):
        ok, code = _single_check(url, timeout)
        if ok:
            successes += 1
            last_code = code
        if successes >= 2:
            break  # Достаточно успехов
    ok = successes >= 2
    ms = round((time.monotonic() - start) * 1000)
    print(f"{name}: {'UP' if ok else 'DOWN'} ({last_code}) {ms}ms [x{successes}/3]".encode("utf-8", "replace").decode("utf-8", "replace"))
    return {"ts": datetime.now(timezone.utc).isoformat(timespec="seconds"), "ok": ok, "code": last_code, "ms": ms}


def _single_ssh_check(host: str, timeout: int) -> tuple:
    """Одна TCP-попытка на порт 22 (SSH, без авторизации). Возвращает (ok, code)."""
    try:
        with socket.create_connection((host, 22), timeout=timeout):
            return True, 22  # соединение установлено -> машина активна
    except Exception:
        return False, 0


def check_ssh(name: str, host: str, timeout: int = 10) -> dict:
    """Живость машины: TCP-подключение к порту 22 (без авторизации).
    3 попытки: 2+ успешных — работает, иначе — падение."""
    start = time.monotonic()
    successes = 0
    last_code = 0
    for attempt in range(3):
        ok, code = _single_ssh_check(host, timeout)
        if ok:
            successes += 1
            last_code = code
        if successes >= 2:
            break  # Достаточно успехов
    ok = successes >= 2
    ms = round((time.monotonic() - start) * 1000)
    print(f"{name}: {'UP' if ok else 'DOWN'} ({last_code}) {ms}ms [x{successes}/3] [ssh]".encode("utf-8", "replace").decode("utf-8", "replace"))
    return {"ts": datetime.now(timezone.utc).isoformat(timespec="seconds"), "ok": ok, "code": last_code, "ms": ms}


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


def open_incident(key: str, name: str, result: dict, incidents: dict, repo: str, is_maint: bool = False) -> None:
    title = f"{name} maintenance" if is_maint else f"{name} is down"
    labels = ["maintenance"] if is_maint else ["incident"]
    body = (
        f"**{name}** — плановые работы.\n\n- Время: {result['ts']}\n\n"
        "Закроется автоматически по завершении."
    ) if is_maint else (
        f"**{name}** недоступен.\n\n"
        f"- Время: {result['ts']}\n"
        f"- Code: {result['code']}\n"
        f"- Response time: {result['ms']} ms\n\n"
        f"Комментарии — репорты инцидента. Закроется автоматически при восстановлении."
    )
    issue = gh_api(f"/repos/{repo}/issues", "POST", {"title": title, "body": body, "labels": labels})
    if issue:
        incidents[key] = {
            "issue_number": issue["number"],
            "opened": result["ts"],
            "name": name,
            "maintenance": is_maint,
        }
        print(f"Incident issue #{issue['number']} opened for {name} (maintenance={is_maint})")


def close_incident(key: str, incidents: dict, last_ok_ts: str, repo: str) -> None:
    info = incidents.pop(key, None)
    if not info:
        return
    num = info["issue_number"]
    opened = datetime.fromisoformat(info["opened"]).replace(tzinfo=timezone.utc)
    closed = datetime.fromisoformat(last_ok_ts).replace(tzinfo=timezone.utc)
    minutes = max(1, round((closed - opened).total_seconds() / 60))
    is_maint = info.get("maintenance", False)
    gh_api(f"/repos/{repo}/issues/{num}", "POST", {
        "body": f"✅ {info.get('name', key)} {'завершены плановые работы' if is_maint else 'восстановлено'} в {last_ok_ts}. "
                f"{'Длительность' if is_maint else 'Устранено за'} ~{minutes} мин."
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
        "maintenance": is_maint,
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


def _group_sort_key(site: dict) -> tuple:
    """Сортировка: сервисы с ID — по числу (целые группы перед своими 1.x),
    без ID — в конец (в исходном порядке)."""
    g = site.get("group", "")
    if not g:
        return (2, 0.0, 0)
    whole, _, frac = g.partition(".")
    # Группа (целый ID) идёт перед вложенными 1.x: ключ (1, 1.0-eps) < (1, 1.1)
    val = float(g) - (0.001 if site.get("is_group") and frac == "" else 0.0)
    return (1, val, 0)


def build_summary(sites: dict, history_points: dict, interval_min: int) -> list:
    summary = []
    updated_at = ""
    for key, site in sites.items():
        slug = site["slug"]
        points = history_points.get(slug, [])
        last = points[-1] if points else {"ok": True, "ms": 0, "code": 0, "ts": ""}
        if last["ts"] > updated_at:
            updated_at = last["ts"]  # когда данные реально обновлялись последний раз
        # Фактическая иконка: первый найденный favicon.* в папке сайта
        icon = ""
        icon_dir = API_DIR / slug
        if icon_dir.exists():
            for old in sorted(icon_dir.glob("favicon.*")):
                icon = old.name
                break
        summary.append({
            "name": site["name"],
            "slug": slug,
            "icon": icon,
            "group": site.get("group", ""),
            "isGroup": site.get("is_group", False),
            "status": "up" if (points and last["ok"]) else "down",
            "uptime": f"{uptime_pct(points, 24 * 90):.2f}%",
            "uptimeDay": f"{uptime_pct(points, 24):.2f}%",
            "uptimeWeek": f"{uptime_pct(points, 24 * 7):.2f}%",
            "uptimeMonth": f"{uptime_pct(points, 24 * 30):.2f}%",
            "uptimeYear": f"{uptime_pct(points, 24 * 365):.2f}%",
            "curMs": last["ms"],
            "time": avg_ms(points, 24 * 90),
            "timeDay": avg_ms(points, 24),
            "timeWeek": avg_ms(points, 24 * 7),
            "timeMonth": avg_ms(points, 24 * 30),
            "timeYear": avg_ms(points, 24 * 365),
            "dailyMinutesDown": daily_minutes_down(points, interval_min),
        })
    # Сервисы с ID (по возрастанию) — раньше; без ID — в конце
    summary.sort(key=lambda s: (_group_sort_key({**next(v for v in sites.values() if v["slug"] == s["slug"])}), s["slug"]))
    if summary:
        summary[0]["updatedAt"] = updated_at
    return summary


def leading_emoji(name: str) -> str:
    """Возвращает ведущий эмодзи имени (включая флаги 🇸🇪) или ''."""
    m = re.match(r"^[\U0001F1E6-\U0001F1FF]{2}|\U0001F300-\U0001FAFF|\u2600-\u27BF", name)
    return m.group(0) if m else ""


def main() -> None:
    load_env()
    config = load_json(CONFIG_FILE, {})
    secrets = load_secrets()
    sites = discover_sites(config, secrets)
    if not sites:
        raise SystemExit("Не найдено ни одного сайта/сервера (секретов с URL или IP/доменом).")

    interval_min = int(config.get("interval_minutes", 5))
    incidents = load_json(API_DIR / "incidents.json", {})
    repo = repo_slug(config)

    HISTORY_DIR.mkdir(exist_ok=True)

    for key, site in sites.items():
        slug, name = site["slug"], site["name"]
        if site["kind"] == "ssh":
            # Машина: TCP-проверка SSH-порта 22 по IP/домену (без авторизации)
            result = check_ssh(name, site["url"], site["timeout"])
        else:
            result = check_site(name, site["url"], site["timeout"])

        api = API_DIR / slug
        api.mkdir(parents=True, exist_ok=True)
        # Иконка: явная ссылка из секрета; для HTTP — дополнительно favicon сайта
        icon_done = ""
        if site.get("icon_url"):
            icon_done = fetch_favicon(site["icon_url"], api, site["timeout"])
        if not icon_done and site["kind"] == "http":
            icon_done = fetch_favicon(site["url"], api, site["timeout"])
        if icon_done:
            site["icon"] = icon_done

        points = load_json(api / "points.json", [])
        points.append(result)
        max_points = int(config.get("history_days", 90)) * 24 * 12
        if len(points) > max_points:
            points = points[-max_points:]
        write_json(api / "points.json", points)

        write_site_files(slug, points, result)

        clean_name = EMOJI_RE.sub("", name).strip()
        if not result["ok"] and key not in incidents:
            open_incident(key, clean_name or name, result, incidents, repo)
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