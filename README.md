# Runicore Status

Собственная система мониторинга доступности сервисов и страница статуса, полностью на GitHub. Автор: **Freidzher**.

## ⚙️ Как это работает

- **Секрет = сайт**: любой секрет репозитория с URL (кроме `FINE_GRAINED_TOKEN`) автоматически становится мониторимым сайтом
- `monitor.py` каждые 5 минут (Actions) проверяет все сайты, историю пишет в `data/status.json` (хранится в git-коммитах — статистика не теряется)
- **Инциденты**: при падении автоматически открывается GitHub Issue (без URL — только имя и код), при восстановлении закрывается
- Сайт: компактный список, по клику — детали с графиком (Chart.js), время — МСК

## 🚀 Быстрый старт

1. Заполните `.env` (по шаблону `.env.example`):
   - `FINE_GRAINED_TOKEN` — Fine-grained PAT (Settings → Developer settings → Fine-grained tokens → Repository access: только этот репо → Permissions: Contents RW, Issues RW, **Administration RW**)
   - Ниже — сайты: `SERVER1=https://...` (имя секрета = идентификатор)
2. `pip install pynacl` → `python sync_secrets.py` — секреты зальются в GitHub
3. Имена сайтов — в `config.json` (`names`); интервал/глубина истории там же
4. Всё. Actions подхватит сайты автоматически, статистика копится в git

Локальный запуск монитора: `python monitor.py` (читает `.env`).

## 📄 Лицензия

All Rights Reserved © Freidzher. Коммерческое использование, копирование и распространение запрещены без письменного разрешения.