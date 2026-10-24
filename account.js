/* account.js: multi-user step 2. App name, first-run welcome (create calendars + time zone),
 * and the Account section (export my data, delete my account). Used by app.js. */
(function () {
  'use strict';
  const CFG = window.CALENDAR_CONFIG || {};
  const APP = CFG.APP_NAME || 'SANDY';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- app name: one constant (config.js APP_NAME) ----------
  function applyName() {
    document.querySelectorAll('[data-app-name]').forEach(el => { el.textContent = (el.dataset.appPrefix || '') + APP; });
    document.title = document.title.replace(/^SANDY/, APP);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyName); else applyName();

  // ---------- welcome / onboarding ----------
  const PALETTE = ['#2563eb', '#ea580c', '#16a34a', '#7c3aed', '#db2777', '#0f766e', '#ca8a04', '#dc2626'];
  const browserTZ = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago'; } catch { return 'America/Chicago'; } };
  const zones = () => { try { return Intl.supportedValuesOf('timeZone'); } catch { return ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'UTC']; } };
  function slugify(name, taken) {
    let base = name.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'calendar';
    if (!/^[a-z0-9]/.test(base)) base = 'c' + base;
    let s = base, i = 2; while (taken.has(s)) s = `${base}-${i++}`; taken.add(s); return s;
  }

  function onboarding({ store, user }) {
    return new Promise(resolve => {
      const tz = browserTZ();
      const root = document.createElement('div');
      root.className = 'onb'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'onbTitle');
      root.innerHTML = `
        <form class="onb-card" novalidate>
          <h1 id="onbTitle">Welcome to ${esc(APP)} 👋</h1>
          <p class="muted">Let's set up your calendars. It takes less than a minute, and you can add more later.</p>
          <label class="onb-field">Your name <span class="muted small">(optional)</span>
            <input name="displayName" maxlength="80" autocomplete="name" placeholder="e.g. Jordan"></label>
          <h2>Your calendars <span class="muted small">(1–5)</span></h2>
          <p class="muted small">Give each one a name and a color, like "Work", "Coaching" or "Family".</p>
          <div class="onb-cals"></div>
          <button type="button" class="link-btn onb-add">+ Add another calendar</button>
          <label class="onb-field">Time zone
            <select name="tz">${zones().map(z => `<option${z === tz ? ' selected' : ''}>${esc(z)}</option>`).join('')}</select></label>
          <p class="onb-err" role="alert"></p>
          <button type="submit" class="primary onb-go">Create my calendars</button>
          <p class="muted small">Signed in as ${esc(user && user.email)}.</p>
        </form>`;
      document.body.appendChild(root);
      const form = root.querySelector('form'), list = root.querySelector('.onb-cals'), addBtn = root.querySelector('.onb-add'), err = root.querySelector('.onb-err');
      const rows = () => [...list.querySelectorAll('.onb-cal')];
      function addRow(name = '') {
        if (rows().length >= 5) return;
        const n = rows().length;
        const row = document.createElement('div'); row.className = 'onb-cal';
        row.innerHTML = `<input type="color" value="${PALETTE[n % PALETTE.length]}" aria-label="Calendar color">
          <input class="onb-name" maxlength="80" placeholder="Calendar name" value="${esc(name)}" aria-label="Calendar name">
          <button type="button" class="icon-btn onb-del" aria-label="Remove calendar">✕</button>`;
        row.querySelector('.onb-del').onclick = () => { if (rows().length > 1) { row.remove(); sync(); } };
        list.appendChild(row); sync();
      }
      function sync() { addBtn.hidden = rows().length >= 5; rows().forEach(r => { r.querySelector('.onb-del').disabled = rows().length <= 1; }); }
      addBtn.onclick = () => { addRow(); const r = rows(); r[r.length - 1].querySelector('.onb-name').focus(); };
      addRow('Personal'); addRow('Work'); // generic defaults for new users (never Scott's own calendars)
      form.onsubmit = async e => {
        e.preventDefault(); err.textContent = '';
        const cals = rows().map(r => ({ name: r.querySelector('.onb-name').value.trim(), color: r.querySelector('input[type=color]').value }))
          .filter(c => c.name);
        if (!cals.length) { err.textContent = 'Name at least one calendar.'; return; }
        const taken = new Set();
        const payload = cals.map((c, i) => ({ slug: slugify(c.name, taken), name: c.name, short: c.name.slice(0, 20), color: c.color, sort: i }));
        const go = root.querySelector('.onb-go'); go.disabled = true; go.textContent = 'Setting up…';
        try {
          await store.saveProfile({ display_name: form.displayName.value.trim() || null, time_zone: form.tz.value });
          await store.createCalendars(payload);
          root.classList.add('onb-done'); setTimeout(() => { root.remove(); resolve(payload); }, 250);
        } catch (ex) {
          err.textContent = 'Something went wrong: ' + (ex.message || ex); go.disabled = false; go.textContent = 'Create my calendars';
        }
      };
    });
  }

  // ---------- Account section (hamburger menu) ----------
  function mountAccount({ store, user, mount }) {
    if (!mount || !store.auth || !user) return;
    const sec = document.createElement('section'); sec.id = 'accountSection';
    sec.innerHTML = `<h2>Account</h2>
      <p class="small">${esc(user.email)} · <span class="plan-badge" id="planBadge">Free plan</span></p>
      <div class="data-btns"><button id="acctExport">Export my data</button></div>
      <button id="acctDelete" class="link-btn danger">Delete my account…</button>
      <p class="muted small"><a href="privacy.html" target="_blank" rel="noopener">Privacy</a> · <a href="terms.html" target="_blank" rel="noopener">Terms</a></p>`;
    mount.after(sec);
    store.profile().then(p => { if (p && p.plan) sec.querySelector('#planBadge').textContent = ({ free: 'Free', paid: 'Paid', paid_ai: 'Paid + AI' }[p.plan] || p.plan) + ' plan'; }).catch(() => {});
    sec.querySelector('#acctExport').onclick = async () => {
      const b = sec.querySelector('#acctExport'); b.disabled = true; b.textContent = 'Preparing…';
      try {
        const data = { app: APP, exportedAt: new Date().toISOString(), account: { id: user.id, email: user.email }, ...(await store.exportAccount()) };
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        a.download = `${APP.toLowerCase()}-my-data-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      } catch (e) { alert('Export failed: ' + (e.message || e)); }
      b.disabled = false; b.textContent = 'Export my data';
    };
    sec.querySelector('#acctDelete').onclick = () => openDelete({ store, user });
  }

  function openDelete({ store, user }) {
    const isMain = (CFG.OWNER_EMAIL || '').toLowerCase() === (user.email || '').toLowerCase();
    const d = document.createElement('dialog'); d.className = 'acct-del';
    d.innerHTML = `<form method="dialog">
      <h2>Delete my account</h2>
      <p>This permanently deletes <b>all</b> of your calendars, events, notes and settings, and your sign-in. It can't be undone.</p>
      ${isMain ? '<p class="warn"><b>This is the main account.</b> Export your data first.</p>' : ''}
      <label>Type your email exactly to confirm:<input id="delEmail" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${esc(user.email)}"></label>
      <p class="onb-err" role="alert"></p>
      <div class="data-btns"><button value="cancel" formnovalidate>Cancel</button><button id="delGo" class="primary danger" disabled>Delete everything</button></div>
    </form>`;
    document.body.appendChild(d);
    const inp = d.querySelector('#delEmail'), go = d.querySelector('#delGo'), err = d.querySelector('.onb-err');
    inp.oninput = () => { go.disabled = inp.value.trim() !== user.email; };
    go.onclick = async e => {
      e.preventDefault(); if (inp.value.trim() !== user.email) return;
      go.disabled = true; go.textContent = 'Deleting…';
      try { await store.deleteAccount(inp.value.trim()); try { await store.auth.signOut(); } catch (_) {} localStorage.clear(); location.reload(); }
      catch (ex) { err.textContent = ex.message || String(ex); go.textContent = 'Delete everything'; go.disabled = false; }
    };
    d.addEventListener('close', () => d.remove());
    d.showModal ? d.showModal() : d.setAttribute('open', '');
  }

  window.SandyAccount = { APP, onboarding, mountAccount, slugify };
})();
