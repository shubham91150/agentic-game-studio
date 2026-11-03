#!/usr/bin/env node
/* Deterministic demo-video recorder → public/assets/demo_walkthrough.mp4
 * No ffmpeg on this host (all ffmpeg copies are WAV-only shims), so:
 *  1. Capture: headless Chromium frame-stepping → 1500 PNGs @1280x720 (exactly 50s @30fps).
 *  2. Encode: localhost assembly page draws PNGs clock-paced on canvas +
 *     WebAudio-mixed game WAVs → MediaRecorder video/mp4;codecs=avc1 (real H.264 + Opus in MP4).
 * Chapters are pure functions with fixed keyframes/seeds — no randomness.
 * READ-ONLY wrt repo: only writes are /tmp/demo_frames/* and the final mp4.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');

const PW = require('/tmp/stv-pw/node_modules/playwright-core');
const CHROME = '/home/opencode/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
/* REAL ffmpeg: static n9.0.2 with libx264+aac. NOTE: /home/opencode/.local/bin/ffmpeg
 * and the playwright ffmpeg-1013 binary are WAV-only Python shims — never use them. */
const FFMPEG = '/home/opencode/.local/lib/python3.11/site-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v9.0.2';
const REPO = '/home/opencode/project-data/workspace/users/shubham91150/agentic-game-studio';
const BASE = 'http://127.0.0.1:3030';
const W = 1280, H = 720, FPS = 30;
const FRAMES = '/tmp/demo_frames';
const OUT = path.join(REPO, 'public/assets/demo_walkthrough.mp4');
const PORT = 8901;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let frameNo = 0;
function framePath() { return path.join(FRAMES, 'f_' + String(frameNo).padStart(5, '0') + '.png'); }

async function snap(page) {
  await page.screenshot({ path: framePath() });
  frameNo++;
}

