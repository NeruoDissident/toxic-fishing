/* End-to-end tests. Drives the real game in headless Chrome and inspects live state.
 *
 *   npm i --no-save puppeteer-core
 *   python3 -m http.server 8766 &
 *   CHROME=/path/to/chrome node tests/e2e.js http://localhost:8766
 *
 * Screenshots land in tests/shots/ (gitignored).
 */
const puppeteer = require('puppeteer-core');
const BASE = process.argv[2] || 'http://localhost:8766';
const SHOTS = __dirname + '/shots';
const CHROME = process.env.CHROME || ({
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
}[process.platform] || '/usr/bin/google-chrome');
require('fs').mkdirSync(SHOTS, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) { passes++; console.log('  ✓', msg); } else { fails++; console.log('  ✗ FAIL:', msg); } };

async function newPage(browser, vp, errs) {
  const page = await browser.newPage();
  await page.setViewport(vp);
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console.error ' + m.text()); });
  page.on('requestfailed', r => errs.push('REQFAIL ' + r.url()));
  return page;
}

/* Play a fight by reading the real state and pressing the real button. */
const AUTOPLAY = async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const btn = document.querySelector('#action');
  const down = () => btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  const up = () => btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  let held = false;
  for (let i = 0; i < 4000 && R.mode === 'fight' && R.fight; i++) {
    const F = R.fight;
    const want = !(F.warn > 0 || F.surge > 0) && F.tens < 0.75 && F.fy > F.by + F.bh * 0.5;
    if (want !== held) { want ? down() : up(); held = want; }
    await sleep(25);
  }
  if (held) up();
  return R.mode;
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--hide-scrollbars'],
  });
  const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  const DESK = { width: 1280, height: 720, deviceScaleFactor: 1 };

  /* ================================================== 1. fresh player, phone */
  console.log('\n[1] Fresh player on a phone: tutorial path');
  {
    const errs = [];
    const page = await newPage(browser, PHONE, errs);
    await page.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(1500);
    await page.click('#start');
    await sleep(1500);

    const st = await page.evaluate(() => ({ jobs: S.jobs.length, cond: R.cond, hot: !!R.hot, tut: S.tutDone,
      jobsText: document.querySelector('#jobs').textContent.trim().slice(0, 40) }));
    ok(st.jobs === 3, `three lab jobs generated (${st.jobs})`);
    ok(st.cond === 'clear', `day one at the pond is still air (${st.cond})`);
    ok(st.hot, 'hotspot placed');
    ok(st.tut === false, 'fresh save is in coaching mode');

    // aim at the hotspot, charge, check the ring tracks it
    await page.evaluate(() => { const b = document.querySelector('#action'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    await sleep(900);
    const aim = await page.evaluate(() => ({ on: R.aimOn, hint: document.querySelector('#hint').textContent }));
    ok(aim.on, 'aim ring shows while charging');
    ok(/ring/.test(aim.hint), `first-cast hint shown ("${aim.hint}")`);
    await page.screenshot({ path: SHOTS + '/1-aim.png' });
    await page.evaluate(() => document.querySelector('#action').dispatchEvent(new PointerEvent('pointerup', { bubbles: true })));

    await page.waitForFunction(() => R.mode === 'bite', { timeout: 120000, polling: 50 });
    const bite = await page.evaluate(() => ({ hint: document.querySelector('#hint').textContent, fish: R.hooked.id }));
    ok(/SET THE HOOK/.test(bite.hint), 'bite coaching hint shown');
    ok(bite.fish === 'rustgill', `first fish is the calm common (${bite.fish})`);
    await page.evaluate(() => { const b = document.querySelector('#action');
      b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); });
    await sleep(400);
    const f1 = await page.evaluate(() => ({ coach: document.querySelector('#coach').classList.contains('on'),
      railHidden: document.querySelector('#hud').classList.contains('fighting'), next: R.fight && R.fight.next }));
    ok(f1.coach, 'coach panel is on during the first fight');
    ok(f1.railHidden, 'menus fade out during the fight');
    ok(f1.next > 900, 'no surges in the first fight');
    await sleep(1500);
    await page.screenshot({ path: SHOTS + '/1-coach.png' });
    const end = await page.evaluate(AUTOPLAY);
    ok(end === 'reveal', `first fish landed (${end})`);
    await page.screenshot({ path: SHOTS + '/1-reveal.png' });
    const after = await page.evaluate(() => ({ tf: S.tutFights, td: S.tutDone,
      coach: document.querySelector('#coach').classList.contains('on'),
      fighting: document.querySelector('#hud').classList.contains('fighting') }));
    ok(after.tf === 1 && !after.td, `one coached fight recorded (${after.tf})`);
    ok(!after.coach && !after.fighting, 'coach and focus mode cleared after landing');
    ok(errs.length === 0, 'no errors: ' + (errs.join(' | ') || 'none'));
    await page.close();
  }

  /* ================================================== 2. v1 save migration */
  console.log('\n[2] Migrating a v1 save');
  {
    const errs = [];
    const page = await newPage(browser, DESK, errs);
    await page.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('toxicfishing.v1', JSON.stringify({
        lvl: 9, xp: 40, cred: 2300, sp: 1, day: 14, loc: 'ridge', exposure: 38.5,
        skills: { haggle: 2, steady: 1 }, codex: { rustgill: true, roach: true, carp: true, cinder: true },
        best: { rustgill: 17 }, counts: { rustgill: 9 }, baits: { grub: 12, glow: 30, roe: 4, cell: 0, chum: 0, null: 0 },
        cures: { iodine: 2, chel: 0, purge: 0 }, bait: 'glow', unlocked: ['pond', 'city', 'ridge'],
        afflict: 'shakes', totalCatch: 61, seen: true }));
    });
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(1200);
    const m = await page.evaluate(() => ({ lvl: S.lvl, cred: S.cred, day: S.day, loc: S.loc, td: S.tutDone,
      gear: JSON.stringify(S.gear), jobs: S.jobs.length, mut: typeof S.mut, codex: Object.keys(S.codex).length,
      aff: S.afflict, tag: document.querySelector('#tagline').textContent }));
    ok(m.lvl === 9 && m.cred === 2300 && m.day === 14 && m.loc === 'ridge', 'progress carried over');
    ok(m.codex === 4 && m.aff === 'shakes', 'codex and affliction kept');
    ok(m.td === true, 'veteran skips the coaching');
    ok(m.gear === '{"rod":0,"line":0,"suit":0}', 'gear defaults added');
    ok(m.jobs === 3 && m.mut === 'object', 'jobs and mutation book initialised');
    ok(/Level 9/.test(m.tag), 'title screen shows the carried-over shift');
    ok(errs.length === 0, 'no errors: ' + (errs.join(' | ') || 'none'));
    await page.close();
  }

  /* ================================================== 3. systems, desktop */
  console.log('\n[3] Systems: gear, jobs, weather, panels, perks, ending');
  {
    const errs = [];
    const page = await newPage(browser, DESK, errs);
    await page.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('toxicfishing.v1', JSON.stringify({ lvl: 12, cred: 9000, day: 5, loc: 'pond',
        unlocked: ['pond', 'city', 'ridge', 'basin'], totalCatch: 120, seen: true, tutDone: true, tutFights: 2,
        codex: { rustgill: true, roach: true, carp: true, eel: true, pike: true } }));
    });
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(1000);
    await page.click('#start');
    await sleep(1200);

    // gear
    const g0 = await page.evaluate(() => ({ box: G.st.bracket(), tens: G.st.tensCap(), dose: G.st.expoMul() }));
    await page.evaluate(() => UI.open('shop'));
    await sleep(300);
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => { const b = [...document.querySelectorAll('#mbody .row .buy')][0]; b && b.click(); });
      await sleep(120);
    }
    await page.evaluate(() => { const b = [...document.querySelectorAll('#mbody .row .buy')][1]; b && b.click(); });
    await page.evaluate(() => { const b = [...document.querySelectorAll('#mbody .row .buy')][2]; b && b.click(); });
    await sleep(200);
    const g1 = await page.evaluate(() => ({ gear: JSON.stringify(S.gear), cred: S.cred, box: G.st.bracket(), tens: G.st.tensCap(), dose: G.st.expoMul() }));
    ok(g1.gear === '{"rod":3,"line":1,"suit":1}', `gear bought through the Supply UI (${g1.gear})`);
    ok(g1.cred === 9000 - (350 + 1400 + 4200) - 300 - 450, `credits charged correctly (${g1.cred})`);
    ok(Math.abs(g1.box / g0.box - 1.22) < 0.01, `top rod: box ×${(g1.box / g0.box).toFixed(3)}`);
    ok(Math.abs(g1.tens / g0.tens - 1.10) < 0.01 && Math.abs(g1.dose / g0.dose - 0.90) < 0.01, 'line and suit applied');
    await page.screenshot({ path: SHOTS + '/3-supply.png' });

    // every panel opens cleanly
    for (const p of ['codex', 'skills', 'travel', 'jobs', 'opts']) {
      await page.evaluate(n => { UI.closeModal(); UI.open(n); }, p);
      await sleep(350);
      const open = await page.evaluate(() => document.querySelector('#modal').classList.contains('on') && document.querySelector('#mbody').children.length > 0);
      ok(open, `${p} panel renders`);
      await page.screenshot({ path: `${SHOTS}/3-panel-${p}.png` });
    }
    await page.evaluate(() => UI.closeModal());

    // each weather builds and modifies stats
    for (const c of ['rain', 'fog', 'ash', 'bloom', 'clear']) {
      const r = await page.evaluate(c => { R.cond = c; W.build(LOCBY[S.loc], 7, c); G.placeHot();
        return { wait: G.st.waitMul(), box: G.st.bracket(), dose: G.st.expoMul() }; }, c);
      await sleep(1600);
      await page.screenshot({ path: `${SHOTS}/3-weather-${c}.png` });
      ok(r.wait > 0 && r.box > 0, `${c}: scene built, wait ×${r.wait.toFixed(2)} box ${r.box.toFixed(3)} dose ×${r.dose.toFixed(2)}`);
    }

    // hotspot: rarity pull is real
    const pull = await page.evaluate(() => {
      const n = 6000, cnt = (hot) => { let r = 0; for (let i = 0; i < n; i++) { const f = G.rollFish(0.5, hot); if (f.rarity === 'rare' || f.rarity === 'epic') r++; } return r / n; };
      S.bait = 'grub'; return { off: cnt(false), on: cnt(true) };
    });
    ok(pull.on > pull.off * 1.4, `hotspot raises rare+epic odds ${(pull.off * 100).toFixed(1)}% → ${(pull.on * 100).toFixed(1)}%`);

    // complete the pond page by landing the 6th species through the real fight path
    const landFish = async (id, mut) => page.evaluate(async (id, mut) => {
      const f = FISHBY[id];
      R.mode = 'fight';
      R.fight = { f, size: { norm: .5, cm: (f.min + f.max) / 2 }, diff: 1, mut: !!mut, fy: .5, ftar: .5, ft: 9, by: .45, bv: 0, bh: .2,
        prog: .999, tens: 0, surge: 0, warn: 0, next: 99, hold: false, elapsed: 5, saved: false };
      G.stepFight(0.05);
      return R.mode;
    }, id, mut);
    const before = await page.evaluate(() => G.st.bracket());
    ok((await landFish('turbine')) === 'reveal', 'landed Turbine Ghost through stepFight');
    const perk = await page.evaluate(() => ({ q: R.queue.length, title: R.queue[0] && R.queue[0][0], box: G.st.bracket() }));
    ok(perk.q === 1 && perk.title === 'Codex page complete', 'page-complete perk queued behind the catch card');
    ok(Math.abs(perk.box / before - 1.05) < 0.01, `Steady Footing applied: box ×${(perk.box / before).toFixed(3)}`);
    await page.screenshot({ path: SHOTS + '/3-reveal-turbine.png' });
    await page.evaluate(() => UI.closeReveal());
    await sleep(400);
    const shown = await page.evaluate(() => document.querySelector('#mtitle').textContent);
    ok(shown === 'Codex page complete', 'perk modal shown after the catch card closes');
    await page.screenshot({ path: SHOTS + '/3-perk.png' });
    await page.evaluate(() => UI.closeModal());

    // jobs: force a known job and finish it
    const job = await page.evaluate(() => {
      S.jobs = [{ k: 'species', fish: 'eel', need: 1, got: 0, done: false, cr: 200, xp: 50 },
                { k: 'haul', loc: 'pond', need: 2, got: 0, done: false, cr: 120, xp: 30 },
                { k: 'hot', need: 2, got: 0, done: false, cr: 150, xp: 40 }];
      UI.jobs(); return S.cred;
    });
    await landFish('eel'); await page.evaluate(() => UI.closeReveal());
    const j1 = await page.evaluate(() => ({ jobs: S.jobs.map(j => j.k + ':' + j.got + (j.done ? '✓' : '')).join(' '),
      extra: document.querySelector('#rextra').textContent, cred: S.cred }));
    ok(/species:1✓/.test(j1.jobs) && /haul:1 /.test(j1.jobs) && /hot:1$/.test(j1.jobs), `one eel advances three jobs (${j1.jobs})`);
    ok(/Lab job done/.test(j1.extra), 'catch card lists the finished job');
    await landFish('pike'); await page.evaluate(() => UI.closeReveal());
    const j2 = await page.evaluate(() => S.jobs.filter(j => j.done).length);
    ok(j2 === 3, `all three jobs done after the pike (${j2}/3)`);
    await page.screenshot({ path: SHOTS + '/3-jobs-done.png' });

    // mutation
    await landFish('roach', true);
    const mu = await page.evaluate(() => ({ m: !!S.mut.roach, label: document.querySelector('#rrar').textContent,
      extra: document.querySelector('#rextra').textContent }));
    ok(mu.m && /MUTATED/.test(mu.label) && /NEW MUTATION/.test(mu.extra), 'mutation logged and announced');
    await page.screenshot({ path: SHOTS + '/3-mutation.png' });
    await page.evaluate(() => UI.closeReveal());

    // ending: log 39, land the 40th
    await page.evaluate(() => { FISH.forEach(f => { if (f.id !== 'null') S.codex[f.id] = true; }); R.queue = []; });
    await landFish('null');
    const en = await page.evaluate(() => ({ ended: S.ended, q: R.queue.map(x => x[0]).join(',') }));
    ok(en.ended, 'survey marked complete at 40/40');
    ok(/Codex page complete/.test(en.q) && /Survey complete/.test(en.q), `anomaly perk and ending both queued (${en.q})`);
    await page.evaluate(() => UI.closeReveal()); await sleep(300);
    await page.evaluate(() => UI.closeModal()); await sleep(400);
    const fin = await page.evaluate(() => document.querySelector('#mtitle').textContent);
    ok(fin === 'Survey complete', 'ending shown after the perk');
    await page.screenshot({ path: SHOTS + '/3-ending.png' });
    await page.evaluate(() => UI.closeModal());

    // new day rolls jobs, weather and hotspot
    const d0 = await page.evaluate(() => ({ day: S.day, jobs: JSON.stringify(S.jobs) }));
    await page.evaluate(() => G.rest()); await sleep(300);
    const d1 = await page.evaluate(() => ({ day: S.day, jobs: JSON.stringify(S.jobs), jd: S.jobDay, title: document.querySelector('#mtitle').textContent,
      body: document.querySelector('#mbody').textContent }));
    ok(d1.day === d0.day + 1 && d1.jd === d1.day && d1.jobs !== d0.jobs, 'packing up posts new jobs for the new day');
    ok(/this morning/.test(d1.body), 'day summary names the morning weather');
    await page.evaluate(() => UI.closeModal());

    // persistence round-trip
    await page.reload({ waitUntil: 'networkidle0' }); await sleep(800);
    const p2 = await page.evaluate(() => ({ ended: S.ended, gear: JSON.stringify(S.gear), mut: Object.keys(S.mut).length, jd: S.jobDay === S.day }));
    ok(p2.ended && p2.gear === '{"rod":3,"line":1,"suit":1}' && p2.mut === 1 && p2.jd, 'everything survives a reload');

    ok(errs.length === 0, 'no errors: ' + (errs.join(' | ') || 'none'));
    await page.close();
  }

  /* ================================================== 4. real fights, phone landscape */
  console.log('\n[4] Real fights on a landscape phone, late water with gear');
  {
    const errs = [];
    const page = await newPage(browser, { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, errs);
    await page.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('toxicfishing.v1', JSON.stringify({
      lvl: 18, cred: 500, day: 3, loc: 'bay', unlocked: ['pond', 'city', 'ridge', 'basin', 'bay'], totalCatch: 300,
      seen: true, tutDone: true, gear: { rod: 2, line: 2, suit: 1 }, baits: { grub: 50 } })); });
    await page.reload({ waitUntil: 'networkidle0' }); await sleep(1000);
    await page.click('#start'); await sleep(1500);
    await page.screenshot({ path: SHOTS + '/4-landscape.png' });
    let landed = 0, tries = 0;
    for (; tries < 2; tries++) {
      await page.evaluate(() => { const b = document.querySelector('#action'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
      await sleep(700);
      await page.evaluate(() => document.querySelector('#action').dispatchEvent(new PointerEvent('pointerup', { bubbles: true })));
      await page.waitForFunction(() => R.mode === 'bite', { timeout: 120000, polling: 40 });
      await page.evaluate(() => { const b = document.querySelector('#action');
        b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); });
      await sleep(1200);
      if (tries === 0) await page.screenshot({ path: SHOTS + '/4-fight.png' });
      const r = await page.evaluate(AUTOPLAY);
      if (r === 'reveal') { landed++; await page.evaluate(() => UI.closeReveal()); }
    }
    ok(landed >= 1, `landed ${landed}/${tries} in Reactor Bay`);
    ok(errs.length === 0, 'no errors: ' + (errs.join(' | ') || 'none'));
    await page.close();
  }

  await browser.close();
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
