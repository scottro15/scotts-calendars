// Google-Calendar-style pager: neighbour visible mid-swipe, 30% / flick commit, event-start swipes, tap still opens. node tests/swipe_pager.test.js URL
const { chromium } = require(process.env.PW || '/workspace/shot-tools/node_modules/playwright-core');
const B=process.argv[2]||'http://127.0.0.1:8824/';
const ok=(c,m)=>{ if(!c) throw new Error('FAIL '+m); console.log('ok -',m); };
(async()=>{ const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
 const ctx=await b.newContext({viewport:{width:390,height:760},isMobile:true,hasTouch:true,timezoneId:'America/Chicago'});
 const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
 await p.clock.install({time:new Date('2026-10-21T16:15:00Z')});
 await p.goto(B); await p.waitForSelector('.fc'); await p.evaluate(()=>localStorage.setItem('sandy.lastView','listWeek')); await p.reload();
 await p.waitForSelector('.fc-list-day'); await p.waitForTimeout(1500);
 const cdp=await ctx.newCDPSession(p); const T=(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y}]});
 const title=()=>p.textContent('.fc-toolbar-title');
 for (const [v,name] of [['listWeek','list'],['timeGridDay','day'],['timeGridWeek','week'],['dayGridMonth','month']]) {
  await p.click(`.fc-${v}-button`); await p.waitForTimeout(900); const a=await title();
  const Y=await p.evaluate(()=>{const r=document.querySelector('#calendar .fc-view-harness').getBoundingClientRect(); const lo=Math.max(r.top,140), hi=Math.min(r.bottom,innerHeight-70); return Math.round((lo+hi)/2);});
  await T('touchStart',340,Y); for(let x=330;x>=200;x-=10){ await T('touchMove',x,Y+2); await p.waitForTimeout(16); }
  const st=await p.evaluate(()=>{const h=document.querySelector('#calendar .fc-view-harness'); const g=document.querySelector('.swipe-ghost.on');
    const gr=g&&g.getBoundingClientRect(); return {tf:h.style.transform, ghost:!!g, dir:g&&g.dataset.dir, gl:gr&&Math.round(gr.left), cells:g?g.querySelectorAll('[data-date]').length:0, evs:g?g.querySelectorAll('.fc-event').length:0,
      toolbarTop:Math.round(document.querySelector('.fc-header-toolbar').getBoundingClientRect().top)};});
  console.log(name,JSON.stringify(st));
  ok(/translate3d\(-1[34]\d/.test(st.tf),name+': page follows finger 1:1');
  ok(st.ghost&&st.dir==='next'&&st.gl>150&&st.gl<300,name+': next page visible beside it');
  ok(st.cells>0||name==='list',name+': neighbour has real dates');
  await p.screenshot({path:`screenshots/24_swipe_mid_${name}_mobile.png`});
  await T('touchMove',300,Y+2); await p.waitForTimeout(200); await T('touchEnd'); await p.waitForTimeout(500);
  ok(await title()===a,name+': under 30% springs back');
  await T('touchStart',340,Y); for(let x=330;x>=200;x-=5){ await T('touchMove',x,Y+2); await p.waitForTimeout(25); } await p.waitForTimeout(200); await T('touchEnd'); await p.waitForTimeout(700);
  const c=await title(); ok(c!==a,name+': slow drag past 30% commits ('+c+')'); await p.waitForTimeout(1200);
  const Y2=await p.evaluate(()=>{const r=document.querySelector('#calendar .fc-view-harness').getBoundingClientRect(); const lo=Math.max(r.top,140), hi=Math.min(r.bottom,innerHeight-70); return Math.round((lo+hi)/2);});
  await T('touchStart',100,Y2); await T('touchMove',130,Y2+2); await p.waitForTimeout(10); await T('touchMove',170,Y2+2); await T('touchEnd'); await p.waitForTimeout(700);
  {const tt=await title(); ok(tt===a,name+': fast flick right goes back '+tt+' '+JSON.stringify(await p.evaluate(()=>window.__swipeLast)));}
  ok(await p.evaluate(()=>!document.querySelector('.swipe-ghost.on')),name+': ghosts hidden after');
 }
 // swipe starting on an event (Week view), then a tap still opens the editor
 await p.click('.fc-timeGridDay-button'); await p.waitForTimeout(900);
 const ev=await p.evaluate(()=>{const e=[...document.querySelectorAll('#calendar .fc-timegrid-event')].find(n=>{const r=n.getBoundingClientRect(); return r.top>200&&r.bottom<740;}); if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+Math.min(15,r.height/2)};});
 if (!ev) { await p.evaluate(()=>scrollTo(0,500)); await p.waitForTimeout(300); }
 const ev2=ev||await p.evaluate(()=>{const e=[...document.querySelectorAll('#calendar .fc-timegrid-event')].find(n=>{const r=n.getBoundingClientRect(); return r.top>200&&r.bottom<740;}); const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+Math.min(15,r.height/2)};});
 for (let i=0;i<2;i++){ const a=await title();
  await T('touchStart',ev2.x,ev2.y); for(let k=1;k<=8;k++){ await T('touchMove',ev2.x-k*25,ev2.y+1); await p.waitForTimeout(16);} await T('touchEnd'); await p.waitForTimeout(700);
  ok(await title()!==a,'swipe starting on an event changes day #'+(i+1)); ok(!(await p.evaluate(()=>document.querySelector('dialog[open]'))),'editor did not open on swipe');
  await T('touchStart',60,ev2.y); for(let k=1;k<=8;k++){ await T('touchMove',60+k*30,ev2.y); await p.waitForTimeout(16);} await T('touchEnd'); await p.waitForTimeout(700);
  ok(await title()===a,'back'); }
 { const a=await title(); await T('touchStart',ev2.x,ev2.y); await p.waitForTimeout(1150); for(let k=1;k<=5;k++){ await T('touchMove',ev2.x-k*4,ev2.y+k*12); await p.waitForTimeout(30);} 
   const m=await p.evaluate(()=>!!document.querySelector('.fc-event-mirror, .fc-event-dragging')); await T('touchEnd'); await p.waitForTimeout(600);
   ok(m,'long-press drag of an event still works'); ok(await title()===a,'long-press drag does not change day'); await p.keyboard.press('Escape'); await p.waitForTimeout(300); }
 await p.tap(`#calendar .fc-timegrid-event >> nth=0`).catch(()=>{}); await p.waitForTimeout(500);
 ok(await p.evaluate(()=>!!document.querySelector('dialog[open]')),'tap on event still opens editor');
 ok(errs.length===0,'no errors '+errs); await b.close(); })().catch(e=>{console.error(e);process.exit(1)});
