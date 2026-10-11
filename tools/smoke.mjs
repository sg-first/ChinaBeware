// 冒烟测试：用本机 Edge 打开游戏，检查控制台错误、404、驾驶物理与警车 AI
import { chromium } from 'playwright-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://localhost:8734/index.html';

const browser = await chromium.launch({
  executablePath: EDGE,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
// 小窗口：软件渲染下提高帧率，让物理步进接近实时
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });

const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0, 160)}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => { if (r.status() >= 400) logs.push(`[${r.status()}] ${r.url()}`); });
page.on('request', (r) => logs.push(`[req] ${r.url().replace('http://localhost:8734', '')}`));

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => {
  const b = document.getElementById('startBtn');
  return b && !b.disabled;
}, null, { timeout: 120000 }).catch(() => logs.push('[warn] 模型加载超时'));
console.log('startBtn:', await page.textContent('#startBtn'));

await page.click('#startBtn');
await page.waitForTimeout(1500);
const feedback = await page.evaluate(() => {
  const g = window.__GAME;
  const fwd = g.player.forward;
  return {
    policeCount: g.police.units.length,
    radarBlips: document.querySelectorAll('#radarDots .radarDot').length,
    roles: g.police.units.map(u => u.role),
    roadblockAhead: g.police.units.some(u => u.role === 'roadblock' &&
      (u.car.pos.x - g.player.pos.x) * fwd.x + (u.car.pos.z - g.player.pos.z) * fwd.z > 0),
    distances: g.police.units.map(u => Math.round(u.car.pos.distanceTo(g.player.pos))),
    minPoliceGap: Math.round(Math.min(...g.police.units.flatMap((u, i) => g.police.units.slice(i + 1).map(v => u.car.pos.distanceTo(v.car.pos))))),
    wanted: document.querySelector('#wantedText')?.textContent,
  };
});
console.log('追捕反馈:', JSON.stringify(feedback));
const popupStyle = await page.evaluate(() => {
  window.__GAME.player.onCollision(20);
  const msg = document.getElementById('bigMsg');
  const title = document.getElementById('bigMsgText');
  const kicker = document.getElementById('bigMsgKicker');
  const flash = document.getElementById('damageFlash');
  return {
    impactClass: msg.classList.contains('impact'),
    impactFlash: flash.classList.contains('impact') && flash.classList.contains('hit'),
    impactTop: getComputedStyle(msg).top,
    impactTopPercent: +(parseFloat(getComputedStyle(msg).top) / innerHeight * 100).toFixed(1),
    kicker: kicker.textContent,
    title: title.textContent,
    titleSize: getComputedStyle(title).fontSize,
    titleFont: getComputedStyle(title).fontFamily,
    titleAnimation: getComputedStyle(title).animationName,
  };
});
console.log('飘字/撞击样式:', JSON.stringify(popupStyle));
const ramTest = await page.evaluate(() => {
  const g = window.__GAME;
  const unit = g.police.units[0];
  const fwd = g.player.forward.clone();
  const right = g.player.right.clone();
  const before = unit.health;
  // 正后方同向追尾（无效方向）不应伤警车
  g.player.vel.copy(fwd).multiplyScalar(30);
  unit.car.pos.copy(g.player.pos).addScaledVector(fwd, -3);
  unit.car.vel.copy(fwd).multiplyScalar(30);
  unit.ramCooldown = 0;
  g.police.update(0, g.player);
  const rearChaseHealth = unit.health;
  // 侧擦撞击应有效，无需正面迎撞；重复 5 次达到摧毁阈值
  for (let i = 0; i < 5 && !unit.disabled; i++) {
    g.player.pos.copy(g.world.getSpawnPoint());
    g.player.vel.copy(fwd).multiplyScalar(30);
    unit.car.pos.copy(g.player.pos).addScaledVector(right, 3);
    unit.car.vel.set(0, 0, 0);
    unit.ramCooldown = 0;
    g.police.update(0, g.player);
  }
  g.police.consumeEvents();
  const result = {
    before,
    rearChaseHealth,
    after: unit.health,
    disabled: unit.disabled,
    wreckVisible: g.police.wrecks.includes(unit),
    wreckFx: !!unit.wreckFx && {
      smokeParticles: unit.wreckFx.smoke.geometry.attributes.position.count,
      sparks: unit.wreckFx.sparks.geometry.attributes.position.count,
      wreckLabel: unit.wreckFx.label.material.map !== null,
      flameGlow: unit.wreckFx.glow.intensity > 0,
      bodyTilt: Math.abs(unit.visual.body.rotation.z) > 0.4,
    },
    wreckLife: unit.wreckTimer,
    activePolice: g.police.units.length,
    playerHealthAfterRam: Math.round(g.player.health),
    events: g.police.consumeEvents().map(e => e.type),
  };
  g.player.pos.copy(g.world.getSpawnPoint());
  g.player.heading = g.world.getSpawnPoint().heading;
  g.player.vel.set(0, 0, 0);
  g.player.health = 100;
  g.police.reset(g.player, 3);
  return result;
});
console.log('撞击警车测试:', JSON.stringify(ramTest));
await page.evaluate(() => {
  window.__GAME.S.policeDestroyed = 1;
  window.__GAME.showTakedown(1400);
});
await page.waitForTimeout(400);
const takedownFeedback = await page.evaluate(() => {
  const el = document.getElementById('takedown');
  const title = el.querySelector('.tdTitle');
  return {
    visible: el.classList.contains('show'),
    animation: `${getComputedStyle(el).animationName} ${getComputedStyle(el).animationPlayState} ${getComputedStyle(el).animationDuration}`,
    titleAnimation: getComputedStyle(title).animationName,
    animState: el.getAnimations()[0]?.playState,
    // 软件渲染下动画时间轴几乎不推进，这里只断言运行状态，实际观感需在真实浏览器查看
    title: title.textContent,
    titleAnimation: getComputedStyle(title).animationName,
    score: el.querySelector('.tdScore').textContent,
    count: el.querySelector('.tdCount').textContent,
    slowMotion: +window.__GAME.timeScale.toFixed(2),
  };
});
console.log('撞毁警车通报:', JSON.stringify(takedownFeedback));
// 慢镜是否真正生效：对比同等帧数内的位移
// 用“真实时间 / 模拟推进时间”的比值直接判断慢镜是否生效，避免帧率波动干扰
const slowMoProbe = await page.evaluate(async () => {
  const g = window.__GAME;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const sample = async () => {
    const a = g.clocks;
    await sleep(600);
    const b = g.clocks;
    return { real: b.real - a.real, sim: b.sim - a.sim };
  };
  // 先等上一轮慢镜完全恢复，再取基准
  while (g.timeScale < 1) await sleep(120);
  const normal = await sample();
  g.S.policeDestroyed = 1;
  g.showTakedown(1400);
  const scale = g.timeScale;
  const slow = await sample();
  await sleep(700);
  return {
    timeScaleAtTrigger: +scale.toFixed(2),
    timeScaleAfter: +g.timeScale.toFixed(2),
    holdLeft: +g.timeScaleHold.toFixed(2),
    normalSimPerReal: +(normal.sim / (normal.real || 1)).toFixed(2),
    slowSimPerReal: +(slow.sim / (slow.real || 1)).toFixed(2),
    vignette: +getComputedStyle(document.getElementById('slowMo')).opacity,
  };
});
console.log('慢镜效果:', JSON.stringify(slowMoProbe));
await page.screenshot({ path: 'e:/ChinaBeware/tools/shot_takedown.png' });
await page.evaluate(() => window.__GAME.police.reset(window.__GAME.player, 3));
await page.waitForTimeout(150);
console.log('受损反馈:', await page.evaluate(() => ({
  health: Math.round(window.__GAME.player.health),
  flash: document.getElementById('damageFlash').classList.contains('hit'),
})));
await page.screenshot({ path: 'e:/ChinaBeware/tools/shot_start.png' });

