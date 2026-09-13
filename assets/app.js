// Runicore Status — главная страница. Автор: Freidzher
// Компактный список сайтов; детали — на отдельной странице site.html?site=KEY
(async function () {
  const banner = document.getElementById('banner');
  const rowsEl = document.getElementById('rows');
  const updated = document.getElementById('updated');
  const incEl = document.getElementById('incidents');
  const incTitle = document.getElementById('incTitle');

  let cfg = {};
  async function fetchJson(url) {
    const r = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error(url);
    return r.json();
  }

  async function loadAll() {
    try {
      const [c, s, cur, log] = await Promise.all([
        fetchJson('config.json').catch(() => ({})),
        fetchJson('data/status.json'),
        fetchJson('data/incidents.json').catch(() => ({})),
        fetchJson('data/incidents_log.json').catch(() => []),
      ]);
      cfg = c;
      render(s, cur, log);
    } catch (e) {
      banner.className = 'banner fail';
      banner.textContent = '⚠ Не удалось загрузить данные мониторинга';
    }
  }

  function render(data, incidents, log) {
    const namesCfg = cfg.names || {};
    const names = Object.keys(data).filter((k) => {
      const pts = Array.isArray(data[k]) ? data[k] : (data[k].points || []);
      return pts && pts.length;
    });
    if (!names.length) { banner.textContent = 'Нет данных — монитор ещё не запускался'; return; }

    const points = (n) => (Array.isArray(data[n]) ? data[n] : (data[n].points || []));
    const siteName = (n) => namesCfg[n] || (Array.isArray(data[n]) ? n : (data[n].name || n));
    const last = (n) => { const a = points(n); return a[a.length - 1]; };
    const allUp = names.every((n) => last(n) && last(n).ok);
    banner.className = 'banner ' + (allUp ? 'ok' : 'fail');
    banner.innerHTML = allUp
      ? '<span class="icon">🟢</span> Все системы работают'
      : '<span class="icon">🔴</span> Обнаружены проблемы с сервисами';
    updated.textContent = 'Обновлено: ' + new Date(last(names[0]).ts).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const cutoff = Date.now() - 24 * 3600 * 1000;
    const uptime24 = (n) => {
      const r = points(n).filter((e) => new Date(e.ts).getTime() > cutoff);
      return r.length ? ((r.filter((e) => e.ok).length / r.length) * 100).toFixed(1) + '%' : '—';
    };

    rowsEl.innerHTML = '';
    for (const key of names) {
      const cur = last(key);
      const name = siteName(key);

      const row = document.createElement('a');
      row.className = 'row';
      row.href = 'site.html?site=' + encodeURIComponent(key);
      row.innerHTML =
        '<span class="dot ' + (cur.ok ? 'up' : 'down') + '"></span>' +
        '<span class="name"></span>' +
        '<span class="uptime">' + uptime24(key) + '</span>' +
        '<span class="chevron">→</span>';
      row.querySelector('.name').textContent = name;
      rowsEl.appendChild(row);
    }

    // Активные инциденты
    const openInc = Object.entries(incidents || {});
    // Прошлые (закрытые)
    const past = (log || []).slice().reverse();

    incEl.innerHTML = '';
    let hasAny = openInc.length || past.length;
    incTitle.style.display = hasAny ? '' : 'none';

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

  // Первая отрисовка + автообновление каждую минуту
  await loadAll();
  setInterval(loadAll, 60000);
})();