// Sticky toolbar/day headers in all views, cold-open List scroll to today, last-view restore. node tests/sticky_headers_lastview.test.js
const { chromium } = require('/workspace/shot-tools/node_modules/playwright-core');
const B='http://127.0.0.1:8766/', S='/workspace/calendar-app/screenshots/';
const ok=(c,m)=>{ if(!c) throw new Error('FAIL '+m); console.log('ok -',m); };
(async()=>{ const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
for (const vp of [{width:1300,height:700,name:'desktop'},{width:390,height:700,name:'mobile'}]) {
 const ctx=await b.newContext({viewport:vp,isMobile:vp.name==='mobile',hasTouch:vp.name==='mobile',timezoneId:'America/Chicago'});
 const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
 await p.clock.install({time:new Date('2026-10-21T16:15:00Z')});
 await p.goto(B); await p.waitForSelector('.fc'); await p.evaluate(()=>localStorage.setItem('sandy.lastView','listWeek')); await p.reload();
 await p.waitForSelector('.fc-list-day'); await p.waitForTimeout(2500);
 const hdrTop=await p.$eval('tr.fc-list-day[data-date="2026-10-21"]',e=>e.getBoundingClientRect().top);
 const stack=await p.evaluate(()=>[document.querySelector('.topbar').getBoundingClientRect().bottom, document.querySelector('.fc-header-toolbar').getBoundingClientRect().bottom]);
 console.log(vp.name,'today hdr',hdrTop,'stack',stack); ok(Math.abs(hdrTop-stack[1])<12,'cold open list scrolled to today');
 await p.screenshot({path:S+`19_sticky_list_cold_${vp.name}.png`});
 for (const [v,n] of [['dayGridMonth','month'],['timeGridWeek','week'],['timeGridDay','day']]) {
  await p.click(`.fc-${v}-button`); await p.waitForTimeout(400); await p.evaluate(()=>window.scrollTo(0,600)); await p.waitForTimeout(300);
  const r=await p.evaluate(()=>{const t=document.querySelector('.fc-header-toolbar').getBoundingClientRect(); const h=document.querySelector('.fc-col-header')?.getBoundingClientRect(); const tb=document.querySelector('.topbar').getBoundingClientRect(); return {tb:tb.bottom,t:t.top,tbot:t.bottom,h:h&&h.top,title:document.querySelector('.fc-toolbar-title').textContent,col:document.querySelector('.fc-col-header')?.textContent, sy:scrollY};});
  console.log(n,JSON.stringify(r)); ok(r.sy>0 && Math.abs(r.t-r.tb)<2 && r.h!=null && Math.abs(r.h-r.tbot)<2,`${vp.name} ${n} toolbar+day header pinned`);
  await p.screenshot({path:S+`19_sticky_${n}_${vp.name}.png`});
 }
 // restore: last view day -> reload Friday -> day view on Friday
 await p.clock.setSystemTime(new Date('2026-10-23T16:15:00Z')); await p.reload(); await p.waitForSelector('.fc'); await p.waitForTimeout(500);
 const t=await p.evaluate(()=>[document.querySelector('.fc-timeGridDay-view')!=null,document.querySelector('.fc-toolbar-title').textContent]); console.log(t); ok(t[0]&&/October 23, 2026/.test(t[1]),'reopens last view on today');
 await p.goto(B+'?view=dayGridMonth&date=2026-12-05'); await p.waitForSelector('.fc-dayGridMonth-view'); ok(/December/.test(await p.textContent('.fc-toolbar-title')),'params win');
 ok(errs.length===0,'no errors '+errs); await ctx.close(); }
await b.close(); })().catch(e=>{console.error(e);process.exit(1)});
