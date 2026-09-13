// Runicore Status — страница статистики сайта. Автор: Freidzher
// Данные: history/summary.json (агрегаты) + api/{slug}/points.json (график)
(async function () {
  const banner = document.getElementById('banner');
  const nameEl = document.getElementById('siteName');
  const statsEl = document.getElementById('stats');

  const params = new URLSearchParams(location.search);
  const slug = params.get('site') || '';

  async function fetchJson(url) {
    const r = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error(url);
    return r.json();
  }

  function drawChart(canvas, entries) {
    const pts = entries.slice(-48);
    new Chart(canvas, {
      type: 'line',
      data: {
        labels: pts.map((e) => new Date(e.ts).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })),
        datasets: [{
          data: pts.map((e) => e.ms),
          borderColor: 'rgba(255,79,139,0.9)',
          backgroundColor: 'rgba(255,79,139,0.15)',
          pointBackgroundColor: pts.map((e) => (e.ok ? 'rgba(255,79,139,.9)' : 'rgba(255,79,109,1)')),
          pointRadius: 2, fill: true, tension: 0.35,
        }],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: 'rgba(255,255,255,0.4)', maxTicksLimit: 8 }, grid: { display: false } },
          y: { ticks: { color: 'rgba(255,255,255,0.4)' }, grid: { color: 'rgba(255,79,139,0.08)' }, beginAtZero: true },
        },
      },
    });
  }

  async function load() {
    try {
      const [summary, points] = await Promise.all([
        fetchJson('history/summary.json'),
        fetchJson('api/' + slug + '/points.json').catch(() => []),
      ]);
      const s = summary.find((x) => x.slug === slug);
      if (!s) {
        banner.className = 'banner fail';
        banner.textContent = 'Сайт не найден';
        return;
      }
      document.title = s.name + ' — Runicore';
      nameEl.textContent = s.name;

      const up = s.status === 'up';
      banner.className = 'banner ' + (up ? 'ok' : 'fail');
      banner.innerHTML = up ? '<span class="icon">🟢</span> Работает' : '<span class="icon">🔴</span> Недоступен';

      const stats = [
        { v: up ? '🟢 UP' : '🔴 DOWN', l: 'Текущий статус' },
        { v: s.timeDay + ' мс', l: 'Отклик за 24ч' },
        { v: s.timeWeek + ' мс', l: 'Отклик за 7д' },
        { v: s.uptimeDay, l: 'Аптайм 24 часа' },
        { v: s.uptimeWeek, l: 'Аптайм 7 дней' },
        { v: s.uptimeMonth, l: 'Аптайм 30 дней' },
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

      drawChart(document.getElementById('chart'), points || []);
    } catch (e) {
      banner.className = 'banner fail';
      banner.textContent = '⚠ Не удалось загрузить данные';
    }
  }

  await load();
  setInterval(load, 60000);
})();