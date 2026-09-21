// Runicore Status — главная страница (использует assets/js/common.js). Автор: Freidzher
(async function () {
  const banner = document.getElementById('banner');
  const updatedEl = document.getElementById('updated');
  const rowsEl = document.getElementById('rows');
  const incEl = document.getElementById('incidents');
  const pastEl = document.getElementById('past');
  const { EMOJI_RE, incidentCard, setFooterYear, fetchJson } = window.Runicore;

  setFooterYear();

  async function loadAll() {
    try {
      const [summary, cur, log] = await Promise.all([
        fetchJson('history/summary.json'),
        fetchJson('api/incidents.json').catch(() => ({})),
        fetchJson('api/incidents-log.json').catch(() => []),
      ]);
      render(summary, cur, log);
      if (updatedEl) {
        const ts = summary.length && summary[0].updatedAt ? summary[0].updatedAt : null;
        const when = ts
          ? new Date(ts).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })
          : new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
        updatedEl.textContent = 'Обновлено: ' + when + ' МСК';
      }
    } catch (e) {
      banner.className = 'banner fail';
      banner.textContent = '⚠ Не удалось загрузить данные мониторинга';
    }
  }

  function render(summary, incidents, log) {
    if (!summary.length) { banner.textContent = 'Нет данных — монитор ещё не запускался'; return; }

    const allUp = summary.every((s) => s.status === 'up');
    banner.className = 'banner ' + (allUp ? 'ok' : 'fail');
    const hasMaint = Object.values(incidents || {}).some((i) => i.maintenance);
    banner.innerHTML = allUp
      ? '<span class="banner-dot' + (hasMaint ? ' warn' : '') + '"></span> Все сервисы работают'
      : '<span class="banner-dot fail"></span> Сервисы нестабильны';

    rowsEl.innerHTML = '';
    const childDown = {};
    for (const s of summary) {
      if (s.group && !s.isGroup) {
        const head = s.group.split('.')[0];
        childDown[head] = childDown[head] || (s.status !== 'up');
      }
    }
    for (const s of summary) {
      const up = s.status === 'up';
      const emoji = (s.name.match(EMOJI_RE) || [''])[0];
      const cleanName = s.name.replace(EMOJI_RE, '').trim();
      if (s.isGroup) {
        const gUp = up && !childDown[s.group];
        // Кликабельный заголовок группы (ВМ): флаг-эмодзи, uptime и текущий отклик
        const head = document.createElement('a');
        head.className = 'group-head';
        head.href = 'site.html?site=' + encodeURIComponent(s.slug);
        head.innerHTML =
          '<span class="dot ' + (gUp ? 'up' : 'down') + '"></span>' +
          (emoji && !s.icon ? '<span class="favicon emoji">' + emoji + '</span>' : '') +
          (s.icon ? '<img class="favicon" src="api/' + s.slug + '/' + s.icon + '" alt="" onerror="this.style.display=\'none\'">' : '') +
          '<span class="name"></span>' +
          '<span class="group-status"><b>' + s.uptimeDay + '</b> · ' + (s.curMs || 0) + ' мс</span>';
        head.querySelector('.name').textContent = cleanName;
        rowsEl.appendChild(head);
        continue;
      }
      const row = document.createElement('a');
      row.className = 'row' + (s.group ? ' nested' : '');
      row.href = 'site.html?site=' + encodeURIComponent(s.slug);
      const iconHtml = s.icon
        ? '<img class="favicon" src="api/' + s.slug + '/' + s.icon + '" alt="" onerror="this.style.display=\'none\'">'
        : (emoji ? '<span class="favicon emoji">' + emoji + '</span>' : '');
      row.innerHTML =
        '<span class="dot ' + (up ? 'up' : 'down') + '"></span>' +
        iconHtml +
        '<span class="name"></span>' +
        '<span class="uptime"><b>' + s.uptimeDay + '</b> · ' + (s.curMs || 0) + ' мс</span>' +
        '<span class="chevron">→</span>';
      row.querySelector('.name').textContent = cleanName;
      rowsEl.appendChild(row);
    }

    // Активные события (hidden скрыты)
    const openInc = Object.entries(incidents || {}).filter(([, i]) => (i.mode || 'incident') !== 'hidden');
    incEl.innerHTML = '';
    document.getElementById('incTitle').style.display = openInc.length ? '' : 'none';
    for (const [key, info] of openInc) {
      const card = incidentCard(info, true, key.toLowerCase().replace(/_/g, '-'));
      if (card) incEl.appendChild(card);
    }

    // Прошлые события — единая хронология (новые сверху), hidden скрыты
    const past = (log || []).filter((i) => !i.hidden).slice(-20).reverse()
      .sort((a, b) => new Date(b.resolved || b.opened) - new Date(a.resolved || a.opened));
    pastEl.innerHTML = '';
    document.getElementById('pastTitle').style.display = past.length ? '' : 'none';
    for (const info of past) {
      const card = incidentCard(info, false);
      if (card) pastEl.appendChild(card);
    }
  }

  await loadAll();
  setInterval(loadAll, 60000);
})();