/* --- 加速测试：按住 W 6 秒，采样速度 --- */
const p0 = await page.evaluate(() => ({ ...window.__GAME.player.pos, h: window.__GAME.player.heading }));
await page.keyboard.down('w');
await page.waitForTimeout(6000);
const samples = await page.evaluate(() => {
  const g = window.__GAME;
  return { speed: g.player.speedKmh, pos: { x: g.player.pos.x, z: g.player.pos.z }, h: g.player.heading };
});
await page.keyboard.up('w');
console.log('油门 6s 后速度:', Math.round(samples.speed), 'km/h');
const dx = samples.pos.x - p0.x, dz = samples.pos.z - p0.z;
const moved = Math.hypot(dx, dz);
const dot = (Math.sin(p0.h) * dx + Math.cos(p0.h) * dz) / (moved || 1);
console.log(`位移 ${moved.toFixed(1)}m，与车头方向一致度 ${dot.toFixed(2)}（1=正向行驶，负值说明车头朝向反了）`);

/* --- 手刹漂移 --- */
await page.keyboard.down('a');
await page.keyboard.down(' ');
await page.waitForTimeout(2500);
const drift = await page.evaluate(() => {
  const g = window.__GAME;
  return { drifting: g.player.drifting, slip: +g.player.slipAmount.toFixed(2), speed: g.player.speedKmh };
});
console.log('漂移状态:', JSON.stringify(drift));
await page.keyboard.up(' ');
await page.keyboard.up('a');

/* --- 警车追逐 --- */
const pol = await page.evaluate(() => {
  const g = window.__GAME;
  return {
    count: g.police.units.length,
    nearest: Math.round(g.nearest),
    speeds: g.police.units.map(u => Math.round(u.car.speedKmh)),
  };
});
console.log('警车:', JSON.stringify(pol));

