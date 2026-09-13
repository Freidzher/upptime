#!/usr/bin/env python3
"""Runicore Sync Secrets — заливка секретов из .env в GitHub репозиторий.

GitHub шифрует секреты libsodium sealed box (32-байтный raw-ключ).
Использует FINE_GRAINED_TOKEN из .env как токен (нужны права Administration RW).
Запуск: python sync_secrets.py
Автор: Freidzher
"""
import base64
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
ENV_FILE = ROOT / ".env"
REPO = "Freidzher/upptime"
API = f"https://api.github.com/repos/{REPO}/actions/secrets"
PUBLIC_KEY_URL = f"https://api.github.com/repos/{REPO}/actions/secrets/public-key"


def api_request(url: str, token: str, method: str = "GET", payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read()
            return resp.status, json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()}")
        return e.code, None


def encrypt_sealed(public_key_b64: str, secret: str) -> str:
    """libsodium sealed box (как требует GitHub Actions Secrets API)."""
    from nacl import encoding, public
    pk = public.PublicKey(public_key_b64.encode(), encoding.Base64Encoder())
    sealed = public.SealedBox(pk)
    return base64.b64encode(sealed.encrypt(secret.encode())).decode()


def main() -> None:
    if not ENV_FILE.exists():
        raise SystemExit(".env не найден. Скопируйте .env.example в .env и заполните.")
    env = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if value:
            env[key] = value

    token = env.get("FINE_GRAINED_TOKEN")
    if not token:
        raise SystemExit("FINE_GRAINED_TOKEN не задан в .env — нужен PAT с правом Administration RW.")

    status, pk = api_request(PUBLIC_KEY_URL, token)
    if status != 200 or not pk:
        raise SystemExit("Не удалось получить публичный ключ репозитория (проверьте FINE_GRAINED_TOKEN).")

    key_id, public_key = pk["key_id"], pk["key"]
    print(f"Публичный ключ получен (libsodium, {len(public_key)} симв.)")

    for name, value in env.items():
        if name == "FINE_GRAINED_TOKEN":
            continue
        payload = {
            "encrypted_value": encrypt_sealed(public_key, value),
            "key_id": key_id,
        }
        status, _ = api_request(f"{API}/{name}", token, method="PUT", payload=payload)
        print(f"{name}: {'OK' if status in (201, 204) else f'FAILED ({status})'}")

    print(f"Синхронизировано секретов: {len(env) - 1}")


if __name__ == "__main__":
    main()