// Runicore Status — страница сервиса (использует assets/common.js)
(async function () {
  const banner = document.getElementById('banner');
  const updatedEl = document.getElementById('updated');
  const nameEl = document.getElementById('siteName');
  const statsEl = document.getElementById('stats');
  const pastEl = document.getElementById('past');
  const pastPagerEl = document.getElementById('pastPager');
  const tabs = document.getElementById('rangeTabs');
  const { EMOJI_RE, incidentCard, setFooterYear, fetchJson, renderPager } = window.Runicore;

  setFooterYear();

  const params = new URLSearchParams(location.search);
  const slug = params.get('site') || '';
  let chart = null;
  let range = 24;
  let cachedPoints = [];
  const PAST_PAGE_SIZE = 10;
  let allPast = [];
  let pastPage = 1;
  let commentsByIssue = {};

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
            const p = pts[ctx.dataIndex];
            return p && p.ok ? '#2ecc71' : '#ff4f6d';
          },
          backgroundColor: (ctx) => {
            const p = pts[ctx.dataIndex];
            return p && p.ok ? 'rgba(46,204,113,.15)' : 'rgba(255,79,109,.15)';
          },
          pointBackgroundColor: pts.map((e) => (e.annulled ? '#8a9b8f' : (e.maint ? '#f1c40f' : (e.ok ? '#2ecc71' : '#ff4f6d')))),
          pointRadius: (ctx) => (pts[ctx.dataIndex] && pts[ctx.dataIndex].maint ? 3.5 : 2),
          fill: true,
          tension: 0.35,
          segment: {
            borderColor: (ctx) => {
              const p0 = pts[ctx.p0DataIndex];
              const p1 = pts[ctx.p1DataIndex];
              return (p0 && p0.ok && p1 && p1.ok) ? '#2ecc71' : '#ff4f6d';
            }
          },
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
      const [summary, points, log, comments] = await Promise.all([
        fetchJson('history/summary.json'),
        fetchJson('api/' + slug + '/points.json').catch(() => []),
        fetchJson('api/incidents-log.json').catch(() => []),
        fetchJson('api/issue-comments.json').catch(() => ({})),
      ]);
      cachedPoints = points || [];
      commentsByIssue = comments || {};
      const s = summary.find((x) => x.slug === slug);
      if (!s) { banner.className = 'banner fail'; banner.textContent = 'Сайт не найден'; return; }
      const clean = s.name.replace(EMOJI_RE, '').trim();
      document.title = clean + ' — Runicore';
      nameEl.textContent = clean;

      if (updatedEl) {
        const ts = s.updatedAt || null;
        const when = ts
          ? new Date(ts).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })
          : new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
        updatedEl.textContent = 'Обновлено: ' + when + ' МСК';
      }

      const favEl = document.getElementById('siteFavicon');
      if (favEl) {
        if (s.icon) {
          favEl.src = 'api/' + slug + '/' + s.icon;
          favEl.style.display = '';
          favEl.onerror = () => { favEl.style.display = 'none'; };
        } else {
          const emoji = (s.name.match(EMOJI_RE) || [''])[0];
          if (emoji) {
            favEl.outerHTML = '<span id="siteFavicon" style="font-size:28px; vertical-align:middle; margin-right:10px; -webkit-text-fill-color:initial; background:none;">' + emoji + '</span>';
          }
        }
      }

      const up = s.status === 'up';
      banner.style.display = 'none';
      const dotEl = document.getElementById('siteDot');
      if (dotEl) {
        dotEl.className = 'dot ' + (up ? 'up' : 'down');
        dotEl.style.display = '';
      }

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

      renderChart(cachedPoints);

      allPast = (log || []).filter((i) => i.slug === slug && !i.hidden)
        .sort((a, b) => new Date(b.resolved || b.opened) - new Date(a.resolved || a.opened));
      const pastTitle = document.getElementById('pastTitle');
      if (pastTitle) pastTitle.style.display = allPast.length ? '' : 'none';
      renderPast();
    } catch (e) {
      banner.className = 'banner fail';
      banner.textContent = '⚠ Не удалось загрузить данные';
    }
  }

  // Отрисовка текущей страницы «Прошлых событий» + переключатель страниц
  function renderPast() {
    const total = Math.max(1, Math.ceil(allPast.length / PAST_PAGE_SIZE));
    if (pastPage > total) pastPage = total;
    if (pastPage < 1) pastPage = 1;
    const start = (pastPage - 1) * PAST_PAGE_SIZE;
    pastEl.innerHTML = '';
    for (const info of allPast.slice(start, start + PAST_PAGE_SIZE)) {
      const card = incidentCard(info, !info.resolved, null, commentsByIssue);
      if (card) pastEl.appendChild(card);
    }
    renderPager(pastPagerEl, total, pastPage, (p) => { pastPage = p; renderPast(); });
  }

  if (tabs) {
    tabs.addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON') return;
      range = Number(e.target.dataset.r);
      tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === e.target));
      renderChart(cachedPoints);
    });
    tabs.querySelector('button[data-r="24"]').classList.add('active');
  }

  await load();
  setInterval(load, 60000);
})();