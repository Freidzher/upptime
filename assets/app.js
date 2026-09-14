 // Runicore Status — главная страница. Автор: Freidzher
// Данные: history/summary.json (агрегат как у Upptime) + api/incidents*.json
(async function () {
  const banner = document.getElementById('banner');
  const rowsEl = document.getElementById('rows');
  const incEl = document.getElementById('incidents');
  const pastEl = document.getElementById('past');
  const EMOJI_RE = /^[\u{1F1E6}-\u{1F1FF}]{2}|[\u{1F000}-\u{1FAFF}]|[\u2600-\u27BF]\uFE0F?/u;

  async function fetchJson(url) {
    const r = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error(url);
    return r.json();
  }

  let owner = '', repo = '';
  fetchJson('config.json').then((c) => { owner = c.owner || ''; repo = c.repo || ''; }).catch(() => {});

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
      const emoji = (s.name.match(EMOJI_RE) || [''])[0];
      const cleanName = s.name.replace(EMOJI_RE, '').trim();
      const row = document.createElement('a');
      row.className = 'row';
      row.href = 'site.html?site=' + encodeURIComponent(s.slug);
      if (emoji) {
        row.innerHTML =
          '<span class="favicon emoji" data-slug="' + s.slug + '">' + emoji + '</span>' +
          '<span class="dot ' + (up ? 'up' : 'down') + '"></span>' +
          '<span class="name"></span>' +
          '<span class="uptime">' + s.uptimeDay + ' · ' + s.timeDay + ' мс</span>' +
          '<span class="chevron">→</span>';
      } else {
        row.innerHTML =
          '<img class="favicon" src="api/' + s.slug + '/favicon.ico" alt="" onerror="this.style.display=\'none\'">' +
          '<span class="dot ' + (up ? 'up' : 'down') + '"></span>' +
          '<span class="name"></span>' +
          '<span class="uptime">' + s.uptimeDay + ' · ' + s.timeDay + ' мс</span>' +
          '<span class="chevron">→</span>';
      }
      row.querySelector('.name').textContent = cleanName;
      rowsEl.appendChild(row);
    }

    const openInc = Object.entries(incidents || {}).filter(([, i]) => !i.maintenance);
    const maint = Object.entries(incidents || {}).filter(([, i]) => i.maintenance);
    const past = (log || []).slice().reverse();

    incEl.innerHTML = ''; pastEl.innerHTML = '';
    document.getElementById('incTitle').style.display = openInc.length ? '' : 'none';
    document.getElementById('maintTitle').style.display = maint.length ? '' : 'none';
    document.getElementById('pastTitle').style.display = past.length ? '' : 'none';

    for (const [, info] of openInc) incEl.appendChild(card(info, true));
    for (const [, info] of maint) document.getElementById('maintenance').appendChild(card(info, true, true));
    for (const info of past.slice(0, 10)) pastEl.appendChild(card(info, false));
  }

  function card(info, active, isMaint) {
    const d = document.createElement('div');
    d.className = 'incident';
    const when = new Date(info.opened).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    const txt = isMaint ? 'плановые работы с ' + when
      : (active ? 'недоступен с ' : 'устранён за ' + info.minutes + ' мин (открыт ') + when + (active ? '' : ')');
    d.innerHTML = '<b></b> — ' + txt +
      ' — <a href="https://github.com/' + owner + '/' + repo + '/issues/' + info.issue_number + '">репорт #' + info.issue_number + '</a>';
    d.querySelector('b').textContent = info.name || 'Сервис';
    return d;
  }

  const y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();

  await loadAll();
  setInterval(loadAll, 60000);
})();