/* --- 被抓获 → 结束界面 → 重开 --- */
await page.evaluate(() => {
  const g = window.__GAME;
  const u = g.police.units[0];
  u.car.pos.set(g.player.pos.x + 6, g.player.pos.y, g.player.pos.z);
  u.car.vel.set(0, 0, 0);
  g.player.vel.set(0, 0, 0);
  g.S.bustTimer = 0.95;
});
await page.waitForTimeout(1500);
const busted = await page.isVisible('#endScreen');
console.log('被抓获界面:', busted, '|', await page.textContent('#endTitle'));
if (busted) {
  await page.click('#restartBtn');
  await page.waitForTimeout(1200);
  console.log('重开后 running:', await page.evaluate(() => window.__GAME.S.running),
    '| 警车数:', await page.evaluate(() => window.__GAME.police.units.length));
}

/* --- 贴地倾斜：传送到陡坡测量车身倾角 --- */
await page.evaluate(() => {
  const g = window.__GAME;
  g.player.pos.set(1010, 0, 0);   // 地图边缘山体，坡度大
  g.player.vel.set(2, 0, 0);
});
await page.waitForTimeout(2000);
const tilt = await page.evaluate(() => {
  const g = window.__GAME;
  const q = g.playerVisual.group.quaternion;
  // (0,1,0) 旋转后与铅垂的夹角
  const vx = 2 * (q.x * q.y + q.w * q.z);
  const vy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const ang = Math.acos(Math.max(-1, Math.min(1, vy))) * 180 / Math.PI;
  const terrainN = g.world.normal(g.player.pos.x, g.player.pos.z);
  const terrainAng = Math.acos(Math.max(-1, Math.min(1, terrainN.y))) * 180 / Math.PI;
  return { bodyTilt: +ang.toFixed(1), terrainTilt: +terrainAng.toFixed(1) };
});
console.log('贴地倾斜: 车身', tilt.bodyTilt, '° / 地形', tilt.terrainTilt, '°');

/* --- 开放世界分块流送 + 道路网 + 警车刷新 --- */
const streaming = await page.evaluate(() => {
  const g = window.__GAME;
  const oldKeys = [...g.world.chunks.keys()];
  g.player.pos.set(1820, 0, -1460);
  g.world.updateStreaming(g.player.pos.x, g.player.pos.z);
  const road = g.world.nearestRoadPoint(g.player.pos.x + 47, g.player.pos.z + 33, 0.4);
  const onRoad = g.world.onRoad(road.x, road.z);
  g.player.pos.set(road.x, g.world.height(road.x, road.z), road.z);
  g.player.heading = road.heading;
  g.police.reset(g.player, 2);
  const policeOnRoad = g.police.units.every(u => g.world.onRoad(u.car.pos.x, u.car.pos.z));
  g.police.escaped(g.player, 3);
  const removedDuringCooldown = g.police.units.length === 0;
  g.police.update(6.1, g.player);
  return {
    oldChunks: oldKeys.length,
    loadedChunks: g.world.chunks.size,
    movedCenter: g.world.centerChunk,
    roadSnapDistance: +road.distance.toFixed(1),
    roadSnapWorks: onRoad,
    finiteHeight: Number.isFinite(g.world.height(road.x, road.z)),
    policeSpawnOnRoad: policeOnRoad,
    cooldownClearsOld: removedDuringCooldown,
    refreshedUnits: g.police.units.length,
    refreshedOnRoad: g.police.units.every(u => g.world.onRoad(u.car.pos.x, u.car.pos.z)),
  };
});
console.log('开放世界/路网/警车刷新:', JSON.stringify(streaming));

/* --- 第一人称切换 & 帧率 --- */
await page.keyboard.press('c');
await page.waitForTimeout(500);
await page.screenshot({ path: 'e:/ChinaBeware/tools/shot_fp.png' });
await page.keyboard.press('c');

const fps = await page.evaluate(() => new Promise((res) => {
  let n = 0; const t0 = performance.now();
  const tick = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else res(Math.round(n / ((performance.now() - t0) / 1000))); };
  requestAnimationFrame(tick);
}));
console.log('fps(软件渲染，仅供参考):', fps);

/* --- 渲染统计 & 镜头 --- */
const render = await page.evaluate(() => {
  const g = window.__GAME;
  const r = g.renderer.info.render;
  const camDist = Math.hypot(g.camera.position.x - g.player.pos.x, g.camera.position.z - g.player.pos.z);
  return {
    calls: r.calls, triangles: r.triangles,
    camDistToCar: +camDist.toFixed(1),
    camHeightAboveCar: +(g.camera.position.y - g.player.pos.y).toFixed(1),
    fov: +g.camera.fov.toFixed(0),
  };
});
console.log('渲染:', JSON.stringify(render));

/* --- 渲染统计 --- */
const info = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  return { w: c.width, h: c.height };
});
console.log('canvas:', JSON.stringify(info));

console.log('--- 控制台 ---');
console.log(logs.slice(0, 25).join('\n') || '(无错误)');

await browser.close();
