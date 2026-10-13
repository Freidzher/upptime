// Runicore Status — страница события (использует assets/common.js)
(async function () {
  const titleEl = document.getElementById('evtTitle');
  const cardEl = document.getElementById('evtCard');
  const statusEl = document.getElementById('evtStatus');
  const metaEl = document.getElementById('evtMeta');
  const descEl = document.getElementById('evtDesc');
  const linkEl = document.getElementById('serviceLink');
  const commentsEl = document.getElementById('evtComments');
  const { fmtTs, pluralMin, modeOf, setFooterYear, fetchJson, esc, EMOJI_RE } = window.Runicore;

  setFooterYear();

  const params = new URLSearchParams(location.search);
  const issueNum = Number(params.get('issue') || 0);

  function render(info, active) {
    const mode = modeOf(info, info.maintenance);
    cardEl.className = 'evt ' + mode;
    const started = fmtTs(info.opened);
    const resolved = fmtTs(info.resolved);

    const label = { incident: 'Инцидент', maintenance: 'Техработы', annulled: 'Аннулировано', hidden: 'Скрыто' }[mode];
    let status;
    if (mode === 'maintenance') status = active ? 'Идут плановые работы' : 'Плановые работы завершены';
    else if (mode === 'annulled') status = active ? 'Событие аннулировано (идёт)' : 'Событие аннулировано';
    else status = active ? 'Сервис недоступен' : 'Восстановлено';
    // Лейбл типа события переносим в статус: «Инцидент · Восстановлено»
    status = label + ' · ' + status;

    const name = info.name || (info.title || 'Сервис').replace(/ — недоступен$/, '').replace(/ — техработы$/, '');
    titleEl.textContent = name;
    document.title = name + ' — Событие — Runicore';

    statusEl.textContent = status;
    const parts = ['Начато: ' + started + ' МСК'];
    if (resolved) parts.push('Закрыто: ' + resolved + ' МСК');
    if (info.minutes) parts.push('Длительность: ' + pluralMin(info.minutes));
    metaEl.innerHTML = parts.map((p) => '<span>' + p + '</span>').join('');

    // Описание показываем только если оно добавляет что-то сверх шапки
    // (иначе «Код ошибки / Время отклика» дублируются дважды)
    const desc = (info.desc || '').trim();
    const metaText = parts.join('\n');
    const duplicatesMeta = !desc || metaText.includes(desc.replace(/^- /gm, '').trim());
    descEl.textContent = duplicatesMeta ? '' : desc;
    descEl.style.display = duplicatesMeta ? 'none' : '';

    // Ссылка на страницу сервиса (без GitHub): «Страница сервиса → {название}»
    if (info.slug) {
      linkEl.href = 'site.html?site=' + encodeURIComponent(info.slug);
      linkEl.style.display = '';
      linkEl.textContent = 'Страница сервиса → ' + (info.name || name);
    }
  }

  // Фавикон самого сервиса (как на index/site): api/{slug}/{icon}, иначе эмодзи из имени
  function applyFavicon(info, summary) {
    const el = document.getElementById('evtFavicon');
    if (!el || !info.slug) return;
    const svc = (summary || []).find((x) => x.slug === info.slug);
    if (svc && svc.icon) {
      el.src = 'api/' + info.slug + '/' + svc.icon;
      el.style.display = '';
      el.onerror = () => { el.style.display = 'none'; };
    } else {
      const src = svc ? svc.name : (info.name || '');
      const m = src.match(EMOJI_RE);
      if (m && m[0]) {
        el.outerHTML = '<span id="evtFavicon" class="logo-emoji">' + m[0] + '</span>';
      } else {
        el.style.display = 'none';
      }
    }
  }

  // Комментарии администратора из GitHub Issues (api/issue-comments.json)
  function renderComments(list) {
    if (!commentsEl) return;
    commentsEl.innerHTML = '';
    const items = (list || []).filter((c) => c && (c.body || '').trim());
    if (!items.length) { commentsEl.style.display = 'none'; return; }
    commentsEl.style.display = '';
    for (const c of items) {
      const item = document.createElement('div');
      item.className = 'comment';
      const when = fmtTs(c.created_at);
      const head = document.createElement('div');
      head.className = 'comment-head';
      head.innerHTML = '<b>' + esc('Администратор:') + '</b>' +
        (when ? '<span class="comment-time">' + esc(when + ' МСК') + '</span>' : '');
      const body = document.createElement('div');
      body.className = 'comment-body';
      body.textContent = c.body;  // textContent безопасно экранирует
      item.appendChild(head);
      item.appendChild(body);
      commentsEl.appendChild(item);
    }
  }

  try {
    const [incidents, log, comments, summary] = await Promise.all([
      fetchJson('api/incidents.json').catch(() => ({})),
      fetchJson('api/incidents-log.json').catch(() => []),
      fetchJson('api/issue-comments.json').catch(() => ({})),
      fetchJson('history/summary.json').catch(() => []),
    ]);
    const byIssue = comments || {};
    const active = Object.values(incidents || {}).find((i) => i.issue_number === issueNum);
    if (active) { render(active, true); applyFavicon(active, summary); renderComments(byIssue[String(issueNum)]); return; }
    const past = (log || []).find((i) => i.issue_number === issueNum);
    if (past) { render(past, false); applyFavicon(past, summary); renderComments(byIssue[String(issueNum)]); return; }
    titleEl.textContent = 'Событие не найдено';
    statusEl.textContent = 'Возможно, оно скрыто или ещё не синхронизировано.';
  } catch (e) {
    titleEl.textContent = 'Не удалось загрузить событие';
  }
})();
