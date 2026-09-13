// Runicore Status — главная страница. Автор: Freidzher
// Данные: history/summary.json (агрегат как у Upptime) + api/incidents*.json
(async function () {
  const banner = document.getElementById('banner');
  const rowsEl = document.getElementById('rows');
  const updated = document.getElementById('updated');
  const incEl = document.getElementById('incidents');
  const incTitle = document.getElementById('incTitle');

  async function fetchJson(url) {
    const r = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error(url);
    return r.json();
  }

  async function loadAll() {
    try {
      const [summary, cur, log] = await Promise.all([
        fetchJson('history/summary.json'),
        fetchJson('api/incidents.json').catch(() => ({})),
        fetchJson('api/incidents-log.json').catch(() => []),
      ]);
      render(summary, cur, log);
    } catch (e) {
      banner.className = 'banner fail';
      banner.textContent = '⚠ Не удалось загрузить данные мониторинга';
    }
  }

  function render(summary, incidents, log) {
    if (!summary.length) { banner.textContent = 'Нет данных — монитор ещё не запускался'; return; }

    const allUp = summary.every((s) => s.status === 'up');
    banner.className = 'banner ' + (allUp ? 'ok' : 'fail');
    banner.innerHTML = allUp
      ? '<span class="icon">🟢</span> Все системы работают'
      : '<span class="icon">🔴</span> Обнаружены проблемы с сервисами';

    rowsEl.innerHTML = '';
    for (const s of summary) {
      const up = s.status === 'up';
      const row = document.createElement('a');
      row.className = 'row';
      row.href = 'site.html?site=' + encodeURIComponent(s.slug);
      row.innerHTML =
        '<span class="dot ' + (up ? 'up' : 'down') + '"></span>' +
        '<span class="name"></span>' +
        '<span class="uptime">' + s.uptimeDay + ' · ' + s.timeDay + ' мс</span>' +
        '<span class="chevron">→</span>';
      row.querySelector('.name').textContent = s.name;
      rowsEl.appendChild(row);
    }

    const openInc = Object.entries(incidents || {});
    const past = (log || []).slice().reverse();

    incEl.innerHTML = '';
    incTitle.style.display = (openInc.length || past.length) ? '' : 'none';

    if (openInc.length) {
      const t = document.createElement('div');
      t.className = 'inc-subtitle';
      t.textContent = 'Активные';
      incEl.appendChild(t);
      for (const [, info] of openInc) addIncident(info, true);
    }
    if (past.length) {
      const t = document.createElement('div');
      t.className = 'inc-subtitle';
      t.textContent = 'Прошлые';
      incEl.appendChild(t);
      for (const info of past.slice(0, 10)) addIncident(info, false);
    }
  }

  function addIncident(info, active) {
    const d = document.createElement('div');
    d.className = 'incident';
    const when = new Date(info.opened).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    d.innerHTML = '<b></b> — ' + (active ? 'недоступен с ' : 'устранён за ' + info.minutes + ' мин (открыт ') + when + (active ? '' : ')') +
      ' — <a href="https://github.com/Freidzher/upptime/issues/' + info.issue_number + '">репорт #' + info.issue_number + '</a>';
    d.querySelector('b').textContent = info.name || 'Сервис';
    incEl.appendChild(d);
  }

  await loadAll();
  setInterval(loadAll, 60000);
})();