/* launch.js: free-prototype launch pieces, mounted in the Account section when signed in (Supabase mode).
 *  - Time zone setting (profiles.time_zone; detected from the browser at sign-up, editable here)
 *  - Feedback button -> public.feedback (RLS: you insert your own; only the admin reads everyone's)
 *  - Invites screen (admin only) -> Edge Function "admin-invites" (service role stays server-side)
 *  - Marks the signed-in user's invite as accepted (rpc accept_my_invite).
 *  - Feedback replies: Scott replies with a status; senders see "My feedback" + unread dots (2026-10-30). */
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
  function openFeedback({ sb, toast, after }) {
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
      d.close(); toast && toast('Thanks! Feedback sent'); if (typeof after === 'function') after();
    };
  }

  // ---------- Feedback replies (2026-10-30) ----------
  // Scott (admin only, RLS) replies with a status preset and/or custom text; the sender sees it in
  // "My feedback" with an unread dot and gets a web push (send-reminders cron). New feedback badges Scott.
  const FB_STATUS = { looking: "We're looking into it", fixing: "We're actively fixing it", fixed: "It's fixed", planned: 'Planned for a future update', note: 'Reply from Scott' };
  const FB_PRESETS = ['looking', 'fixing', 'fixed', 'planned'];
  const fmtFull = iso => iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const fbState = { sb: null, uid: null, admin: false, unread: 0, unseen: 0, onChange: null };
  function replyHtml(r, opts = {}) {
    const unread = opts.mine && !r.read_at;
    return `<li class="fbr st-${esc(r.status)}${unread ? ' unread' : ''}${opts.fresh ? ' fbr-new' : ''}" data-id="${esc(r.id)}">
      <div class="fbr-top"><span class="fbr-chip">${esc(FB_STATUS[r.status] || FB_STATUS.note)}</span>${unread ? '<span class="fbr-newtag">New</span>' : ''}
        <span class="small muted fbr-when">${esc(fmtFull(r.created_at))}</span></div>
      ${r.body ? `<div class="fbr-body">${esc(r.body)}</div>` : ''}
      ${opts.admin ? `<div class="fbr-meta small muted"><span>${r.read_at ? 'Seen ✓' : 'Not seen yet'}</span><button type="button" class="link-btn danger" data-act="del-reply" data-id="${esc(r.id)}">Delete</button></div>` : ''}
    </li>`;
  }
  const leave = el => new Promise(res => { if (!el) return res(); el.classList.add('fbr-leave'); setTimeout(() => { el.remove(); res(); }, 200); });
  function paintDots() {
    const n = fbState.admin ? fbState.unseen : 0, u = fbState.unread;
    const ib = document.getElementById('fbInboxBtn'); if (ib) { let b = ib.querySelector('.fb-count'); if (!b) { b = document.createElement('b'); b.className = 'fb-count'; ib.appendChild(b); } b.hidden = !n; b.textContent = n > 99 ? '99+' : String(n || ''); }
    const mb = document.getElementById('myFbBtn'); if (mb) { let d = mb.querySelector('.fb-dot'); if (!d) { d = document.createElement('b'); d.className = 'fb-dot'; d.setAttribute('aria-label', 'New reply'); mb.appendChild(d); } d.hidden = !u; }
    const nav = document.querySelector('.bottom-nav button[data-tab="profile"], button[data-tab="profile"]');
    if (nav) { let d = nav.querySelector('#navProfileDot'); if (!d) { d = document.createElement('b'); d.id = 'navProfileDot'; d.className = 'nav-badge nav-dot'; nav.appendChild(d); }
      const tot = u + n; d.hidden = !tot; d.textContent = tot > 9 ? '9+' : String(tot || ''); d.title = u ? 'New reply to your feedback' : 'New feedback'; }
  }
  async function refreshCounts() {
    const sb = fbState.sb; if (!sb) return;
    try {
      const r = await sb.from('feedback_replies').select('id', { count: 'exact', head: true }).eq('owner_id', fbState.uid).is('read_at', null);
      fbState.unread = r.error ? 0 : (r.count || 0);
      const mine = await sb.from('feedback').select('id', { count: 'exact', head: true }).eq('owner_id', fbState.uid);
      const mb = document.getElementById('myFbBtn'); if (mb) mb.hidden = !(mine.count > 0);
      if (fbState.admin) { const a = await sb.from('feedback').select('id', { count: 'exact', head: true }).is('seen_at', null); fbState.unseen = a.error ? 0 : (a.count || 0); }
    } catch (_) {}
    paintDots();
  }

  // ---------- My feedback (any signed-in user) ----------
  async function openMyFeedback({ sb, toast }) {
    const d = openDialog('fbin-dlg myfb-dlg', `<form method="dialog"><h2>My feedback</h2>
      <p class="muted small">Notes you've sent and Scott's updates on them.</p>
      <div class="fb-list"><p class="muted small">Loading…</p></div>
      <div class="data-btns"><button type="button" class="myfb-new">💬 Send more feedback</button><button value="cancel">Close</button></div></form>`);
    const box = d.querySelector('.fb-list');
    d.querySelector('.myfb-new').onclick = () => { d.close(); openFeedback({ sb, toast, after: refreshCounts }); };
    const [fb, rp] = await Promise.all([
      sb.from('feedback').select('id,body,created_at').eq('owner_id', fbState.uid).order('created_at', { ascending: false }).limit(100),
      sb.from('feedback_replies').select('id,feedback_id,status,body,created_at,read_at').eq('owner_id', fbState.uid).order('created_at', { ascending: true })]);
    if (fb.error) { box.innerHTML = `<p class="onb-err">${esc(fb.error.message)}</p>`; return; }
    const by = {}; (rp.data || []).forEach(r => (by[r.feedback_id] = by[r.feedback_id] || []).push(r));
    box.innerHTML = fb.data.length ? fb.data.map(f => { const rs = by[f.id] || []; return `<div class="fb-item" data-id="${esc(f.id)}">
        <div class="small muted">You · ${esc(fmtFull(f.created_at))}</div><div class="fb-body">${esc(f.body)}</div>
        ${rs.length ? `<ul class="fbr-list">${rs.map(r => replyHtml(r, { mine: true })).join('')}</ul>` : '<p class="small muted fbr-none">No reply yet. Scott reads every note.</p>'}</div>`; }).join('')
      : '<p class="muted small">You haven\'t sent any feedback yet.</p>';
    const first = box.querySelector('.fbr.unread'); if (first) first.closest('.fb-item').scrollIntoView({ block: 'nearest' });
    if (fbState.unread) { try { await sb.rpc('mark_my_feedback_replies_read'); } catch (_) {} fbState.unread = 0; paintDots(); }
  }

  // ---------- Feedback inbox (admin) ----------
  function composerHtml(id) {
    return `<div class="fbr-compose" data-id="${esc(id)}">
      <div class="fbr-presets" role="group" aria-label="Status">${FB_PRESETS.map(k => `<button type="button" class="fbr-preset st-${k}" data-st="${k}" aria-pressed="false">${esc(FB_STATUS[k])}</button>`).join('')}</div>
      <textarea class="fbr-text" rows="2" maxlength="2000" placeholder="Optional message (or write your own reply)"></textarea>
      <div class="fbr-actions"><button type="button" class="link-btn" data-act="cancel-reply">Cancel</button><button type="button" class="primary" data-act="send-reply" disabled>Send reply</button></div>
      <p class="small muted fbr-hint">They'll see it in SANDY and get a notification.</p></div>`;
  }
  async function openFeedbackInbox({ sb, toast }) {
    const d = openDialog('fbin-dlg', `<form method="dialog"><h2>Feedback</h2><div class="fb-list"><p class="muted small">Loading…</p></div>
      <p class="onb-err" role="alert"></p>
      <div class="data-btns"><button value="cancel">Close</button></div></form>`);
    const box = d.querySelector('.fb-list'), err = d.querySelector('.onb-err');
    let { data, error } = await sb.from('feedback').select('id,email,body,page,created_at,seen_at').order('created_at', { ascending: false }).limit(200);
    let replies = true;
    if (error) { replies = false; ({ data, error } = await sb.from('feedback').select('email,body,page,created_at').order('created_at', { ascending: false }).limit(200)); } // before the 2026-10-30 migration
    if (error) { box.innerHTML = `<p class="onb-err">${esc(error.message)}</p>`; return; }
    const rp = replies ? await sb.from('feedback_replies').select('id,feedback_id,status,body,created_at,read_at').order('created_at', { ascending: true }) : { data: [] };
    if (rp.error) replies = false;
    const by = {}; (rp.data || []).forEach(r => (by[r.feedback_id] = by[r.feedback_id] || []).push(r));
    box.innerHTML = data.length ? data.map(f => `<div class="fb-item${replies && !f.seen_at ? ' fb-unseen' : ''}" data-id="${esc(f.id || '')}">
        <div class="small muted">${replies && !f.seen_at ? '<span class="fbr-newtag">New</span> ' : ''}${esc(f.email || '')} · ${esc(new Date(f.created_at).toLocaleString())}</div><div class="fb-body">${esc(f.body)}</div>
        ${replies ? `<ul class="fbr-list">${(by[f.id] || []).map(r => replyHtml(r, { admin: true })).join('')}</ul>
        <button type="button" class="link-btn fbr-open" data-act="reply" data-id="${esc(f.id)}">↩︎ Reply with status</button>` : ''}</div>`).join('')
      : '<p class="muted small">No feedback yet.</p>';
    if (replies && fbState.unseen) { try { await sb.rpc('mark_feedback_seen'); } catch (_) {} fbState.unseen = 0; paintDots(); }
    box.onclick = async e => {
      const pre = e.target.closest('.fbr-preset');
      if (pre) { const c = pre.closest('.fbr-compose'); const on = pre.getAttribute('aria-pressed') !== 'true';
        c.querySelectorAll('.fbr-preset').forEach(x => x.setAttribute('aria-pressed', 'false')); pre.setAttribute('aria-pressed', String(on)); syncSend(c); return; }
      const b = e.target.closest('[data-act]'); if (!b) return; err.textContent = '';
      const item = b.closest('.fb-item');
      if (b.dataset.act === 'reply') {
        if (item.querySelector('.fbr-compose')) return;
        b.hidden = true; b.insertAdjacentHTML('afterend', composerHtml(b.dataset.id));
        const c = item.querySelector('.fbr-compose'); c.querySelector('.fbr-text').oninput = () => syncSend(c);
        c.scrollIntoView({ block: 'nearest' }); return;
      }
      if (b.dataset.act === 'cancel-reply') { const c = b.closest('.fbr-compose'); await leave(c); item.querySelector('.fbr-open').hidden = false; return; }
      if (b.dataset.act === 'send-reply') {
        const c = b.closest('.fbr-compose'); const p = c.querySelector('.fbr-preset[aria-pressed="true"]'); const text = c.querySelector('.fbr-text').value.trim();
        const status = p ? p.dataset.st : 'note'; if (!p && !text) return;
        b.disabled = true; b.textContent = 'Sending…';
        const { data: row, error: e2 } = await sb.from('feedback_replies').insert({ feedback_id: c.dataset.id, status, body: text || null }).select('id,feedback_id,status,body,created_at,read_at').single();
        if (e2) { err.textContent = 'Could not send: ' + e2.message; b.disabled = false; b.textContent = 'Send reply'; return; }
        item.querySelector('.fbr-list').insertAdjacentHTML('beforeend', replyHtml(row, { admin: true, fresh: true }));
        await leave(c); item.querySelector('.fbr-open').hidden = false;
        toast && toast('Reply sent · they\'ll get a notification'); return;
      }
      if (b.dataset.act === 'del-reply') {
        if (!confirm('Delete this reply? If it was already delivered, the notification stays on their device.')) return;
        b.disabled = true; const { error: e3 } = await sb.from('feedback_replies').delete().eq('id', b.dataset.id);
        if (e3) { err.textContent = e3.message; b.disabled = false; return; }
        await leave(b.closest('.fbr'));
      }
    };
    function syncSend(c) { c.querySelector('[data-act="send-reply"]').disabled = !c.querySelector('.fbr-preset[aria-pressed="true"]') && !c.querySelector('.fbr-text').value.trim(); }
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
      <div class="data-btns"><button id="feedbackBtn" type="button">💬 Send feedback</button><button id="myFbBtn" type="button" hidden>My feedback</button></div>
      <div class="data-btns admin-btns" hidden><button id="invitesBtn" type="button">✉️ Invites</button><button id="fbInboxBtn" type="button">Feedback inbox</button></div>`;
    const anchor = sec.querySelector('#acctDelete'); sec.insertBefore(box, anchor);
    const sel = box.querySelector('#tzSelect');
    sel.onchange = async () => {
      const z = sel.value; sel.disabled = true;
      try { await store.saveProfile({ time_zone: z }); setTZ(z); toast(`Time zone: ${z.replace(/_/g, ' ')}`); }
      catch (e) { alert('Could not save time zone: ' + (e.message || e)); sel.value = timeZone(); }
      sel.disabled = false;
    };
    box.querySelector('#feedbackBtn').onclick = () => openFeedback({ sb, toast, after: refreshCounts });
    box.querySelector('#myFbBtn').onclick = () => openMyFeedback({ sb, toast });
    Object.assign(fbState, { sb, uid: user.id, admin: false });
    const q = new URLSearchParams(location.search), want = q.get('fb'); // opened from a push notification
    if (want) { q.delete('fb'); try { history.replaceState(history.state, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash); } catch (_) {} }
    sb.rpc('sandy_is_admin').then(({ data }) => {
      fbState.admin = data === true;
      if (fbState.admin) {
        box.querySelector('.admin-btns').hidden = false;
        box.querySelector('#invitesBtn').onclick = () => openInvites({ sb, toast });
        box.querySelector('#fbInboxBtn').onclick = () => openFeedbackInbox({ sb, toast });
      }
      refreshCounts().then(() => {
        if (want === 'inbox' && fbState.admin) openFeedbackInbox({ sb, toast });
        else if (want === 'mine') openMyFeedback({ sb, toast });
      });
    }, () => { refreshCounts(); });
    // pick up replies/new feedback that arrive while the app is open
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshCounts(); });
  }

  window.SandyLaunch = { mount, openFeedback, openMyFeedback, openFeedbackInbox, refreshCounts, FB_STATUS, openInvites, callInvites, inviteNoteText, inviteGreeting, INVITE_LINK, smsHref };
})();
