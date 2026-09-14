// Runicore Status — главная страница. Автор: Freidzher
// Данные: history/summary.json + api/incidents*.json
(async function () {
  const banner = document.getElementById('banner');
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
    } catch (e) {
      banner.className = 'banner fail';
      banner.textContent = '⚠ Не удалось загрузить данные мониторинга';
    }
  }

  function render(summary, incidents, log) {
    if (!summary.length) { banner.textContent = 'Нет данных — монитор ещё не запускался'; return; }

    // Banner
    const allUp = summary.every((s) => s.status === 'up');
    banner.className = 'banner ' + (allUp ? 'ok' : 'fail');
    banner.innerHTML = allUp
      ? '<span class="icon">🟢</span> Все сервисы работают'
      : '<span class="icon">🔴</span> Сервисы нестабильны';

    // Live Status — список серверов
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
          '<span class="favicon emoji">' + emoji + '</span>' +
          '<span class="dot ' + (up ? 'up' : 'down') + '"></span>' +
          '<span class="name"></span>' +
          '<span class="uptime"><b>' + s.uptimeDay + '</b> · ' + s.timeDay + ' мс</span>' +
          '<span class="chevron">→</span>';
      } else {
        row.innerHTML =
          '<img class="favicon" src="api/' + s.slug + '/favicon.ico" alt="" onerror="this.style.display=\'none\'">' +
          '<span class="dot ' + (up ? 'up' : 'down') + '"></span>' +
          '<span class="name"></span>' +
          '<span class="uptime"><b>' + s.uptimeDay + '</b> · ' + s.timeDay + ' мс</span>' +
          '<span class="chevron">→</span>';
      }
      row.querySelector('.name').textContent = cleanName;
      rowsEl.appendChild(row);
    }

    // Active Incidents — открытые инциденты (не maintenance)
    const openInc = Object.entries(incidents || {}).filter(([, i]) => !i.maintenance);
    incEl.innerHTML = '';
    document.getElementById('incTitle').style.display = openInc.length ? '' : 'none';
    for (const [, info] of openInc) incEl.appendChild(incidentCard(info, true, false));

    // Scheduled Maintenance — открытые maintenance
    const maint = Object.entries(incidents || {}).filter(([, i]) => i.maintenance);
    maintEl.innerHTML = '';
    document.getElementById('maintTitle').style.display = maint.length ? '' : 'none';
    for (const [, info] of maint) maintEl.appendChild(incidentCard(info, true, true));

    // Past Incidents — закрытые инциденты из журнала (последние 10)
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