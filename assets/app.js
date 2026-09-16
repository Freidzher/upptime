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

  // События полностью внутри сайта — GitHub не используется во фронтенде

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;' }[c]));
  }

  function pluralMin(n) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return n + ' минуту';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return n + ' минуты';
    return n + ' минут';
  }

  function incidentCard(info, active, isMaint, slug) {
    const mode = info.mode || (info.annulled ? 'annulled' : (info.hidden ? 'hidden' : (isMaint ? 'maintenance' : 'incident')));
    if (mode === 'hidden') return null;
    const d = document.createElement('a');
    d.className = 'incident ' + mode;
    if (slug) d.href = 'site.html?site=' + encodeURIComponent(slug);
    const started = new Date(info.opened).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    let txt;
    if (mode === 'maintenance') {
      txt = active ? 'плановые работы (идут)' : 'плановые работы завершены';
    } else if (mode === 'annulled') {
      txt = active ? 'аннулировано (идёт)' : 'аннулировано';
    } else {
      txt = active ? 'недоступен с ' + started : 'устранён';
    }
    // Клик по карточке — страница события (всё внутри сайта, без GitHub)
    if (info.issue_number) d.href = 'incident.html?issue=' + info.issue_number;
    const meta = active
      ? '<span class="t">Начато: ' + started + ' МСК</span>'
      : '<span class="t">Начато: ' + started + ' МСК · Длительность: ' + pluralMin(info.minutes || 0) + '</span>';
    const name = info.title || (info.name || 'Сервис');
    d.innerHTML = '<b></b> — ' + esc(txt) + meta;
    d.querySelector('b').textContent = name;
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
    // Индикатор-точка вместо смайлика — как у пинга серверов
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
          '<span class="dot ' + (up ? 'up' : 'down') + '"></span>' +
          '<img class="favicon" src="api/' + s.slug + '/' + s.icon + '" alt="" onerror="this.style.display=\'none\'">' +
          '<span class="name"></span>' +
          '<span class="uptime"><b>' + s.uptimeDay + '</b> · ' + (s.curMs || 0) + ' мс</span>' +
          '<span class="chevron">→</span>';
      } else if (emoji) {
        row.innerHTML =
          '<span class="dot ' + (up ? 'up' : 'down') + '"></span>' +
          '<span class="favicon emoji">' + emoji + '</span>' +
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

    const openInc = Object.entries(incidents || {}).filter(([, i]) => (i.mode || 'incident') !== 'hidden');
    incEl.innerHTML = '';
    document.getElementById('incTitle').style.display = openInc.length ? '' : 'none';
    for (const [key, info] of openInc) {
      const card = incidentCard(info, true, info.maintenance, key.toLowerCase().replace(/_/g, '-'));
      if (card) incEl.appendChild(card);
    }

    // Past Events — единая хронология: прошлые инциденты + ТО (новые сверху), hidden скрыты
    const past = (log || []).filter((i) => !i.hidden).slice(-20).reverse()
      .sort((a, b) => new Date(b.resolved || b.opened) - new Date(a.resolved || a.opened));
    pastEl.innerHTML = '';
    document.getElementById('pastTitle').style.display = past.length ? '' : 'none';
    for (const info of past) {
      const card = incidentCard(info, false, info.maintenance, info.slug);
      if (card) pastEl.appendChild(card);
    }
  }

  const y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();

  await loadAll();
  setInterval(loadAll, 60000);
})();