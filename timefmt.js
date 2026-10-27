/*
 * timefmt.js: one place that decides how times are shown (2026-10-26).
 * Profile → Appearance → Time format: Auto (phone setting) / 12-hour / 24-hour. Auto is the default and follows the
 * phone/browser clock (Intl hourCycle h23/h24 = 24-hour). Saved per user in localStorage (sandy.timeFormat[.<user id>]);
 * there is no profiles column for it, so it is not synced to the database.
 *
 * window.SandyTime:
 *   pref() → 'auto' | '12' | '24'      set(v)          detect() → true when the phone uses a 24-hour clock
 *   is24()                              fmt(wallDate, { compact }) → "2:30 PM" / "14:30" (wall-clock in the UTC fields)
 *   fmtHM('14:30', { compact })         fmtIn(realDate, timeZone)  (a real instant shown in a zone)
 *   fcEvent() / fcSlot()                FullCalendar eventTimeFormat / slotLabelFormat
 * Changing it fires `sandy:timeformat` on window; listeners re-render.
 */
(function () {
  'use strict';
  const KEY = 'sandy.timeFormat';
  const pad = n => String(n).padStart(2, '0');
  const userKey = () => { try { const a = window.__app, u = a && a.user && a.user(); return u && u.id ? KEY + '.' + u.id : KEY; } catch (_) { return KEY; } };
  const ok = v => (v === '12' || v === '24' || v === 'auto' ? v : null);

  function pref() {
    try { return ok(localStorage.getItem(userKey())) || ok(localStorage.getItem(KEY)) || 'auto'; } catch (_) { return 'auto'; }
  }
  let detected = null;
  function detect() {
    if (detected !== null) return detected;
    try {
      const hc = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle;
      if (hc) detected = hc === 'h23' || hc === 'h24';
      else {
        const s = new Date(Date.UTC(2020, 0, 1, 15, 0)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
        detected = /15/.test(s) && !/[AaPp]\.?\s?[Mm]/.test(s);
      }
    } catch (_) { detected = false; }
    return detected;
  }
  const is24 = () => { const p = pref(); return p === '24' || (p === 'auto' && detect()); };

  function fmtParts(h, m, o) {
    if (is24()) return `${pad(h)}:${pad(m)}`;
    const ap = h >= 12 ? 'PM' : 'AM', h12 = h % 12 || 12;
    return o && o.compact && !m ? `${h12} ${ap}` : `${h12}:${pad(m)} ${ap}`;
  }
  const fmt = (d, o) => (d && !isNaN(d) ? fmtParts(d.getUTCHours(), d.getUTCMinutes(), o) : '');
  const fmtHM = (hm, o) => { const [h, m] = String(hm || '').split(':').map(Number); return isNaN(h) ? '' : fmtParts(h, m || 0, o); };
  function fmtIn(d, timeZone) {
    try {
      const p = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(d);
      const g = t => +(p.find(x => x.type === t) || {}).value;
      return fmtParts(g('hour') % 24, g('minute'));
    } catch (_) { return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
  }
  const fcEvent = () => (is24() ? { hour: '2-digit', minute: '2-digit', hour12: false } : { hour: 'numeric', minute: '2-digit', meridiem: 'short' });
  const fcSlot = () => (is24() ? { hour: '2-digit', minute: '2-digit', hour12: false } : { hour: 'numeric', minute: '2-digit', omitZeroMinute: true, meridiem: 'short' });

  // static bits of copy carry data-sandy-time="HH:MM" so they follow the setting too
  function paintStatic(root) {
    (root || document).querySelectorAll('[data-sandy-time]').forEach(el => { el.textContent = fmtHM(el.dataset.sandyTime); });
  }
  function set(v) {
    v = ok(v) || 'auto';
    try { localStorage.setItem(userKey(), v); localStorage.setItem(KEY, v); } catch (_) {}
    paintStatic();
    window.dispatchEvent(new CustomEvent('sandy:timeformat', { detail: { pref: v, is24: is24() } }));
  }
  const label = () => (detect() ? '24-hour' : '12-hour');

  window.SandyTime = { KEY, pref, set, detect, is24, fmt, fmtHM, fmtIn, fcEvent, fcSlot, paintStatic, label };
  if (document.readyState !== 'loading') paintStatic(); else document.addEventListener('DOMContentLoaded', () => paintStatic());
})();
