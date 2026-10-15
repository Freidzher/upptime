// Runicore Status — страница события (использует assets/common.js)
(async function () {
  const titleEl = document.getElementById('evtTitle');
  const cardEl = document.getElementById('evtCard');
  const statusEl = document.getElementById('evtStatus');
  const metaEl = document.getElementById('evtMeta');
  const descEl = document.getElementById('evtDesc');
  const commentsEl = document.getElementById('evtComments');
  const linksEl = document.getElementById('serviceLinks');
  const { fmtTs, pluralMin, modeOf, setFooterYear, fetchJson, esc, EMOJI_RE } = window.Runicore;

  setFooterYear();

  const params = new URLSearchParams(location.search);
  const issueNum = Number(params.get('issue') || 0);

  // Фавикон/эмодзи сервиса из summary.json (как в списке на главной)
  function svcIconHtml(entry, sumBySlug) {
    const svc = sumBySlug[entry.slug];
    if (svc && svc.icon) {
      return '<img class="ev-fav" src="api/' + entry.slug + '/' + svc.icon + '" alt="" onerror="this.style.display=\'none\'">';
    }
    const src = svc ? svc.name : (entry.name || '');
    const m = src.match(EMOJI_RE);
    return (m && m[0]) ? '<span class="ev-fav emoji">' + m[0] + '</span>' : '';
  }

  // Имя сервиса без ведущего эмодзи (он уже в фавиконе)
  function cleanName(entry, sumBySlug) {
    const svc = sumBySlug[entry.slug];
    const nm = (svc ? svc.name : entry.name) || entry.name || 'Сервис';
    return nm.replace(EMOJI_RE, '').trim() || nm;
  }

  // Заголовок: названия ГЛАВНЫХ сервисов (isGroup); если их нет — все затронутые
  function renderTitle(affected, sumBySlug) {
    const heads = affected.filter((e) => sumBySlug[e.slug] && sumBySlug[e.slug].isGroup);
    const titleEntries = heads.length ? heads : affected;
    titleEl.innerHTML = titleEntries
      .map((e) => svcIconHtml(e, sumBySlug) + '<span class="svc-name">' + esc(cleanName(e, sumBySlug)) + '</span>')
      .join('<span class="title-sep">, </span>');
    document.title = titleEntries.map((e) => cleanName(e, sumBySlug)).join(', ') + ' — Событие — Runicore';
  }

  function renderCard(info, active) {
    const mode = modeOf(info, info.maintenance);
    cardEl.className = 'evt ' + mode;
    const started = fmtTs(info.opened);
    const resolved = fmtTs(info.resolved);
    const label = { incident: 'Инцидент', maintenance: 'Техработы', annulled: 'Аннулировано', hidden: 'Скрыто' }[mode];
    let status;
    if (mode === 'maintenance') status = active ? 'Идут плановые работы' : 'Плановые работы завершены';
    else if (mode === 'annulled') status = active ? 'Событие аннулировано (идёт)' : 'Событие аннулировано';
    else status = active ? 'Сервис недоступен' : 'Восстановлено';
    status = label + ' · ' + status;

    statusEl.textContent = status;
    const parts = ['Начато: ' + started + ' МСК'];
    if (resolved) parts.push('Закрыто: ' + resolved + ' МСК');
    if (info.minutes) parts.push('(🕑 ' + pluralMin(info.minutes) + ')');
    metaEl.innerHTML = parts.map((p) => '<span>' + p + '</span>').join('');

    const desc = (info.desc || '').trim();
    const metaText = parts.join('\n');
    const duplicatesMeta = !desc || metaText.includes(desc.replace(/^- /gm, '').trim());
    descEl.textContent = duplicatesMeta ? '' : desc;
    descEl.style.display = duplicatesMeta ? 'none' : '';
  }

  // Кнопки всех затронутых сервисов (включая подгруппы) — в самый низ
  function renderServiceLinks(affected, sumBySlug) {
    if (!linksEl) return;
    linksEl.innerHTML = '';
    const seen = new Set();
    for (const e of affected) {
      if (!e.slug || seen.has(e.slug)) continue;
      seen.add(e.slug);
      const a = document.createElement('a');
      a.className = 'service-btn';
      a.href = 'site.html?site=' + encodeURIComponent(e.slug);
      a.innerHTML = svcIconHtml(e, sumBySlug) + '<span>' + esc(cleanName(e, sumBySlug)) + '</span>';
      linksEl.appendChild(a);
    }
    linksEl.style.display = seen.size ? '' : 'none';
  }

  // Комментарии администратора из GitHub Issues (api/issue-comments.json), свежие сверху
  function renderComments(list) {
    if (!commentsEl) return;
    commentsEl.innerHTML = '';
    const items = (list || []).filter((c) => c && (c.body || '').trim()).slice().reverse();
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
      body.textContent = c.body;
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
    const sumBySlug = {};
    for (const s of summary) sumBySlug[s.slug] = s;

    // Все затронутые сервисы этого Issue (активные или из журнала)
    const act = Object.values(incidents || {}).filter((i) => i.issue_number === issueNum);
    const affected = act.length ? act : (log || []).filter((i) => i.issue_number === issueNum);
    if (!affected.length) {
      titleEl.textContent = 'Событие не найдено';
      statusEl.textContent = 'Возможно, оно скрыто или ещё не синхронизировано.';
      return;
    }
    const active = !!act.length;
    // Представитель для карточки: голова группы, иначе первый
    const heads = affected.filter((e) => sumBySlug[e.slug] && sumBySlug[e.slug].isGroup);
    const rep = heads.length ? heads[0] : affected[0];

    renderTitle(affected, sumBySlug);
    renderCard(rep, active);
    renderComments(byIssue[String(issueNum)]);
    renderServiceLinks(affected, sumBySlug);
  } catch (e) {
    titleEl.textContent = 'Не удалось загрузить событие';
  }
})();