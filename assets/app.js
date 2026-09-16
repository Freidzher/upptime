// Runicore Status — главная страница. Автор: Freidzher
// Данные: history/summary.json + api/incidents*.json
(async function () {
  const banner = document.getElementById('banner');
  const updatedEl = document.getElementById('updated');
  const rowsEl = document.getElementById('rows');
  const incEl = document.getElementById('incidents');
  const maintEl = document.getElementById('maintenance');
  const pastEl = document.getElementById('past');
  const EMOJI_RE = /^[\u{1F1E6}-\u{1F1FF}]{2}|[\u{1F000}-\u{1FAFF}]|[\u2600-\u27BF]\uFE0F?/u;

  async function fetchJson(url) {
    const r = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error(url);
    return r.json();
  }

  let owner = '', repo = '';
  fetchJson('config.json').then((c) => { owner = c.owner || ''; repo = c.repo || ''; }).catch(() => {});

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;' }[c]));
  }

  function incidentCard(info, active, isMaint) {
    const d = document.createElement('div');
    d.className = 'incident';
    const when = new Date(info.opened).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    let txt;
    if (isMaint) {
      txt = 'плановые работы с ' + when;
    } else if (active) {
      txt = 'недоступен с ' + when;
    } else {
      txt = 'устранён за ' + (info.minutes || '?') + ' мин (открыт ' + when + ')';
    }
    const issueNum = info.issue_number || info.issueNumber;
    const link = (owner && repo && issueNum)
      ? ' — <a href="https://github.com/' + esc(owner) + '/' + esc(repo) + '/issues/' + issueNum + '">репорт #' + issueNum + '</a>'
      : '';
    d.innerHTML = '<b></b> — ' + esc(txt) + link;
    d.querySelector('b').textContent = info.name || 'Сервис';
    return d;
  }

  async function loadAll() {
    try {
      const [summary, cur, log] = await Promise.all([
        fetchJson('history/summary.json'),
        fetchJson('api/incidents.json').catch(() => ({})),
        fetchJson('api/incidents-log.json').catch(() => []),
      ]);
      render(summary, cur, log);
      if (updatedEl) {
        // Время реального обновления данных мониторинга (из summary.json)
        const ts = summary.length && summary[0].updatedAt ? summary[0].updatedAt : null;
        const when = ts
          ? new Date(ts).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' })
          : new Date().toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' });
        updatedEl.textContent = 'Данные обновлены: ' + when;
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
    banner.innerHTML = allUp
      ? '<span class="icon">🟢</span> Все сервисы работают'
      : '<span class="icon">🔴</span> Сервисы нестабильны';

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
          (emoji && !s.icon
            ? '<span class="favicon emoji">' + emoji + '</span>'
            : '') +
          (s.icon
            ? '<img class="favicon" src="api/' + s.slug + '/' + s.icon + '" alt="" onerror="this.style.display=\'none\'">'
            : '') +
          '<span class="name"></span>' +
          '<span class="group-status"><b>' + s.uptimeDay + '</b> · ' + (s.curMs || 0) + ' мс</span>';
        head.querySelector('.name').textContent = cleanName;
        rowsEl.appendChild(head);
        continue;
      }
      const row = document.createElement('a');
      row.className = 'row' + (s.group ? ' nested' : '');
      row.href = 'site.html?site=' + encodeURIComponent(s.slug);
      if (s.icon) {
        row.innerHTML =
          '<img class="favicon" src="api/' + s.slug + '/' + s.icon + '" alt="" onerror="this.style.display=\'none\'">' +
          '<span class="dot ' + (up ? 'up' : 'down') + '"></span>' +
          '<span class="name"></span>' +
          '<span class="uptime"><b>' + s.uptimeDay + '</b> · ' + (s.curMs || 0) + ' мс</span>' +
          '<span class="chevron">→</span>';
      } else if (emoji) {
        row.innerHTML =
          '<span class="favicon emoji">' + emoji + '</span>' +
          '<span class="dot ' + (up ? 'up' : 'down') + '"></span>' +
          '<span class="name"></span>' +
          '<span class="uptime"><b>' + s.uptimeDay + '</b> · ' + (s.curMs || 0) + ' мс</span>' +
          '<span class="chevron">→</span>';
      } else {
        row.innerHTML =
          '<span class="dot ' + (up ? 'up' : 'down') + '"></span>' +
          '<span class="name"></span>' +
          '<span class="uptime"><b>' + s.uptimeDay + '</b> · ' + (s.curMs || 0) + ' мс</span>' +
          '<span class="chevron">→</span>';
      }
      row.querySelector('.name').textContent = cleanName;
      rowsEl.appendChild(row);
    }

    const openInc = Object.entries(incidents || {}).filter(([, i]) => !i.maintenance);
    incEl.innerHTML = '';
    document.getElementById('incTitle').style.display = openInc.length ? '' : 'none';
    for (const [, info] of openInc) incEl.appendChild(incidentCard(info, true, false));

    const maint = Object.entries(incidents || {}).filter(([, i]) => i.maintenance);
    maintEl.innerHTML = '';
    document.getElementById('maintTitle').style.display = maint.length ? '' : 'none';
    for (const [, info] of maint) maintEl.appendChild(incidentCard(info, true, true));

    const past = (log || []).slice(-10).reverse();
    pastEl.innerHTML = '';
    document.getElementById('pastTitle').style.display = past.length ? '' : 'none';
    for (const info of past) {
      const isMaint = info.maintenance || (info.name && info.name.toLowerCase().includes('maintenance'));
      pastEl.appendChild(incidentCard(info, false, isMaint));
    }
  }

  const y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();

  await loadAll();
  setInterval(loadAll, 60000);
})();