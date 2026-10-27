/* simple.js: Today "Simple mode" — shows only Now/Next, collapsed Heads Up, On Today, Overdue.
 * Off by default; remembered per user. Toggle in Profile Settings + small control on Today. */
(function () {
  'use strict';
  const LS = 'sandy.todaySimple.v1';
  const A = () => window.__app;
  const userKey = () => { try { const u = A() && A().user && A().user(); return u && u.id ? LS + '.' + u.id : LS; } catch (e) { return LS; } };
  const read = () => { try { return localStorage.getItem(userKey()) === '1'; } catch (e) { return false; } };
  const write = on => { try { if (on) localStorage.setItem(userKey(), '1'); else localStorage.removeItem(userKey()); } catch (e) {} };

  function isOn() { return read(); }
  function set(on) {
    write(!!on);
    document.body.classList.toggle('today-simple', !!on);
    const t = document.getElementById('todaySimpleToggle');
    if (t) t.checked = !!on;
    const s = document.getElementById('siSimpleMode');
    if (s) s.checked = !!on;
  }
  function applyDom() {
    document.body.classList.toggle('today-simple', isOn());
  }
  function toolbarHtml() {
    const on = isOn();
    return `<label class="tc-simple-tog" title="Hide Suggestions, Week ahead, and other extras">` +
      `<input type="checkbox" id="todaySimpleToggle"${on ? ' checked' : ''}/> Simple</label>`;
  }
  function bind(root) {
    applyDom();
    const t = (root || document).querySelector('#todaySimpleToggle');
    if (t && !t.__bound) {
      t.__bound = true;
      t.addEventListener('change', () => {
        set(t.checked);
        if (window.SandyNav && SandyNav.renderToday) SandyNav.renderToday();
      });
    }
  }
  window.SandySimple = { isOn, set, applyDom, toolbarHtml, bind, read };
})();
