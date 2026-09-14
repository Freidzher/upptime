// Runicore Status — страница статистики сайта
(async function () {
  const banner = document.getElementById('banner');
  const nameEl = document.getElementById('siteName');
  const statsEl = document.getElementById('stats');
  const pastEl = document.getElementById('past');
  const tabs = document.getElementById('rangeTabs');

  const params = new URLSearchParams(location.search);
  const slug = params.get('site') || '';
  let chart = null;
  let range = 24;
  const EMOJI_RE = /^[\u{1F1E6}-\u{1F1FF}]{2}|^[\u{1F300}-\u{1FAFF}]|^[\u2600-\u{27BF}]\uFE0F?/u;

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

  function incidentCard(info) {
    const d = document.createElement('div');
    d.className = 'incident';
    const opened = new Date(info.opened).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    const resolved = info.resolved ? new Date(info.resolved).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : null;
    const minutes = info.minutes || '?';
    const txt = resolved
      ? 'устранён за ' + minutes + ' мин (открыт ' + opened + ', закрыт ' + resolved + ')'
      : 'открыт ' + opened;
    const issueNum = info.issue_number || info.issueNumber;
    const link = (owner && repo && issueNum)
      ? ' — <a href="https://github.com/' + esc(owner) + '/' + esc(repo) + '/issues/' + issueNum + '">репорт #' + issueNum + '</a>'
      : '';
    d.innerHTML = '<b></b> — ' + esc(txt) + link;
    d.querySelector('b').textContent = info.name || 'Сервис';
    return d;
  }

  function renderChart(entries) {
    const cutoff = Date.now() - range * 3600 * 1000;
    const pts = entries.filter((e) => new Date(e.ts).getTime() > cutoff);
    if (chart) chart.destroy();
    chart = new Chart(document.getElementById('chart'), {
      type: 'line',
      data: {
        labels: pts.map((e) => new Date(e.ts).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })),
        datasets: [{
          data: pts.map((e) => e.ms),
          borderColor: (ctx) => {
            const i = ctx.dataIndex;
            const p = pts[i];
            return p && p.ok ? '#2ecc71' : '#ff4f6d';
          },
          backgroundColor: (ctx) => {
            const i = ctx.dataIndex;
            const p = pts[i];
            return p && p.ok ? 'rgba(46,204,113,.15)' : 'rgba(255,79,109,.15)';
          },
          pointBackgroundColor: pts.map((e) => (e.ok ? '#2ecc71' : '#ff4f6d')),
          pointRadius: 2, fill: true, tension: 0.35, segment: { borderColor: (ctx) => ctx.p0.parsed.y && ctx.p1.parsed.y ? (pts[ctx.p0DataIndex].ok && pts[ctx.p1DataIndex].ok ? '#2ecc71' : '#ff4f6d') : 'rgba(255,79,139,.5)' },
        }],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: 'rgba(255,255,255,0.4)', maxTicksLimit: 8 }, grid: { display: false } },
          y: { ticks: { color: 'rgba(255,255,255,0.4)' }, grid: { color: 'rgba(46, 204, 113, 0.08)' }, beginAtZero: true },
        },
      },
    });
  }

  async function load() {
    try {
      const [summary, points, log] = await Promise.all([
        fetchJson('history/summary.json'),
        fetchJson('api/' + slug + '/points.json').catch(() => []),
        fetchJson('api/incidents-log.json').catch(() => []),
      ]);
      const s = summary.find((x) => x.slug === slug);
      if (!s) { banner.className = 'banner fail'; banner.textContent = 'Сайт не найден'; return; }
      const clean = s.name.replace(EMOJI_RE, '').trim();
      document.title = clean + ' — Runicore';
      nameEl.textContent = clean;

      const up = s.status === 'up';
      banner.className = 'banner ' + (up ? 'ok' : 'fail');
      banner.innerHTML = up ? '<span class="icon">🟢</span> Работает' : '<span class="icon">🔴</span> Недоступен';

      const stats = [
        { v: s.timeDay + ' мс', l: 'Отклик 24ч' }, { v: s.timeWeek + ' мс', l: 'Отклик 7д' },
        { v: s.timeMonth + ' мс', l: 'Отклик 30д' }, { v: s.timeYear + ' мс', l: 'Отклик 1г' },
        { v: s.uptimeDay, l: 'Аптайм 24ч' }, { v: s.uptimeWeek, l: 'Аптайм 7д' },
        { v: s.uptimeMonth, l: 'Аптайм 30д' }, { v: s.uptimeYear, l: 'Аптайм 1г' },
      ];
      statsEl.innerHTML = '';
      for (const st of stats) {
        const d = document.createElement('div');
        d.className = 'stat';
        d.innerHTML = '<div class="v"></div><div class="l"></div>';
        d.querySelector('.v').textContent = st.v;
        d.querySelector('.l').textContent = st.l;
        statsEl.appendChild(d);
      }

      renderChart(points || []);

      // Past Incidents — инциденты этого сайта
      const siteLog = (log || []).filter((i) => i.slug === slug).slice(-20).reverse();
      pastEl.innerHTML = '';
      const pastTitle = document.getElementById('pastTitle');
      if (pastTitle) pastTitle.style.display = siteLog.length ? '' : 'none';
      for (const info of siteLog) pastEl.appendChild(incidentCard(info));
    } catch (e) {
      banner.className = 'banner fail';
      banner.textContent = '⚠ Не удалось загрузить данные';
    }
  }

  if (tabs) {
    tabs.addEventListener('click', async (e) => {
      if (e.target.tagName !== 'BUTTON') return;
      range = Number(e.target.dataset.r);
      tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === e.target));
      const pts = await fetch('api/' + slug + '/points.json?t=' + Date.now()).then(r => r.json()).catch(() => []);
      renderChart(pts || []);
    });
    tabs.querySelector('button[data-r="24"]').classList.add('active');
  }

  await load();
  setInterval(load, 60000);
})();