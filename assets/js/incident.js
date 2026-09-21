// Runicore Status — страница события (использует assets/common.js)
(async function () {
  const titleEl = document.getElementById('evtTitle');
  const cardEl = document.getElementById('evtCard');
  const statusEl = document.getElementById('evtStatus');
  const metaEl = document.getElementById('evtMeta');
  const descEl = document.getElementById('evtDesc');
  const linkEl = document.getElementById('serviceLink');
  const { fmtTs, pluralMin, modeOf, setFooterYear, fetchJson } = window.Runicore;

  setFooterYear();

  const params = new URLSearchParams(location.search);
  const issueNum = Number(params.get('issue') || 0);

  function render(info, active) {
    const mode = modeOf(info, info.maintenance);
    cardEl.className = 'evt ' + mode;
    const started = fmtTs(info.opened);
    const resolved = fmtTs(info.resolved);

    let status;
    if (mode === 'maintenance') status = active ? 'Идут плановые работы' : 'Плановые работы завершены';
    else if (mode === 'annulled') status = active ? 'Событие аннулировано (идёт)' : 'Событие аннулировано';
    else status = active ? 'Сервис недоступен' : 'Восстановлено';

    const label = { incident: 'Инцидент', maintenance: 'Техработы', annulled: 'Аннулировано', hidden: 'Скрыто' }[mode];
    const name = info.name || (info.title || 'Сервис').replace(/ — недоступен$/, '').replace(/ — техработы$/, '');
    titleEl.textContent = name + ' · ' + label;
    document.title = (info.title || 'Событие') + ' — Runicore';

    statusEl.textContent = status;
    const parts = ['Начато: ' + started + ' МСК'];
    if (resolved) parts.push('Закрыто: ' + resolved + ' МСК');
    if (info.minutes) parts.push('Длительность: ' + pluralMin(info.minutes));
    if (info.code !== undefined) parts.push('Код ошибки: ' + info.code);
    if (info.ms !== undefined) parts.push('Время отклика: ' + (info.ms || 0) + ' мс');
    metaEl.innerHTML = parts.map((p) => '<span>' + p + '</span>').join('');
    // Ссылка на страницу сервиса (без GitHub): «Страница сервиса → {название}»
    if (info.slug) {
      linkEl.href = 'site.html?site=' + encodeURIComponent(info.slug);
      linkEl.style.display = '';
      linkEl.textContent = 'Страница сервиса → ' + (info.name || name);
    }
    descEl.textContent = info.desc || '';
  }

  try {
    const [incidents, log] = await Promise.all([
      fetchJson('api/incidents.json').catch(() => ({})),
      fetchJson('api/incidents-log.json').catch(() => []),
    ]);
    const active = Object.values(incidents || {}).find((i) => i.issue_number === issueNum);
    if (active) { render(active, true); return; }
    const past = (log || []).find((i) => i.issue_number === issueNum);
    if (past) { render(past, false); return; }
    titleEl.textContent = 'Событие не найдено';
    statusEl.textContent = 'Возможно, оно скрыто или ещё не синхронизировано.';
  } catch (e) {
    titleEl.textContent = 'Не удалось загрузить событие';
  }
})();