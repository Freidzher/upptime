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

  function modeOf(info, isMaint) {
    return info.mode || (info.annulled ? 'annulled' : (info.hidden ? 'hidden' : (info.maintenance || isMaint ? 'maintenance' : 'incident')));
  }

  function statusText(mode, active, resolved) {
    if (mode === 'maintenance') return active ? 'плановые работы (идут)' : 'плановые работы завершены';
    if (mode === 'annulled') return active ? 'аннулировано (идёт)' : 'аннулировано';
    if (active) return 'недоступен';
    return 'устранён';
  }

  // Единая карточка события: <b>Имя</b> — статус · Начато: … [· Закрыто: … · Длительность: …]
  function incidentCard(info, active, slug) {
    const mode = modeOf(info, info.maintenance);
    if (mode === 'hidden') return null;
    const d = document.createElement('a');
    d.className = 'incident ' + mode;
    const target = slug || info.slug;
    if (target) d.href = 'site.html?site=' + encodeURIComponent(target);
    if (info.issue_number) d.href = 'incident.html?issue=' + info.issue_number;
    const started = fmtTs(info.opened);
    const resolved = fmtTs(info.resolved);
    const meta = ['Начато: ' + started + ' МСК'];
    if (resolved) meta.push('Закрыто: ' + resolved + ' МСК');
    if (info.minutes) meta.push('Длительность: ' + pluralMin(info.minutes));
    const metaHtml = '<span class="t">· ' + meta.join(' · ') + '</span>';
    const name = info.name || (info.title || 'Сервис').replace(/ — недоступен$/, '').replace(/ — техработы$/, '');
    d.innerHTML = '<b></b>' + esc(' — ' + statusText(mode, active, resolved) + ' ') + metaHtml;
    d.querySelector('b').textContent = name;
    return d;
  }

  function setFooterYear() {
    const y = document.getElementById('year');
    if (y) y.textContent = new Date().getFullYear();
  }

  async function fetchJson(url) {
    const r = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error(url);
    return r.json();
  }

  return { EMOJI_RE, esc, fmtTs, pluralMin, modeOf, statusText, incidentCard, setFooterYear, fetchJson };
})();