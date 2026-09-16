// Runicore Status — страница статистики сайта
(async function () {
  const banner = document.getElementById('banner');
  const updatedEl = document.getElementById('updated');
  const nameEl = document.getElementById('siteName');
  const statsEl = document.getElementById('stats');
  const pastEl = document.getElementById('past');
  const tabs = document.getElementById('rangeTabs');

  const params = new URLSearchParams(location.search);
  const slug = params.get('site') || '';
  let chart = null;
  let range = 24;
  let cachedPoints = [];
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

  function incidentCard(info, isMaint) {
    const mode = info.mode || (info.annulled ? 'annulled' : (info.hidden ? 'hidden' : (isMaint ? 'maintenance' : 'incident')));
    if (mode === 'hidden') return null;
    const d = document.createElement('a');
    d.className = 'incident ' + mode;
    const started = new Date(info.opened).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    const resolved = info.resolved ? new Date(info.resolved).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : null;
    let txt;
    if (mode === 'maintenance') {
      txt = 'плановые работы' + (resolved ? ' завершены' : ' (идут)');
    } else if (mode === 'annulled') {
      txt = 'аннулировано';
    } else {
      txt = resolved ? 'устранён' : 'недоступен (открыт ' + started + ')';
    }
    // Клик по карточке — страница события (всё внутри сайта, без GitHub)
    if (info.issue_number) d.href = 'incident.html?issue=' + info.issue_number;
    const meta = resolved
      ? '<span class="t">Начато: ' + started + ' МСК · Закрыто: ' + resolved + ' МСК · Длительность: ' + pluralMin(info.minutes || 0) + '</span>'
      : '<span class="t">Начато: ' + started + ' МСК</span>';
    const name = info.title || (info.name || 'Сервис');
    d.innerHTML = '<b></b> — ' + esc(txt) + meta;
    d.querySelector('b').textContent = name;
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
      const [summary, points, log] = await Promise.all([
        fetchJson('history/summary.json'),
        fetchJson('api/' + slug + '/points.json').catch(() => []),
        fetchJson('api/incidents-log.json').catch(() => []),
      ]);
      cachedPoints = points || [];
      const s = summary.find((x) => x.slug === slug);
      if (!s) { banner.className = 'banner fail'; banner.textContent = 'Сайт не найден'; return; }
      const clean = s.name.replace(EMOJI_RE, '').trim();
      document.title = clean + ' — Runicore';
      nameEl.textContent = clean;

      if (updatedEl) {
        // Время реального обновления данных мониторинга (из summary.json)
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
            // Сбрасываем градиентную заливку h1 (-webkit-text-fill-color: transparent),
            // иначе эмодзи-флаг рендерится белым
            favEl.outerHTML = '<span id="siteFavicon" style="font-size:28px; vertical-align:middle; margin-right:10px; -webkit-text-fill-color:initial; background:none;">' + emoji + '</span>';
          }
        }
      }

      const up = s.status === 'up';
      // Индикатор-точка перед названием вместо баннера-смайлика — меньше визуального шума
      banner.style.display = 'none';
      const dotEl = document.getElementById('siteDot');
      if (dotEl) {
        dotEl.className = 'dot ' + (up ? 'up' : 'down');
        dotEl.style.display = '';
      }
      document.title = clean + ' — Runicore';

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

      const siteLog = (log || []).filter((i) => i.slug === slug && !i.hidden).slice(-20)
        .sort((a, b) => new Date(b.resolved || b.opened) - new Date(a.resolved || a.opened));
      pastEl.innerHTML = '';
      const pastTitle = document.getElementById('pastTitle');
      if (pastTitle) pastTitle.style.display = siteLog.length ? '' : 'none';
      for (const info of siteLog) {
        const card = incidentCard(info, info.maintenance);
        if (card) pastEl.appendChild(card);
      }
    } catch (e) {
      banner.className = 'banner fail';
      banner.textContent = '⚠ Не удалось загрузить данные';
    }
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
  
  const y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();

  await load();
  setInterval(load, 60000);
})();