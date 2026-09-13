// Runicore Status — страница статистики сайта. Автор: Freidzher
// Данные: data/status.json, ключ из URL (?site=KEY)
(async function () {
  const banner = document.getElementById('banner');
  const updated = document.getElementById('updated');
  const nameEl = document.getElementById('siteName');
  const statsEl = document.getElementById('stats');

  const params = new URLSearchParams(location.search);
  const key = params.get('site') || '';

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
      const [cfg, data] = await Promise.all([
        fetchJson('config.json').catch(() => ({})),
        fetchJson('data/status.json'),
      ]);
      const entry = data[key];
      const pts = entry ? (Array.isArray(entry) ? entry : entry.points || []) : [];
      const namesCfg = cfg.names || {};
      const name = namesCfg[key] || (entry && !Array.isArray(entry) && entry.name) || key || 'Неизвестный сайт';
      document.title = name + ' — Runicore';
      nameEl.textContent = name;

      if (!pts.length) {
        banner.className = 'banner fail';
        banner.textContent = 'Нет данных по этому сайту';
        return;
      }

      const last = pts[pts.length - 1];
      banner.className = 'banner ' + (last.ok ? 'ok' : 'fail');
      banner.innerHTML = last.ok ? '<span class="icon">🟢</span> Работает' : '<span class="icon">🔴</span> Недоступен';
      updated.textContent = 'Обновлено: ' + new Date(last.ts).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', second: '2-digit' });

      const now = Date.now();
      const uptime = (hours) => {
        const cutoff = now - hours * 3600 * 1000;
        const r = pts.filter((e) => new Date(e.ts).getTime() > cutoff);
        return r.length ? ((r.filter((e) => e.ok).length / r.length) * 100).toFixed(1) + '%' : '—';
      };
      const recent = pts.filter((e) => new Date(e.ts).getTime() > now - 24 * 3600 * 1000);
      const avgMs = recent.length ? Math.round(recent.reduce((s, e) => s + e.ms, 0) / recent.length) : 0;

      const stats = [
        { v: last.ok ? '🟢 UP' : '🔴 DOWN', l: 'Текущий статус' },
        { v: last.ms + ' мс', l: 'Отклик сейчас' },
        { v: avgMs + ' мс', l: 'Средний за 24ч' },
        { v: uptime(24), l: 'Аптайм 24 часа' },
        { v: uptime(24 * 7), l: 'Аптайм 7 дней' },
        { v: recent.length, l: 'Проверок за 24ч' },
      ];
      statsEl.innerHTML = '';
      for (const s of stats) {
        const d = document.createElement('div');
        d.className = 'stat';
        d.innerHTML = '<div class="v"></div><div class="l"></div>';
        d.querySelector('.v').textContent = s.v;
        d.querySelector('.l').textContent = s.l;
        statsEl.appendChild(d);
      }

      drawChart(document.getElementById('chart'), pts);
    } catch (e) {
      banner.className = 'banner fail';
      banner.textContent = '⚠ Не удалось загрузить данные';
    }
  }

  await load();
  setInterval(load, 60000);
})();