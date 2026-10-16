// Runicore Status — общий код для всех страниц (главная, сервис, событие)
window.Runicore = (function () {
  const EMOJI_RE = /^[\u{1F1E6}-\u{1F1FF}]{2}|[\u{1F000}-\u{1FAFF}]|[\u2600-\u27BF]\uFE0F?/u;

  function esc(s) {
    const map = { 38: 'amp', 60: 'lt', 62: 'gt', 34: 'quot', 39: '#39' };
    return String(s).replace(/[&<>"']/g, (c) => '&' + map[c.charCodeAt(0)] + ';');
  }

  function fmtTs(ts) {
    return ts ? new Date(ts).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : null;
  }

  function pluralMin(n) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return n + ' минуту';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return n + ' минуты';
    return n + ' минут';
  }

  // Прогрессивная длительность: минуты -> часы -> дни (24ч) -> месяцы (30д).
  // Нулевые компоненты скрыты. Пример: 771 -> "12 ч. 51 мин.", 45000 -> "1 мес. 1 д. 6 ч."
  function fmtDuration(totalMinutes) {
    const m = Math.max(0, Math.round(totalMinutes || 0));
    const months = Math.floor(m / 43200);   // 30 дней
    let rem = m % 43200;
    const days = Math.floor(rem / 1440);    // 24 часа
    rem = rem % 1440;
    const hours = Math.floor(rem / 60);
    const mins = rem % 60;
    const parts = [];
    if (months) parts.push(months + ' мес.');
    if (days) parts.push(days + ' д.');
    if (hours) parts.push(hours + ' ч.');
    if (mins) parts.push(mins + ' мин.');
    return parts.length ? parts.join(' ') : '0 мин.';
  }

  function modeOf(info, isMaint) {
    return info.mode || (info.annulled ? 'annulled' : (info.hidden ? 'hidden' : (info.maintenance || isMaint ? 'maintenance' : 'incident')));
  }

  // Статус события (без префикса: лейбл выводится отдельным бейджем перед названием сервиса).
  // annulled и hidden — разные лейблы: «Аннулировано» показываем, hidden полностью скрывает событие.
  function statusText(mode, active, resolved) {
    if (mode === 'rkn') return 'Возможные ограничения';
    if (mode === 'maintenance') return active ? 'Идут плановые работы' : 'Завершены';
    if (mode === 'annulled') return active ? 'Идет аннулирование' : 'Аннулировано';
    return active ? 'Недоступен' : 'Исправлен';
  }

  // Длительность в минутах: для закрытых — из minutes, для активных — до текущего момента
  function liveMinutes(info, active) {
    if (info && info.minutes) return info.minutes;
    if (active && info && info.opened) {
      const m = (Date.now() - new Date(info.opened).getTime()) / 60000;
      if (m > 0) return Math.max(1, Math.round(m));
    }
    return 0;
  }

  // Единая карточка события: [favicon+статус] <b>Имя</b> / Начало: …
  // commentsByIssue — карта { "<issue>": [...] }; счётчик комментариев идёт в правую
  // колонку под лейбл длительности. iconHtml — фавикон/эмодзи сервиса
  // (см. eventIconHtml), выводится ВНУТРИ лейбла режима. forceServiceLink=true —
  // вести на страницу сервиса (site.html?site=slug), иначе на incident.html?issue=N.
  // Раскладка: flex-строка — слева текстовый блок .ev-body (сверху плашка статуса
  // активного события, ниже лейбл с иконкой + имя, затем строка меты), справа
  // .ev-right (длительность 🕑 с подсказкой «Решено: …», под ней по центру «💬 N»),
  // вертикально по центру.
  function incidentCard(info, active, slug, commentsByIssue, iconHtml, forceServiceLink) {
    const mode = modeOf(info, info.maintenance);
    if (mode === 'hidden') return null;
    const d = document.createElement('a');
    // Класс active включает свечение кромки активного события (см. .incident.active.*)
    d.className = 'incident' + (active ? ' active' : '') + ' ' + mode;
    const target = slug || info.slug;
    if (target) d.href = 'site.html?site=' + encodeURIComponent(target);
    if (!forceServiceLink && info.issue_number) d.href = 'incident.html?issue=' + info.issue_number;
    const started = fmtTs(info.opened);
    const resolved = fmtTs(info.resolved);
    const mins = liveMinutes(info, active);
    // Мета события — отдельной строкой под названием: «С <дата>» (сбой начался с…),
    // затем «· По <дата>». Дата решения дублируется в подсказке лейбла длительности
    // «🕑 …» (экономия строки); если лейбл вдруг не отрисуется — остаётся в мете.
    const resolvedInDur = mins > 0 && !!resolved;
    const when = ['С ' + started + ' МСК'];
    if (resolved && !resolvedInDur) when.push('По ' + resolved + ' МСК');
    const metaHtml = '<span class="t ev-meta">' + when.join(' · ') + '</span>';
    const rawName = info.name || (info.title || 'Сервис').replace(/ — недоступен$/, '').replace(/ — техработы$/, '');
    // Фавикон/эмодзи уже показывает ведущий эмодзи — не дублируем его в названии
    const name = iconHtml ? (rawName.replace(EMOJI_RE, '').trim() || rawName) : rawName;
    const cCount = (commentsByIssue && info.issue_number)
      ? ((commentsByIssue[String(info.issue_number)] || []).length) : 0;
    // Правая колонка карточки (flex): длительность «🕑 …» сверху,
    // под ней — счётчик комментариев «💬 N» по центру. Подсказка лейбла
    // длительности: у решённых — дата решения («По … МСК»), у активных —
    // текущая дата по МСК (событие ещё открыто, длительность тикает).
    const durTitle = resolvedInDur
      ? ' title="' + esc('По ' + resolved + ' МСК') + '"'
      : (mins ? ' title="' + esc('Сейчас: ' + new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) + ' МСК') + '"' : '');
    let rightInner = '';
    if (mins) rightInner += '<span class="ev-dur"' + durTitle + '>🕑 ' + esc(fmtDuration(mins)) + '</span>';
    if (cCount > 0) {
      rightInner += '<span class="comment-badge" title="' + esc('Комментариев: ' + cCount) + '">💬 ' + cCount + '</span>';
    }
    const rightHtml = rightInner ? '<span class="ev-right">' + rightInner + '</span>' : '';
    // Плашка-заголовок статуса активного события: маленькая, капс, плотные буквы,
    // сидит на стыке верхней границы карточки по центру. У прошлых событий плашки нет;
    // у вложенных сервисов группы прячем через CSS (.evt-sub) — статус один на группу.
    const statusPill = active
      ? '<span class="ev-status st-' + mode + '">' +
        esc(statusText(mode, active, resolved).toUpperCase()) + '</span>'
      : '';
    // Строка названия: лейбл режима (с фавиконом/смайликом внутри) и имя сервиса.
    // Имя пишем в ПОСЛЕДНИЙ <b>: первый занят лейблом.
    const headHtml = '<span class="lb lb-' + mode + '">' + (iconHtml || '') + esc(labelPrefix(mode)) + '</span>' +
      '<b></b>';
    d.innerHTML = statusPill + '<span class="ev-body">' + headHtml + metaHtml + '</span>' + rightHtml;
    d.querySelector('b').textContent = name;
    return d;
  }

  // Фавикон/эмодзи сервиса для карточки события (как в списке сервисов на главной)
  function eventIconHtml(info, sumBySlug) {
    const svc = (sumBySlug || {})[info.slug];
    if (!svc) return '';
    if (svc.icon) {
      return '<img class="ev-fav" src="api/' + info.slug + '/' + svc.icon + '" alt="" onerror="this.style.display=\'none\'">';
    }
    const emoji = (svc.name.match(EMOJI_RE) || [''])[0];
    return emoji ? '<span class="ev-fav emoji">' + emoji + '</span>' : '';
  }

  // Группировка событий по issue_number. Главный («голова» группы) — первым,
  // остальные (others) — вложенные сервисы того же инцидента.
  function groupByIssue(entries, sumBySlug) {
    const map = new Map();
    const order = [];
    for (const e of entries) {
      const k = (e.issue_number != null) ? ('#' + e.issue_number) : ('s:' + (e.slug || ''));
      if (!map.has(k)) { map.set(k, []); order.push(k); }
      map.get(k).push(e);
    }
    return order.map((k) => {
      const arr = map.get(k).slice();
      // Стабильно: «головы» групп вперёд, порядок остальных сохранён (как в журнале)
      arr.sort((a, b) => {
        const ag = (sumBySlug[a.slug] && sumBySlug[a.slug].isGroup) ? 0 : 1;
        const bg = (sumBySlug[b.slug] && sumBySlug[b.slug].isGroup) ? 0 : 1;
        return ag - bg;
      });
      return { key: k, main: arr[0], others: arr.slice(1) };
    });
  }

  // Отрисовка группы событий одного Issue: главная карточка + «выемка»,
  // раскрывающая список затронутых сервисов (каждый ведёт на свою страницу).
  function renderEventGroup(container, group, active, sumBySlug, commentsByIssue) {
    const iconHtml = eventIconHtml(group.main, sumBySlug);
    if (!group.others.length) {
      const card = incidentCard(group.main, active, null, commentsByIssue, iconHtml, false);
      if (card) container.appendChild(card);
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'evt-group';
    const mainCard = incidentCard(group.main, active, null, commentsByIssue, iconHtml, false);
    if (mainCard) wrap.appendChild(mainCard);

    const notch = document.createElement('button');
    notch.type = 'button';
    notch.className = 'evt-notch';
    notch.dataset.mode = modeOf(group.main, group.main.maintenance);  // для цветной полосы
    const arrow = document.createElement('span');
    arrow.className = 'evt-notch-arrow';
    arrow.textContent = '▸';
    const label = document.createElement('span');
    label.textContent = 'Затронуто сервисов: ' + (group.others.length + 1);
    notch.appendChild(arrow);
    notch.appendChild(label);

    const subs = document.createElement('div');
    subs.className = 'evt-subs';
    subs.style.display = 'none';
    for (const o of group.others) {
      // ведём на страницу инцидента (как и главная карточка), а не на сервис
      const c = incidentCard(o, active, o.slug, commentsByIssue, eventIconHtml(o, sumBySlug), false);
      if (c) { c.classList.add('evt-sub'); subs.appendChild(c); }
    }
    notch.addEventListener('click', () => {
      const open = subs.style.display !== 'none';
      subs.style.display = open ? 'none' : '';
      notch.classList.toggle('open', !open);
      arrow.textContent = open ? '▸' : '▾';
    });
    wrap.appendChild(notch);
    wrap.appendChild(subs);
    container.appendChild(wrap);
  }

  function setFooterYear() {
    const y = document.getElementById('year');
    if (y) y.textContent = new Date().getFullYear();
  }

  // Пагинация: кнопки ‹ 1 2 3 … N › + поле «перейти к странице». onGo(page) при клике/вводе.
  function renderPager(el, totalPages, current, onGo) {
    if (!el) return;
    el.innerHTML = '';
    if (totalPages <= 1) { el.style.display = 'none'; return; }
    el.style.display = '';
    const btn = (label, page, opts) => {
      opts = opts || {};
      const b = document.createElement('button');
      b.textContent = label;
      if (opts.disabled) b.disabled = true;
      if (page === current && !opts.arrow) b.classList.add('active');
      if (!opts.disabled) b.addEventListener('click', () => onGo(page));
      return b;
    };
    el.appendChild(btn('‹', current - 1, { disabled: current <= 1, arrow: true }));
    for (let p = 1; p <= totalPages; p++) {
      el.appendChild(btn(String(p), p));
    }
    el.appendChild(btn('›', current + 1, { disabled: current >= totalPages, arrow: true }));

    // Поле быстрого перехода к нужной странице (ввод цифры + Enter)
    const jump = document.createElement('span');
    jump.className = 'pager-jump';
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.setAttribute('aria-label', 'Перейти к странице');
    input.title = 'Перейти к странице (1–' + totalPages + ')';
    input.placeholder = String(current);
    const go = () => {
      const p = parseInt(input.value, 10);
      if (!isNaN(p)) onGo(Math.min(Math.max(1, p), totalPages));
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    input.addEventListener('change', go);
    jump.appendChild(input);
    el.appendChild(jump);
  }

  async function fetchJson(url) {
    const r = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error(url);
    return r.json();
  }

  // Приоритетный лейбл события — бейджом перед названием сервиса
  const LABEL_SHORT = { rkn: 'РКН', incident: 'Сбой', maintenance: 'Техработы', annulled: 'Аннул.', hidden: 'Скрыто' };
  function labelPrefix(mode) {
    return LABEL_SHORT[mode] || (mode ? mode[0].toUpperCase() + mode.slice(1) : 'Сбой');
  }

  return { EMOJI_RE, esc, fmtTs, pluralMin, fmtDuration, modeOf, statusText, liveMinutes, labelPrefix, incidentCard, eventIconHtml, groupByIssue, renderEventGroup, setFooterYear, fetchJson, renderPager };
})();
