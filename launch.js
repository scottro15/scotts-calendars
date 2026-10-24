/* launch.js: free-prototype launch pieces, mounted in the Account section when signed in (Supabase mode).
 *  - Time zone setting (profiles.time_zone; detected from the browser at sign-up, editable here)
 *  - Feedback button -> public.feedback (RLS: you insert your own; only the admin reads everyone's)
 *  - Invites screen (admin only) -> Edge Function "admin-invites" (service role stays server-side)
 *  - Marks the signed-in user's invite as accepted (rpc accept_my_invite). */
(function () {
  'use strict';
  const CFG = window.CALENDAR_CONFIG || {};
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const zones = () => { try { return Intl.supportedValuesOf('timeZone'); } catch { return ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'UTC']; } };
  const INVITES_URL = CFG.INVITES_ENDPOINT || (CFG.SUPABASE_URL ? CFG.SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/admin-invites' : '');
  const fmtWhen = iso => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';

  function openDialog(cls, html) {
    const d = document.createElement('dialog'); d.className = 'launch-dlg ' + cls; d.innerHTML = html;
    document.body.appendChild(d);
    d.addEventListener('close', () => d.remove());
    d.showModal ? d.showModal() : d.setAttribute('open', '');
    return d;
  }

  async function token(sb) { try { const { data } = await sb.auth.getSession(); return data.session ? data.session.access_token : ''; } catch { return ''; } }
  async function callInvites(sb, payload) {
    const tok = await token(sb);
    const res = await fetch(INVITES_URL, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok, ...(CFG.SUPABASE_ANON_KEY ? { apikey: CFG.SUPABASE_ANON_KEY } : {}) }, body: JSON.stringify(payload) });
    let j = {}; try { j = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
    return j;
  }

  // ---------- Feedback ----------
  function openFeedback({ sb, toast }) {
    const d = openDialog('fb-dlg', `<form method="dialog">
      <h2>Send feedback</h2>
      <p class="muted small">Bugs, ideas, anything confusing. Scott reads every note.</p>
      <label>Your feedback<textarea id="fbBody" rows="5" maxlength="5000" required placeholder="What happened, or what would make SANDY better?"></textarea></label>
      <p class="onb-err" role="alert"></p>
      <div class="data-btns"><button value="cancel" formnovalidate>Cancel</button><button id="fbSend" class="primary" disabled>Send</button></div>
    </form>`);
    const body = d.querySelector('#fbBody'), go = d.querySelector('#fbSend'), err = d.querySelector('.onb-err');
    body.oninput = () => { go.disabled = !body.value.trim(); };
    setTimeout(() => body.focus(), 50);
    go.onclick = async e => {
      e.preventDefault(); const text = body.value.trim(); if (!text) return;
      go.disabled = true; go.textContent = 'Sending…'; err.textContent = '';
      const { error } = await sb.from('feedback').insert({ body: text, page: (location.pathname + location.search).slice(0, 200), user_agent: navigator.userAgent.slice(0, 400) });
      if (error) { err.textContent = 'Could not send: ' + error.message; go.disabled = false; go.textContent = 'Send'; return; }
      d.close(); toast && toast('Thanks! Feedback sent');
    };
  }

  // ---------- Feedback inbox (admin) ----------
  async function openFeedbackInbox({ sb }) {
    const d = openDialog('fbin-dlg', `<form method="dialog"><h2>Feedback</h2><div class="fb-list"><p class="muted small">Loading…</p></div>
      <div class="data-btns"><button value="cancel">Close</button></div></form>`);
    const box = d.querySelector('.fb-list');
    const { data, error } = await sb.from('feedback').select('email,body,page,created_at').order('created_at', { ascending: false }).limit(200);
    if (error) { box.innerHTML = `<p class="onb-err">${esc(error.message)}</p>`; return; }
    box.innerHTML = data.length ? data.map(f => `<div class="fb-item"><div class="small muted">${esc(f.email || '')} · ${esc(new Date(f.created_at).toLocaleString())}</div><div class="fb-body">${esc(f.body)}</div></div>`).join('')
      : '<p class="muted small">No feedback yet.</p>';
  }

  // ---------- Invites (admin) ----------
  function openInvites({ sb, toast }) {
    const d = openDialog('inv-dlg', `<form class="inv-form" novalidate>
      <h2>Invites</h2>
      <p class="muted small">SANDY is invite-only. Adding an email lets that person sign in with a one-time link at the site; nobody else can create an account. No email is sent unless you tick the box. Send your own invite message with the site link.</p>
      <div class="inv-add"><input id="invEmail" type="email" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="friend@example.com" aria-label="Email to invite">
        <button id="invGo" class="primary" type="submit">Invite</button></div>
      <label class="small inv-send"><input type="checkbox" id="invSend"> Also send Supabase's invite email (uses the email limit)</label>
      <p class="onb-err" role="alert"></p>
      <ul class="inv-list" aria-live="polite"><li class="muted small">Loading…</li></ul>
      <div class="data-btns"><button type="button" class="inv-close">Close</button></div>
    </form>`);
    const list = d.querySelector('.inv-list'), err = d.querySelector('.onb-err'), email = d.querySelector('#invEmail'), go = d.querySelector('#invGo');
    d.querySelector('.inv-close').onclick = () => d.close();
    const LABEL = { invited: 'Invited · not signed in yet', accepted: 'Joined', revoked: 'Access revoked' };
    async function load() {
      try {
        const { invites } = await callInvites(sb, { action: 'list' });
        list.innerHTML = invites.length ? invites.map(i => `<li class="inv-row st-${esc(i.status)}"><div><b>${esc(i.email)}</b>
            <div class="small muted"><span class="inv-status">${esc(LABEL[i.status] || i.status)}</span> · invited ${esc(fmtWhen(i.created_at))}${i.last_sign_in_at ? ' · last seen ' + esc(fmtWhen(i.last_sign_in_at)) : ''}</div></div>
            <button type="button" class="link-btn ${i.status === 'revoked' ? '' : 'danger'}" data-act="${i.status === 'revoked' ? 'restore' : 'revoke'}" data-email="${esc(i.email)}">${i.status === 'revoked' ? 'Restore' : 'Revoke'}</button></li>`).join('')
          : '<li class="muted small">No invites yet.</li>';
      } catch (e) { list.innerHTML = `<li class="onb-err">${esc(e.message)}</li>`; }
    }
    list.onclick = async e => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      if (b.dataset.act === 'revoke' && !confirm(`Revoke sign-in for ${b.dataset.email}? Their data is kept; you can restore access later.`)) return;
      b.disabled = true;
      try { await callInvites(sb, { action: b.dataset.act, email: b.dataset.email }); await load(); } catch (ex) { err.textContent = ex.message; b.disabled = false; }
    };
    d.querySelector('form').onsubmit = async e => {
      e.preventDefault(); err.textContent = '';
      const v = email.value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { err.textContent = 'Enter a valid email address.'; return; }
      go.disabled = true; go.textContent = 'Inviting…';
      try { await callInvites(sb, { action: 'invite', email: v, sendEmail: d.querySelector('#invSend').checked }); email.value = ''; toast && toast(`Invited ${v}`); await load(); }
      catch (ex) { err.textContent = ex.message; }
      go.disabled = false; go.textContent = 'Invite';
    };
    load(); setTimeout(() => email.focus(), 50);
  }

  // ---------- mount ----------
  function mount({ store, user, timeZone, setTZ, toast }) {
    const sb = store.adapter && store.adapter.client; const sec = document.getElementById('accountSection');
    if (!sb || !sec || !user) return;
    const given = toast; toast = m => { const t = given || (window.__app && window.__app.toast); if (t) t(m); };
    sb.rpc('accept_my_invite').then(() => {}, () => {});
    const cur = timeZone();
    const box = document.createElement('div'); box.className = 'launch-box';
    box.innerHTML = `<label class="small tz-field">Time zone
        <select id="tzSelect">${(zones().includes(cur) ? zones() : [cur, ...zones()]).map(z => `<option${z === cur ? ' selected' : ''}>${esc(z)}</option>`).join('')}</select></label>
      <p class="muted small tz-hint">Sets "today" and the now-line. Event times stay as you entered them.</p>
      <div class="data-btns"><button id="feedbackBtn" type="button">💬 Send feedback</button></div>
      <div class="data-btns admin-btns" hidden><button id="invitesBtn" type="button">✉️ Invites</button><button id="fbInboxBtn" type="button">Feedback inbox</button></div>`;
    const anchor = sec.querySelector('#acctDelete'); sec.insertBefore(box, anchor);
    const sel = box.querySelector('#tzSelect');
    sel.onchange = async () => {
      const z = sel.value; sel.disabled = true;
      try { await store.saveProfile({ time_zone: z }); setTZ(z); toast(`Time zone: ${z.replace(/_/g, ' ')}`); }
      catch (e) { alert('Could not save time zone: ' + (e.message || e)); sel.value = timeZone(); }
      sel.disabled = false;
    };
    box.querySelector('#feedbackBtn').onclick = () => openFeedback({ sb, toast });
    sb.rpc('sandy_is_admin').then(({ data }) => {
      if (data !== true) return;
      box.querySelector('.admin-btns').hidden = false;
      box.querySelector('#invitesBtn').onclick = () => openInvites({ sb, toast });
      box.querySelector('#fbInboxBtn').onclick = () => openFeedbackInbox({ sb });
    }, () => {});
  }

  window.SandyLaunch = { mount, openFeedback, openInvites, callInvites };
})();
