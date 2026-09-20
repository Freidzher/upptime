// Runicore Status — страница события (инцидент/техработы), без внешних ссылок
(async function () {
  const titleEl = document.getElementById('evtTitle');
  const cardEl = document.getElementById('evtCard');
  const statusEl = document.getElementById('evtStatus');
  const metaEl = document.getElementById('evtMeta');
  const descEl = document.getElementById('evtDesc');
  const linkEl = document.getElementById('serviceLink');

  const params = new URLSearchParams(location.search);
  const issueNum = Number(params.get('issue') || 0);

  function pluralMin(n) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return n + ' минуту';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return n + ' минуты';
    return n + ' минут';
  }
  function fmt(ts) {
    return ts ? new Date(ts).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : null;
  }

  // Год в футере — до выхода из try (иначе return при найденном событии его пропускает)
  const y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();

  async function fetchJson(url) {
    const r = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error(url);
    return r.json();
  }

  function render(info, active) {
    const mode = info.mode || (info.annulled ? 'annulled' : (info.hidden ? 'hidden' : (info.maintenance ? 'maintenance' : 'incident')));
    cardEl.className = 'evt ' + mode;
    const started = fmt(info.opened);
    const resolved = fmt(info.resolved);

    let status;
    if (mode === 'maintenance') status = active ? 'Идут плановые работы' : 'Плановые работы завершены';
    else if (mode === 'annulled') status = active ? 'Событие аннулировано (идёт)' : 'Событие аннулировано';
    else status = active ? 'Сервис недоступен' : 'Восстановлено';

    const label = { incident: 'Инцидент', maintenance: 'Техработы', annulled: 'Аннулировано', hidden: 'Скрыто' }[mode];
    titleEl.textContent = (info.title || (info.name + ' — событие')) + ' · ' + label;
    document.title = (info.title || 'Событие') + ' — Runicore';

    statusEl.textContent = status;
    const parts = ['Начато: ' + started + ' МСК'];
    if (resolved) parts.push('Закрыто: ' + resolved + ' МСК');
    if (info.minutes) parts.push('Длительность: ' + pluralMin(info.minutes));
    metaEl.innerHTML = parts.map((p) => '<span>' + p + '</span>').join('');
    // Ссылка на страницу сервиса (без GitHub)
    if (info.slug) {
      linkEl.href = 'site.html?site=' + encodeURIComponent(info.slug);
      linkEl.style.display = '';
      linkEl.textContent = (info.name || 'Сервис') + ' → страница сервиса';
    }
    descEl.textContent = info.desc || '';
  }

  try {
    const [incidents, log] = await Promise.all([
      fetchJson('api/incidents.json').catch(() => ({})),
      fetchJson('api/incidents-log.json').catch(() => []),
    ]);
    // Активное событие по номеру issue
    const active = Object.values(incidents || {}).find((i) => i.issue_number === issueNum);
    if (active) { render(active, true); return; }
    // Иначе — в журнале
    const past = (log || []).find((i) => i.issue_number === issueNum);
    if (past) { render(past, false); return; }
    titleEl.textContent = 'Событие не найдено';
    statusEl.textContent = 'Возможно, оно скрыто или ещё не синхронизировано.';
  } catch (e) {
    titleEl.textContent = 'Не удалось загрузить событие';
  }
})();
