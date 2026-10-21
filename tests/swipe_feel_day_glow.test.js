// Swipe follows finger + spring back; Day view today glow (clockwise). node tests/swipe_feel_day_glow.test.js
const { chromium } = require('/workspace/shot-tools/node_modules/playwright-core');
const B=process.argv[2]||'http://127.0.0.1:8767/';
const ok=(c,m)=>{ if(!c) throw new Error('FAIL '+m); console.log('ok -',m); };
(async()=>{ const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
 for (const rm of ['no-preference','reduce']) {
 const ctx=await b.newContext({viewport:{width:390,height:700},isMobile:true,hasTouch:true,timezoneId:'America/Chicago',reducedMotion:rm});
 const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
 await p.clock.setFixedTime(new Date('2026-10-21T16:15:00Z'));
 await p.goto(B); await p.waitForSelector('.fc'); await p.evaluate(()=>localStorage.setItem('sandy.lastView','timeGridDay')); await p.reload();
 await p.waitForSelector('.fc-timeGridDay-view'); await p.waitForTimeout(800);
 const title=()=>p.textContent('.fc-toolbar-title');
 ok(/October 21/.test(await title()),rm+': day view on today');
 const glow=()=>p.evaluate(()=>{const c=document.querySelector('.fc-timeGridDay-view .fc-col-header-cell'); const st=getComputedStyle(c,'::after'); return {content:st.content, anim:st.animationName};});
 const g=await glow(); ok(g.content!=='none', rm+': today header has border'); ok(rm==='reduce'? g.anim==='none' : g.anim==='sandy-cw', rm+': animation '+g.anim);
 if (rm==='no-preference') await p.screenshot({path:'screenshots/23_day_today_glow_mobile.png'});
 const cdp=await ctx.newCDPSession(p);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:310,y:650}]});
 for (let x=300;x>=160;x-=20){ await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:652}]}); await p.waitForTimeout(15); }
 const tf=await p.evaluate(()=>document.querySelector('#calendar .fc-view-harness').style.transform);
 if (rm==='no-preference') { ok(/translate3d\(-1[45]\d/.test(tf), 'harness follows finger 1:1: '+tf); await p.screenshot({path:'screenshots/23_swipe_drag_mobile.png'}); }
 else ok(!tf,'reduced motion: no drag follow');
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:270,y:652}]}); // back under threshold -> spring back
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await p.waitForTimeout(400);
 ok(/October 21/.test(await title()) && !(await p.evaluate(()=>document.querySelector('#calendar .fc-view-harness').style.transform)), rm+': springs back, no change');
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:320,y:650}]});
 for (let x=300;x>=80;x-=40){ await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:652}]}); await p.waitForTimeout(15); }
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await p.waitForTimeout(600);
 {const tt=await title(); ok(/October 22/.test(tt), rm+': swipe -> Oct 22 '+tt);}
 ok((await glow()).content==='none', rm+': other day has no border');
 if (rm==='no-preference') await p.screenshot({path:'screenshots/23_day_other_noglow_mobile.png'});
 ok(errs.length===0,'no errors '+errs); await ctx.close(); }
 await b.close(); })().catch(e=>{console.error(e);process.exit(1)});
