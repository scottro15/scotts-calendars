// Swipe navigation (touch, 390px). node tests/swipe_nav.test.js
const { chromium } = require('/workspace/shot-tools/node_modules/playwright-core');
const B=process.argv[2]||'http://127.0.0.1:8767/';
const ok=(c,m)=>{ if(!c) throw new Error('FAIL '+m); console.log('ok -',m); };
(async()=>{ const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
 const ctx=await b.newContext({viewport:{width:390,height:700},isMobile:true,hasTouch:true,timezoneId:'America/Chicago'});
 const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
 await p.clock.install({time:new Date('2026-10-21T16:15:00Z')});
 await p.goto(B); await p.waitForSelector('.fc'); await p.evaluate(()=>localStorage.setItem('sandy.lastView','listWeek')); await p.reload();
 await p.waitForSelector('.fc-list-day'); await p.waitForTimeout(1500);
 const cdp=await ctx.newCDPSession(p);
 const swipe=async(x0,y0,x1,y1,ms=150)=>{ const n=6; await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x0,y:y0}]});
  for(let i=1;i<=n;i++){ await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x0+(x1-x0)*i/n,y:y0+(y1-y0)*i/n}]}); await p.waitForTimeout(ms/n); }
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await p.waitForTimeout(500); };
 const title=()=>p.textContent('.fc-toolbar-title');
 const t0=await title(); console.log('start',t0);
 await swipe(330,400,80,410); const t1=await title(); console.log(t1); ok(/Oct 25/.test(t1)&&/31/.test(t1),'list swipe left -> Oct 25-31');
 ok(await p.evaluate(()=>scrollY)<5,'scrolled to top of new range');
 await swipe(60,400,330,395); ok(await title()===t0,'swipe right -> back');
 await swipe(200,500,230,200); ok(await title()===t0,'vertical swipe ignored');
 await swipe(330,400,280,400); ok(await title()===t0,'short swipe ignored');
 await swipe(330,400,80,410,1200); ok(await title()===t0,'slow drag ignored');
 for (const [v,re0] of [['timeGridDay',/October 21/],['timeGridWeek',null],['dayGridMonth',/October/]]) {
  await p.click(`.fc-${v}-button`); await p.waitForTimeout(400); const a=await title();
  await swipe(330,450,60,460); const c=await title(); ok(c!==a,`${v} swipe left changes period (${a} -> ${c})`);
  await swipe(60,450,330,440); ok(await title()===a,`${v} swipe right back`);
 }
 await p.click('.fc-dayGridMonth-button'); await p.waitForTimeout(300);
 await p.evaluate(()=>{const d=document.createElement('dialog');d.id='tdlg';d.innerHTML='x';document.body.appendChild(d);d.showModal();});
 const a=await title(); await swipe(330,450,60,460); ok(await title()===a,'no swipe while modal open');
 ok(errs.length===0,'no errors '+errs); await b.close(); })().catch(e=>{console.error(e);process.exit(1)});
