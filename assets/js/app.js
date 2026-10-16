// Runicore Status — главная страница (использует assets/js/common.js). Автор: Freidzher
(async function () {
  const banner = document.getElementById('banner');
  const updatedEl = document.getElementById('updated');
  const rowsEl = document.getElementById('rows');
  const incEl = document.getElementById('incidents');
  const pastEl = document.getElementById('past');
  const pastPagerEl = document.getElementById('pastPager');
  const { EMOJI_RE, setFooterYear, fetchJson, renderPager, groupByIssue, renderEventGroup } = window.Runicore;

  const PAST_PAGE_SIZE = 10;
  let allPastGroups = [];
  let pastPage = 1;
  let commentsByIssue = {};
  let sumBySlug = {};

  setFooterYear();

  async function loadAll() {
    try {
      const [summary, cur, log, comments] = await Promise.all([
        fetchJson('history/summary.json'),
        fetchJson('api/incidents.json').catch(() => ({})),
        fetchJson('api/incidents-log.json').catch(() => []),
        fetchJson('api/issue-comments.json').catch(() => ({})),
      ]);
      render(summary, cur, log, comments || {});
      if (updatedEl) {
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

  function render(summary, incidents, log, byIssue) {
    // Заголовок списка сервисов — только когда есть что показывать.
    // Считаем сервисы: группы-заголовки (isGroup) в счёт не идут; если сервисов
    // нет вовсе — показываем количество серверов-групп.
    const rowsTitleEl = document.getElementById('rowsTitle');
    if (rowsTitleEl) {
      rowsTitleEl.style.display = summary.length ? '' : 'none';
      const svcCount = summary.filter((s) => !s.isGroup).length;
      rowsTitleEl.textContent = '🦄 Все сервисы (' + (svcCount || summary.length) + ')';
    }
    if (!summary.length) { banner.textContent = 'Нет данных — монитор ещё не запускался'; return; }
    commentsByIssue = byIssue || {};
    sumBySlug = {};
    for (const s of summary) sumBySlug[s.slug] = s;
    // Сервисы под плановыми техработами (активные maintenance-инциденты)
    const maintSlugs = new Set(Object.values(incidents || {})
      .filter((i) => i.maintenance && i.slug).map((i) => i.slug));
    // Сервисы под «Возможными ограничениями» (РКН) — активные rkn-инциденты
    const rknSlugs = new Set(Object.values(incidents || {})
      .filter((i) => (i.mode || '') === 'rkn' && i.slug).map((i) => i.slug));

    const allUp = summary.every((s) => s.status === 'up');
    banner.className = 'banner ' + (allUp ? 'ok' : 'fail');
    const hasMaint = Object.values(incidents || {}).some((i) => i.maintenance);
    const hasRkn = Object.values(incidents || {}).some((i) => (i.mode || '') === 'rkn');
    // Кружок баннера: слева статус (зелёный/красный), справа жёлтый при техработах / голубой при РКН
    const dotFlag = hasMaint ? ' maint' : (hasRkn ? ' rkn' : '');
    const dotCls = 'banner-dot' + (allUp ? '' : ' fail') + dotFlag;
    banner.innerHTML = '<span class="' + dotCls + '"></span> ' + (allUp ? 'Все сервисы работают' : 'Сервисы нестабильны');

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
        // Техработы у головы группы или у любого вложенного сервиса
        const gMaint = maintSlugs.has(s.slug) ||
          summary.some((x) => x.group && x.group.startsWith(s.group + '.') && maintSlugs.has(x.slug));
        // РКН у головы группы или у любого вложенного сервиса
        const gRkn = rknSlugs.has(s.slug) ||
          summary.some((x) => x.group && x.group.startsWith(s.group + '.') && rknSlugs.has(x.slug));
        // Кликабельный заголовок группы (ВМ): флаг-эмодзи, uptime и текущий отклик
        const head = document.createElement('a');
        head.className = 'group-head ' + (gUp ? 'up' : 'down') + (gMaint ? ' maint' : (gRkn ? ' rkn' : ''));
        head.href = 'site.html?site=' + encodeURIComponent(s.slug);
        head.innerHTML =
          '<span class="dot ' + (gUp ? 'up' : 'down') + (gMaint ? ' maint' : (gRkn ? ' rkn' : '')) + '"></span>' +
          (emoji && !s.icon ? '<span class="favicon emoji">' + emoji + '</span>' : '') +
          (s.icon ? '<img class="favicon" src="api/' + s.slug + '/' + s.icon + '" alt="" onerror="this.style.display=\'none\'">' : '') +
          '<span class="name"></span>' +
          '<span class="group-status"><b>' + s.uptimeMonth + '</b><span class="ms">' + (s.timeMonth || 0) + ' мс</span></span>';
        head.querySelector('.name').textContent = cleanName;
        rowsEl.appendChild(head);
        continue;
      }
      const row = document.createElement('a');
      // Класс состояния (up/down + maint/rkn) — для цветной подсветки карточки (см. index.html)
      row.className = 'row' + (s.group ? ' nested' : '') + ' ' + (up ? 'up' : 'down') +
        (maintSlugs.has(s.slug) ? ' maint' : (rknSlugs.has(s.slug) ? ' rkn' : ''));
      row.href = 'site.html?site=' + encodeURIComponent(s.slug);
      const iconHtml = s.icon
        ? '<img class="favicon" src="api/' + s.slug + '/' + s.icon + '" alt="" onerror="this.style.display=\'none\'">'
        : (emoji ? '<span class="favicon emoji">' + emoji + '</span>' : '');
      row.innerHTML =
        '<span class="dot ' + (up ? 'up' : 'down') + (maintSlugs.has(s.slug) ? ' maint' : (rknSlugs.has(s.slug) ? ' rkn' : '')) + '"></span>' +
        iconHtml +
        '<span class="name"></span>' +
        '<span class="uptime"><b>' + s.uptimeMonth + '</b><span class="ms">' + (s.timeMonth || 0) + ' мс</span></span>';
      row.querySelector('.name').textContent = cleanName;
      rowsEl.appendChild(row);
    }

    // Активные события (hidden скрыты), новые сверху, с группировкой по Issue
    const openList = Object.values(incidents || {})
      .filter((i) => (i.mode || 'incident') !== 'hidden')
      .sort((a, b) => (b.issue_number || 0) - (a.issue_number || 0));
    const openGroups = groupByIssue(openList, sumBySlug)
      .sort((a, b) => ((b.main.issue_number || 0) - (a.main.issue_number || 0)));
    incEl.innerHTML = '';
    const incTitleEl = document.getElementById('incTitle');
    incTitleEl.textContent = '⚡️ Активные события' + (openList.length ? ' (' + openList.length + ')' : '');
    incTitleEl.style.display = openGroups.length ? '' : 'none';
    for (const g of openGroups) renderEventGroup(incEl, g, true, sumBySlug, byIssue);

    // Прошлые события — строго по номеру Issue (номер = порядок создания = хронология).
    // Группировка по Issue: один инцидент = одна карточка + раскрытие затронутых сервисов.
    const pastList = (log || []).filter((i) => !i.hidden)
      .sort((a, b) => (b.issue_number || 0) - (a.issue_number || 0));
    allPastGroups = groupByIssue(pastList, sumBySlug)
      .sort((a, b) => ((b.main.issue_number || 0) - (a.main.issue_number || 0)));
    const pastTitleEl = document.getElementById('pastTitle');
    const incCount = pastList.length;
    pastTitleEl.textContent = '✅ Прошлые события' + (incCount ? ' (' + incCount + ')' : '');
    pastTitleEl.style.display = allPastGroups.length ? '' : 'none';
    renderPast();
  }

  // Отрисовка текущей страницы «Прошлых событий» (группы по Issue) + переключатель
  function renderPast() {
    const total = Math.max(1, Math.ceil(allPastGroups.length / PAST_PAGE_SIZE));
    if (pastPage > total) pastPage = total;
    if (pastPage < 1) pastPage = 1;
    const start = (pastPage - 1) * PAST_PAGE_SIZE;
    pastEl.innerHTML = '';
    for (const g of allPastGroups.slice(start, start + PAST_PAGE_SIZE)) {
      renderEventGroup(pastEl, g, false, sumBySlug, commentsByIssue);
    }
    renderPager(pastPagerEl, total, pastPage, (p) => { pastPage = p; renderPast(); });
  }

  await loadAll();
  setInterval(loadAll, 60000);
})();