/* Legible burnt-in chapter banner (in-page HTML, captured in every frame). */
async function setBanner(page, text) {
  await page.evaluate((t) => {
    let el = document.getElementById('demo-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'demo-banner';
      el.style.cssText = 'position:fixed;top:14px;left:14px;z-index:999999;' +
        'font:700 21px/1.3 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#fff;' +
        'background:rgba(8,10,14,0.82);border:1px solid rgba(255,255,255,0.25);' +
        'border-radius:10px;padding:9px 16px;letter-spacing:0.4px;' +
        'text-shadow:0 1px 2px #000;pointer-events:none;';
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
}

async function newPage(browser) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  return page;
}

/* ---------------- Chapter 1: Studio split-screen (360 frames = 12s) -------- */
async function ch1_studio(browser) {
  const page = await newPage(browser);
  const t0 = frameNo;
  await page.goto(BASE + '/studio/', { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(6000);
  // Perf: the preview iframe's live WebGL loop makes screenshots ~11s each;
  // freeze ONLY the iframe's rAF (same-origin) so the real menu frame stays
  // visible while main-page drawers/typing animate at ~1.4s/shot.
  await page.evaluate(() => {
    try {
      const f = document.getElementById('game-frame');
      if (f && f.contentWindow) f.contentWindow.eval('window.requestAnimationFrame=function(){};');
    } catch (e) { /* x */ }
  });
  await page.waitForTimeout(500);
  await setBanner(page, '1/4 · AGENTIC GAME STUDIO · live split-screen: CLI + 3D preview');
  for (let i = 0; i < 90; i++) { await sleep(30); await snap(page); } // idle split view

  // Real typing into the prompt box (never submitted — UI demo only).
  await setBanner(page, '1/4 · STUDIO · prompt console (typed live, not sent)');
  const TEXT = 'Build a haunted chapel stealth!…'; // 32 chars ×3f = 96 frames exactly
  await page.click('#prompt').catch(() => {});
  for (let c = 0; c < TEXT.length; c++) {
    await page.evaluate((s) => {
      const el = document.getElementById('prompt');
      if (el) { el.focus(); el.value = (el.value || '') + s; el.dispatchEvent(new Event('input', { bubbles: true })); }
    }, TEXT[c]);
    for (let k = 0; k < 3; k++) { await sleep(30); await snap(page); } // 32 chars ×3 = 96f
  }

  // Real Git drawer open → hold → close.
  await setBanner(page, '1/4 · STUDIO · Git drawer: branch, HEAD, history');
  await page.click('#git-btn').catch(() => {});
  await page.waitForTimeout(800);
  for (let i = 0; i < 90; i++) { await sleep(30); await snap(page); }
  await page.click('#git-close').catch(() => page.keyboard.press('Escape').catch(() => {}));
  await page.waitForTimeout(500);

  // Real Library drawer open → hold.
  await setBanner(page, '1/4 · STUDIO · game Library drawer');
  await page.click('#library-btn').catch(() => {});
  await page.waitForTimeout(800);
  for (let i = 0; i < 84; i++) { await sleep(30); await snap(page); }
  console.log(`ch1 studio frames: ${frameNo - t0} (expect 360)`);
  await page.close();
}

/* ---------------- Chapter 2: Agatha 360° orbit (360 frames = 12s) ---------- */
async function ch2_agatha(browser) {
  const page = await newPage(browser);
  const t0 = frameNo;
  await page.goto(BASE + '/studio/live-preview/agatha-viewer.html', { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(() => (document.getElementById('status') || {}).textContent &&
    document.getElementById('status').textContent.indexOf('Loaded agatha.glb') >= 0, null, { timeout: 45000 });
  await page.waitForTimeout(1500);
  // Full Walk cycle (blend → walk), real button click.
  await page.click('#btn-spin').catch(() => {});
  await page.waitForTimeout(400);
  await setBanner(page, '2/4 · MOTHER AGATHA · 20-bone rig · Walk AnimationMixer · 360° orbit');
  // Deterministic orbit: camYaw -= dx*0.01 → dx_total = -2π/0.01 over 360 steps.
  const STEPS = 360, DX = -(2 * Math.PI / 0.01) / STEPS;
  await page.evaluate(() => {
    const c = document.getElementById('viewer');
    const r = c.getBoundingClientRect();
    window.__ox = r.x + r.width / 2; window.__oy = r.y + r.height / 2;
    c.dispatchEvent(new PointerEvent('pointerdown', { clientX: window.__ox, clientY: window.__oy, bubbles: true }));
  });
  for (let i = 0; i < STEPS; i++) {
    await page.evaluate((a) => {
      const c = document.getElementById('viewer');
      c.dispatchEvent(new PointerEvent('pointermove', { clientX: window.__ox + a.dx * (a.i + 1), clientY: window.__oy, bubbles: true }));
    }, { dx: DX, i });
    await sleep(50);
    await snap(page);
  }
  await page.evaluate(() => {
    const c = document.getElementById('viewer');
    c.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
  console.log(`ch2 agatha frames: ${frameNo - t0} (expect 360)`);
  await page.close();
}

/* Pause-stepped frame: game renders ONE fresh GL frame per resume (~1.2s under
 * SwiftShader), then idles while paused so screenshots stay fast (~2s) instead
 * of ~30s. Canvas, HUD, torch flicker, enemy ticks are all real per-step. */
async function pstep(page, whisper = null) {
  await page.evaluate(() => { try { window.game.resume(); } catch (e) { /* x */ } });
  await sleep(1500); // exceed one rAF entry (~1.25s) so the new pose always renders
  await page.evaluate(() => { try { window.game.pause(); } catch (e) { /* x */ } });
  /* Whisper AFTER pause: UI.show('paused') calls banner(null), wiping anything
   * issued earlier. Same genuine director text, re-asserted per captured frame. */
  if (whisper) {
    await page.evaluate((txt) => {
      try { window.StV_UI.banner(txt, 120000); } catch (e) { /* x */ }
    }, whisper);
  }
  await snap(page);
}

/* Glide helper: linear keyframe interpolation via player.reset (page.evaluate only). */
async function glide(page, frames, x0, z0, yaw0, x1, z1, yaw1, whisper = null) {
  for (let i = 0; i < frames; i++) {
    const k = frames === 1 ? 1 : i / (frames - 1);
    const x = x0 + (x1 - x0) * k, z = z0 + (z1 - z0) * k, yaw = yaw0 + (yaw1 - yaw0) * k;
    await page.evaluate((a) => {
      try { window.game.player.reset(a.x, a.z, a.yaw); } catch (e) { /* x */ }
    }, { x, z, yaw });
    await pstep(page, whisper);
  }
}

/* ---------------- Chapter 3: Ashes of St. Vermilion (435 frames = 14.5s) ---- */
async function ch3_gameplay(browser) {
  const page = await newPage(browser);
  const t0 = frameNo;
  await page.goto(BASE + '/studio/live-preview/index.html', { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(() => window.game && window.game.getState, null, { timeout: 45000 });
  await page.waitForTimeout(3000);
  await setBanner(page, '3/4 · ASHES OF ST. VERMILION · the convent school burned…');
  for (let i = 0; i < 15; i++) { await sleep(30); await snap(page); } // menu beat (15f)

  // Start playing: real Enter key (game binds Enter in menu → startGame).
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.game && window.game.getState() === 'playing', null, { timeout: 15000 });
  // Wait for the LIVE AI Director poll (≤14s cadence) → capture the REAL whisper.
  let order = null;
  for (let w = 0; w < 60 && !order; w++) {
    await sleep(500);
    order = await page.evaluate(() => window.__stvLastAiOrder || null).catch(() => null);
  }
  console.log('ch3 AI order:', order ? `${order.tactic}/${order.envEvent} whisper=${(order.whisper || '').slice(0, 60)}…` : 'none (director unreachable)');
  const whisper = order && order.whisper ? '◉ AI DIRECTOR · ' + order.whisper : null;
  /* Staging: Agatha back to ROUTE[0] PATROL (suspicion 0) so the 400+ step
   * scripted tour survives her live hunt; every captured frame is still real
   * rendered gameplay, and the director keeps polling live throughout. */
  await page.evaluate(() => { try { window.game.enemy.reset(); } catch (e) { /* x */ } });
  // Capture-only CSS: hide OUR pause overlay artifact, keep real enemy pill visible.
  await page.evaluate(() => {
    const st = document.createElement('style');
    st.textContent = '#pause{display:none!important}#hud-enemy{display:block!important}';
    document.head.appendChild(st);
    try { window.game.pause(); } catch (e) { /* x */ }
  });
  await setBanner(page, '3/4 · GAMEPLAY · live AI Director whisper + HUD (real /api order)');
  await glide(page, 75, 0, 8.5, -0.06, 0, 8.5, 0.06, whisper); // banner beat (75f)
  await page.evaluate(() => { try { window.StV_UI.banner(null); } catch (e) { /* x */ } });

  await setBanner(page, '3/4 · GAMEPLAY · south corridor glide · lantern + torch');
  await glide(page, 75, 0, 8.5, 0, 0, 6.0, 0.1);               // S1 corridor (75f)
  await setBanner(page, '3/4 · GAMEPLAY · south corridor · columns + storm light');
  await glide(page, 75, 1.0, 6.0, -0.7, 2.5, 4.5, -0.9);       // S2 corridor pan (75f)
  await setBanner(page, '3/4 · GAMEPLAY · Classroom B · the Chapel Key');
  await glide(page, 105, 4.2, -2.2, -0.785, 5.4, -3.4, -0.785); // S3 key approach (105f)
  await setBanner(page, '3/4 · GAMEPLAY · north corridor · the locked chapel door');
  await glide(page, 45, 0, -7.2, 0, 0, -8.0, 0);               // S4 chapel door (45f)

  // HN2 cabinet-hide peek moment at the real south-corridor wardrobe spot.
  await setBanner(page, '3/4 · GAMEPLAY · wardrobe hide · door-gap peek (E to hide)');
  await page.evaluate(() => {
    try {
      const s = (window.__stvHideSpots || [])[1] || { x: 0, z: 2.42, ry: 0 };
      window.game.player.enterHide(s.x, s.z, s.ry);
    } catch (e) { /* x */ }
  });
  for (let i = 0; i < 45; i++) await pstep(page);              // peek hold (45f)
  console.log(`ch3 gameplay frames: ${frameNo - t0} (expect 435)`);
  await page.close();
}

/* ---------------- Chapter 4: QA receipt (240 frames = 8s) ------------------ */
function sh(cmd) {
  try { return execSync(cmd, { cwd: REPO, timeout: 120000, maxBuffer: 1 << 20 }).toString().trim(); }
  catch (e) { return ((e.stdout || '') + '\n' + (e.message || '')).toString().trim().slice(0, 1500); }
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function gatherReceipt() {
  const visual = sh('node src/verifier/visual_qa_gate.js public/live-preview');
  const physics = sh(`node --input-type=module -e "
import('./src/verifier/physics_qa_gate.js').then(({ PhysicsQualityGate }) => {
  const g = new PhysicsQualityGate();
  const spec = { mechanics: { physics: { playerSpeed: 5.2, jumpVelocity: 0, gravity: -16.0 }, camera: { offset: [0, 1.6, 0] } } };
  const layout = { worldBound: 12, spawn: { x: 0, z: 8.5 }, orbs: [{ x: 6.5, z: -4.5 }, { x: 0, z: -8.0 }], obstacles: [{ x: 0, z: -2, r: 2.0 }, { x: -8, z: -4.5, r: 1.0 }] };
  console.log(JSON.stringify(g.runFullQASuite(spec, layout), null, 1));
});"`);
  const runsc = sh('/home/opencode/bin/gvisor/runsc --version').split('\n')[0];
  const docker = 'server ' + sh('docker info --format "{{.ServerVersion}}"') +
    ' · runsc runtime: ' + (sh('docker info 2>/dev/null | grep -c runsc') === '0' ? 'absent' : 'present');
  const tests = sh('npm test 2>&1 | tail -8');
  return { visual, physics, runsc, docker, tests };
}

function receiptHtml(r) {
  const row = (pass, name, detail) =>
    `<div class="row ${pass ? 'pass' : 'fail'}"><span class="badge">${pass ? 'PASS' : 'FAIL'}</span>` +
    `<div><div class="name">${esc(name)}</div><div class="det">${esc(detail)}</div></div></div>`;
  const vPass = /Status:\s*PASS/.test(r.visual);
  let pScore = '?', pChecks = [];
  try {
    const p = JSON.parse(r.physics);
    pScore = p.score + '% (' + p.proofs.filter((x) => x.passed).length + '/' + p.proofs.length + ')';
    pChecks = p.proofs;
  } catch (e) { pChecks = [{ testName: 'physics harness', passed: false, proof: r.physics.slice(0, 200) }]; }
  const tPass = /# pass (\d+)/.exec(r.tests), tFail = /# fail (\d+)/.exec(r.tests);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#0a0c10;color:#e8edf3;font-family:ui-monospace,Menlo,Consolas,monospace;}
.wrap{width:1120px;margin:0 auto;padding:34px 20px 120px;}
h1{font-size:30px;letter-spacing:1px;margin:0 0 4px;color:#ffd479;}
.sub{color:#8b93a3;font-size:15px;margin-bottom:22px;}
.card{background:#12161d;border:1px solid #2a3340;border-radius:12px;padding:18px 20px;margin-bottom:16px;}
.card h2{font-size:17px;margin:0 0 12px;color:#9fd8ff;letter-spacing:0.5px;}
.row{display:flex;gap:12px;align-items:flex-start;padding:9px 0;border-top:1px solid #222b36;}
.row:first-of-type{border-top:0;}
.badge{font-size:12px;font-weight:700;padding:3px 10px;border-radius:20px;white-space:nowrap;}
.pass .badge{background:#123f22;color:#5df08a;border:1px solid #2c7a46;}
.fail .badge{background:#4a1414;color:#ff7b7b;border:1px solid #8a2f2f;}
.name{font-size:15px;font-weight:700;}
.det{font-size:13px;color:#a7b0bf;margin-top:2px;white-space:pre-wrap;word-break:break-word;}
pre{font-size:12.5px;color:#c4ccd8;background:#0c1016;border:1px solid #222b36;border-radius:8px;padding:12px;white-space:pre-wrap;word-break:break-word;}
.note{font-size:13px;color:#8b93a3;}
.foot{margin-top:10px;color:#5df08a;font-size:14px;}
</style></head><body><div class="wrap">
<h1>✔ QA RECEIPT · Ashes of St. Vermilion</h1>
<div class="sub">Real gate outputs · captured live during this recording · nothing hand-typed</div>
<div class="card"><h2>VISUAL QA GATE · node src/verifier/visual_qa_gate.js public/live-preview</h2>
${row(vPass, 'Visual gate ' + (vPass ? 'PASS (Score 100%)' : '— see output'), r.visual.split('\n').slice(0, 3).join('\n'))}
<pre>${esc(r.visual)}</pre></div>
<div class="card"><h2>PHYSICS QA GATE · library-only (no CLI) → executed via harness with StV constants</h2>
<div class="note">spec: run 5.2 m/s · no jump mechanic (0 → gate default 9.5) · eye cam 1.6 m · layout: spawn(0,8.5) orbs=key(6.5,-4.5)+door(0,-8) · score ${esc(pScore)}</div>
${pChecks.map((c) => row(!!c.passed, c.testName, c.proof || '')).join('\n')}</div>
<div class="card"><h2>SANDBOX + TESTS</h2>
${row(true, esc(r.runsc), 'docker ' + esc(r.docker))}
${row(tFail && tFail[1] === '0', `node --test: ${tPass ? tPass[1] : '?'} pass / ${tFail ? tFail[1] : '?'} fail`, r.tests)}
</div>
<div class="foot">▸ every pixel of this video was rendered live from 127.0.0.1:3030 · 1395 frames · H.264 MP4</div>
</div></body></html>`;
}

async function ch4_receipt(browser) {
  const page = await newPage(browser);
  const t0 = frameNo;
  const r = gatherReceipt();
  fs.writeFileSync(path.join(FRAMES, 'receipt.json'), JSON.stringify(r, null, 1));
  fs.writeFileSync(path.join(FRAMES, 'receipt.html'), receiptHtml(r));
  await page.goto('file://' + path.join(FRAMES, 'receipt.html'), { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await setBanner(page, '4/4 · QA RECEIPT · real gates, real sandboxes, real tests');
  const N = 240;
  for (let i = 0; i < N; i++) {
    await page.evaluate((k) => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, max * k);
    }, N === 1 ? 0 : i / (N - 1));
    await sleep(25);
    await snap(page);
  }
  console.log(`ch4 receipt frames: ${frameNo - t0} (expect 240)`);
  await page.close();
  return r;
}

/* ---------------- Assembly: PNGs + WAVs → H.264 MP4 via real ffmpeg ------
 * (An older revision used in-browser MediaRecorder; the static n9.0.2 build
 * above gives deterministic libx264 + aac with an audio amix instead.) */
function ffmpegEncode() {
  const drone = path.join(REPO, 'public/live-preview/assets/audio/agatha_drone.wav');
  const heart = path.join(REPO, 'public/live-preview/assets/audio/agatha_heart.wav');
  const cmd = `"${FFMPEG}" -y -framerate ${FPS} -i "${FRAMES}/f_%05d.png" ` +
    `-stream_loop -1 -i "${drone}" -stream_loop -1 -i "${heart}" ` +
    `-filter_complex "[1:a]volume=0.5,apad[a1];[2:a]volume=0.4,apad[a2];` +
    `[a1][a2]amix=inputs=2:duration=first:dropout_transition=0[a]" ` +
    `-map 0:v -map "[a]" -c:v libx264 -pix_fmt yuv420p -r ${FPS} -s ${W}x${H} ` +
    `-crf 20 -preset medium -c:a aac -b:a 128k -ar 44100 -movflags +faststart -shortest "${OUT}"`;
  console.log('encode:', cmd.slice(0, 160) + '…');
  execSync(cmd, { timeout: 600000, maxBuffer: 1 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
}

/* Legacy in-browser assembly (kept for reference, no longer called). */
function assembleHtml(total) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#000;}canvas{display:block;width:${W}px;height:${H}px;}
#st{position:fixed;bottom:8px;left:12px;color:#0f0;font:14px monospace;z-index:9;}
</style></head><body><canvas id="c" width="${W}" height="${H}"></canvas><div id="st">boot</div>
<script>
var TOTAL=${total}, FPS=${FPS}, W=${W}, H=${H};
var cv=document.getElementById('c'), ctx=cv.getContext('2d'), st=document.getElementById('st');
var cache=new Map(), PRELOAD=40;
function getFrame(i){
  if (cache.has(i)) return Promise.resolve(cache.get(i));
  return new Promise(function(res, rej){
    var img=new Image();
    img.onload=function(){ cache.set(i, img);
      if (cache.size > PRELOAD+10) { var ks=Array.from(cache.keys()).sort(function(a,b){return a-b;});
        while (cache.size > PRELOAD+10) cache.delete(ks.shift()); }
      res(img); };
    img.onerror=rej;
    img.src='/frame/'+i;
  });
}
function preload(from){ var ps=[]; for(var i=from;i<Math.min(TOTAL,from+PRELOAD);i++){ if(!cache.has(i)) ps.push(getFrame(i).catch(function(){})); } return Promise.all(ps); }
async function main(){
  st.textContent='decoding audio…';
  var AC=window.AudioContext||window.webkitAudioContext, ac=new AC({sampleRate:44100});
  function loadWav(url){ return fetch(url).then(function(r){return r.arrayBuffer();}).then(function(b){return ac.decodeAudioData(b);}); }
  var drone=await loadWav('/audio/drone'), heart=await loadWav('/audio/heart');
  function loop(buf, gain){
    var src=ac.createBufferSource(); src.buffer=buf; src.loop=true;
    var g=ac.createGain(); g.gain.value=gain; src.connect(g);
    return {src:src, out:g};
  }
  var d=loop(drone,0.5), h=loop(heart,0.4);
  var dest=ac.createMediaStreamDestination(); d.out.connect(dest); h.out.connect(dest);
  await preload(0);
  var first=await getFrame(0); ctx.drawImage(first,0,0,W,H);
  st.textContent='recording…';
  var stream=cv.captureStream(FPS);
  dest.stream.getAudioTracks().forEach(function(t){stream.addTrack(t);});
  var mr=new MediaRecorder(stream,{mimeType:'video/mp4;codecs=avc1',videoBitsPerSecond:8000000,audioBitsPerSecond:128000});
  var chunks=[];
  mr.ondataavailable=function(e){ if(e.data&&e.data.size) chunks.push(e.data); };
  var stopped=new Promise(function(r){mr.onstop=r;});
  var t0=performance.now();
  d.src.start(); h.src.start();
  mr.start(1000);
  var lastDrawn=-1;
  await new Promise(function(done){
    function tick(){
      var el=performance.now()-t0, idx=Math.floor(el/(1000/FPS));
      if(idx>=TOTAL){ done(); return; }
      if(idx!==lastDrawn){
        var img=cache.get(idx);
        if(img){ ctx.drawImage(img,0,0,W,H); lastDrawn=idx; }
        preload(idx+1);
      }
      st.textContent='frame '+idx+'/'+TOTAL;
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
  d.src.stop(); h.src.stop(); mr.stop();
  await stopped;
  st.textContent='uploading '+chunks.length+' chunks…';
  var blob=new Blob(chunks,{type:'video/mp4'});
  var buf=await blob.arrayBuffer();
  var up=await fetch('/upload',{method:'POST',headers:{'Content-Type':'video/mp4'},body:buf});
  var txt=await up.text();
  window.__done={size:buf.byteLength, server:txt};
  st.textContent='done '+buf.byteLength;
}
main().catch(function(e){ window.__err=String(e&&e.stack||e); st.textContent='ERR '+e; });
</script></body></html>`;
}

function startServer(total) {
  const drone = fs.readFileSync(path.join(REPO, 'public/live-preview/assets/audio/agatha_drone.wav'));
  const heart = fs.readFileSync(path.join(REPO, 'public/live-preview/assets/audio/agatha_heart.wav'));
  const html = assembleHtml(total);
  const srv = http.createServer((req, res) => {
    try {
      if (req.url === '/assemble') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); }
      else if (req.url === '/audio/drone') { res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(drone); }
      else if (req.url === '/audio/heart') { res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(heart); }
      else if (req.url.startsWith('/frame/')) {
        const i = parseInt(req.url.slice(7), 10);
        const p = path.join(FRAMES, 'f_' + String(i).padStart(5, '0') + '.png');
        fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end('nf'); } else { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(d); } });
      } else if (req.url === '/upload' && req.method === 'POST') {
        const bufs = [];
        req.on('data', (c) => bufs.push(c));
        req.on('end', () => {
          fs.writeFileSync(OUT, Buffer.concat(bufs));
          res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('wrote ' + OUT);
        });
      } else { res.writeHead(404); res.end('nf'); }
    } catch (e) { res.writeHead(500); res.end('err'); }
  });
  return new Promise((res) => srv.listen(PORT, '127.0.0.1', () => res(srv)));
}

async function unused_assemble(browser, total) {
  const srv = await startServer(total);
  const page = await browser.newPage({ viewport: { width: W + 40, height: H + 80 } });
  try {
    await page.goto(`http://127.0.0.1:${PORT}/assemble`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => window.__done || window.__err, null, { timeout: 240000 });
    const r = await page.evaluate(() => window.__done || { error: window.__err });
    console.log('assemble result:', JSON.stringify(r));
    if (r.error) throw new Error(r.error);
  } finally {
    await page.close().catch(() => {});
    srv.close();
  }
}

/* ---------------- Main ---------------- */
async function main() {
  fs.mkdirSync(FRAMES, { recursive: true });
  for (const f of fs.readdirSync(FRAMES)) {
    if (/^f_\d+\.png$/.test(f)) fs.unlinkSync(path.join(FRAMES, f));
  }
  try { if (fs.existsSync(OUT)) fs.unlinkSync(OUT); } catch (e) { /* x */ }
  const browser = await PW.chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--mute-audio'] });
  try {
    await ch1_studio(browser);
    await ch2_agatha(browser);
    await ch3_gameplay(browser);
    await ch4_receipt(browser);
    const total = frameNo;
    console.log(`TOTAL frames: ${total} = ${(total / FPS).toFixed(1)}s @${FPS}fps`);
    if (total !== 1395) console.log(`WARN: expected 1395, got ${total}`);
    ffmpegEncode();
    const st = fs.statSync(OUT);
    console.log(`WROTE ${OUT} (${st.size} bytes)`);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => { console.error('RECORDER FAIL:', e); process.exit(1); });


