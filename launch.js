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
  const invitesUrl = () => (window.CALENDAR_CONFIG || CFG).INVITES_ENDPOINT || ((window.CALENDAR_CONFIG || CFG).SUPABASE_URL ? String((window.CALENDAR_CONFIG || CFG).SUPABASE_URL).replace(/\/$/, '') + '/functions/v1/admin-invites' : '');
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
    const res = await fetch(invitesUrl(), { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok, ...(CFG.SUPABASE_ANON_KEY ? { apikey: CFG.SUPABASE_ANON_KEY } : {}) }, body: JSON.stringify(payload) });
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
  // Personalized invite note (Scott 2026-10-26). First name is stored on invites.note via the edge
  // function (already deployed for new invites; set_name needs a redeploy). localStorage backs it up
  // so a name typed here survives reload even before redeploy.
  const INVITE_LINK = 'https://scottro15.github.io/scotts-calendars/';
  const INVITE_NAMES_KEY = 'sandy.inviteNames.v1';
  const readInviteNames = () => { try { return JSON.parse(localStorage.getItem(INVITE_NAMES_KEY) || '{}') || {}; } catch (_) { return {}; } };
  const writeInviteName = (email, name) => {
    try { const m = readInviteNames(); const k = String(email || '').toLowerCase(); if (!name) delete m[k]; else m[k] = String(name).trim().slice(0, 80); localStorage.setItem(INVITE_NAMES_KEY, JSON.stringify(m)); } catch (_) {}
  };
  const inviteGreeting = name => (name && String(name).trim() ? String(name).trim() : 'there');
  function inviteNoteText(name) {
    return `Hey ${inviteGreeting(name)}! I've been building a calendar app called SANDY, and I'd love for you to be one of the first people to test it. It's made for people who juggle a lot: multiple jobs, multiple schedules, and events stacked on top of each other. Most apps make you keep those in separate places. SANDY puts all your schedules, events, to-dos and notes in one clean, simple, efficient place. It's a free early version and invite-only, so your feedback will shape what it becomes. Here's your invite link: ${INVITE_LINK}. Thanks for helping me test it! — Scott`;
  }
  const smsHref = text => 'sms:&body=' + encodeURIComponent(text);
  async function copyText(text) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; } } catch (_) {}
    try { const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch (_) { return false; }
  }

  function openInvites({ sb, toast }) {
    const canShare = !!(navigator.share);
    const d = openDialog('inv-dlg', `<form class="inv-form" novalidate>
      <h2>Invites</h2>
      <p class="muted small">SANDY is invite-only. Adding an email lets that person sign in at the site with an 8-digit code we email them; nobody else can create an account. No email is sent unless you tick the box. Copy, text, or share the note below — it includes their name and the invite link.</p>
      <div class="inv-add">
        <input id="invEmail" type="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="friend@example.com" aria-label="Email to invite">
        <input id="invName" type="text" autocomplete="given-name" autocapitalize="words" spellcheck="false" maxlength="80" placeholder="First name (optional)" aria-label="First name">
        <button id="invGo" class="primary" type="submit">Invite</button>
      </div>
      <label class="small inv-send"><input type="checkbox" id="invSend"> Also send Supabase's invite email (uses the email limit)</label>
      <p class="onb-err" role="alert"></p>
      <ul class="inv-list" aria-live="polite"><li class="muted small">Loading…</li></ul>
      <div class="data-btns"><button type="button" class="inv-close">Close</button></div>
    </form>`);
    const list = d.querySelector('.inv-list'), err = d.querySelector('.onb-err'), email = d.querySelector('#invEmail'), nameIn = d.querySelector('#invName'), go = d.querySelector('#invGo');
    d.querySelector('.inv-close').onclick = () => d.close();
    const LABEL = { invited: 'Invited · not signed in yet', accepted: 'Joined', revoked: 'Access revoked' };
    const nameOf = i => {
      const server = (i.firstName || i.note || '').trim();
      if (server) return server;
      return (readInviteNames()[String(i.email || '').toLowerCase()] || '').trim();
    };
    function rowHtml(i) {
      const nm = nameOf(i);
      const note = inviteNoteText(nm);
      const shareBtn = canShare ? `<button type="button" class="link-btn" data-act="share" data-email="${esc(i.email)}">Share</button>` : '';
      return `<li class="inv-row st-${esc(i.status)}" data-email="${esc(i.email)}">
        <div class="inv-main">
          <div class="inv-top"><div><b class="inv-email">${esc(i.email)}</b>
            <div class="small muted"><span class="inv-status">${esc(LABEL[i.status] || i.status)}</span> · invited ${esc(fmtWhen(i.created_at))}${i.last_sign_in_at ? ' · last seen ' + esc(fmtWhen(i.last_sign_in_at)) : ''}</div></div>
            <button type="button" class="link-btn ${i.status === 'revoked' ? '' : 'danger'}" data-act="${i.status === 'revoked' ? 'restore' : 'revoke'}" data-email="${esc(i.email)}">${i.status === 'revoked' ? 'Restore' : 'Revoke'}</button></div>
          <label class="inv-name-row small"><span>First name</span>
            <input type="text" class="inv-name" value="${esc(nm)}" maxlength="80" autocomplete="given-name" aria-label="First name for ${esc(i.email)}" data-email="${esc(i.email)}">
            <button type="button" class="link-btn" data-act="save-name" data-email="${esc(i.email)}">Save</button></label>
          <textarea class="inv-note" readonly rows="6" aria-label="Invite note for ${esc(i.email)}">${esc(note)}</textarea>
          <div class="inv-actions data-btns">
            <button type="button" class="primary" data-act="copy" data-email="${esc(i.email)}">Copy</button>
            <a class="btn-link" data-act="sms" data-email="${esc(i.email)}" href="${esc(smsHref(note))}">Text it</a>
            ${shareBtn}
          </div>
        </div>
      </li>`;
    }
    async function load() {
      try {
        const { invites } = await callInvites(sb, { action: 'list' });
        list.innerHTML = invites.length ? invites.map(rowHtml).join('') : '<li class="muted small">No invites yet.</li>';
      } catch (e) { list.innerHTML = `<li class="onb-err">${esc(e.message)}</li>`; }
    }
    function refreshNote(row) {
      const inp = row.querySelector('.inv-name');
      const note = inviteNoteText(inp.value);
      row.querySelector('.inv-note').value = note;
      const a = row.querySelector('a[data-act=sms]'); if (a) a.href = smsHref(note);
    }
    list.oninput = e => { const inp = e.target.closest('.inv-name'); if (inp) refreshNote(inp.closest('.inv-row')); };
    list.onclick = async e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const act = b.dataset.act, em = b.dataset.email, row = b.closest('.inv-row');
      err.textContent = '';
      if (act === 'revoke' || act === 'restore') {
        if (act === 'revoke' && !confirm(`Revoke sign-in for ${em}? Their data is kept; you can restore access later.`)) return;
        b.disabled = true;
        try { await callInvites(sb, { action: act, email: em }); await load(); } catch (ex) { err.textContent = ex.message; b.disabled = false; }
        return;
      }
      if (act === 'save-name') {
        const nm = (row.querySelector('.inv-name').value || '').trim().slice(0, 80);
        b.disabled = true;
        writeInviteName(em, nm);
        try {
          await callInvites(sb, { action: 'set_name', email: em, firstName: nm });
          toast && toast(nm ? `Saved ${nm}` : 'Name cleared');
        } catch (ex) {
          // Live function may not have set_name yet — localStorage still keeps the name on this device.
          if (/Unknown action|HTTP 400/i.test(ex.message || '')) toast && toast(nm ? `Saved ${nm} on this device` : 'Cleared on this device');
          else { err.textContent = ex.message; b.disabled = false; return; }
        }
        refreshNote(row); b.disabled = false; return;
      }
      const text = row ? row.querySelector('.inv-note').value : inviteNoteText('');
      if (act === 'copy') {
        b.disabled = true;
        const ok = await copyText(text);
        toast && toast(ok ? 'Invite note copied' : 'Could not copy — select the note and copy manually');
        b.disabled = false; return;
      }
      if (act === 'share') {
        try { await navigator.share({ text }); } catch (ex) { if (ex && ex.name !== 'AbortError') err.textContent = ex.message || String(ex); }
      }
    };
    d.querySelector('form').onsubmit = async e => {
      e.preventDefault(); err.textContent = '';
      const v = email.value.trim().toLowerCase();
      const nm = (nameIn.value || '').trim().slice(0, 80);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { err.textContent = 'Enter a valid email address.'; return; }
      go.disabled = true; go.textContent = 'Inviting…';
      try {
        await callInvites(sb, { action: 'invite', email: v, firstName: nm, note: nm, sendEmail: d.querySelector('#invSend').checked });
        writeInviteName(v, nm);
        email.value = ''; nameIn.value = '';
        toast && toast(nm ? `Invited ${nm} · ${v}` : `Invited ${v}`);
        await load();
      } catch (ex) { err.textContent = ex.message; }
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

  window.SandyLaunch = { mount, openFeedback, openInvites, callInvites, inviteNoteText, inviteGreeting, INVITE_LINK, smsHref };
})();
