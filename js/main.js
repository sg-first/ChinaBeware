// main.js —— 游戏入口：场景、玩家、镜头、特效、HUD、游戏流程
import * as THREE from 'three';
import { World } from './world.js';
import { Vehicle, preloadCarModel, buildCarVisual, updateCarVisual } from './car.js';
import { PoliceManager, syncVisual } from './police.js';
import { GameAudio } from './audio.js';
import { Input } from './input.js';

/* ============ 车辆模型配置 ============
 * 如果加载后车辆朝向不对（倒着开/横着开），
 * 调整 yawFix：每次 +90° = Math.PI/2 */
const PLAYER_MODEL = 'assets/car_santana.fbx';
const CAR_CFG = {
  player:   { url: PLAYER_MODEL, length: 4.6, yawFix: 0, headlights: true },
  police:   { length: 4.8, yawFix: 0 },
};

/* ============ 基础渲染 ============ */
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.7;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.3, 1500);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ============ 世界 ============ */
const world = new World(scene);

/* ============ 玩家 ============ */
const player = new Vehicle(world);
let collisionFeedbackCooldown = 0, damageCooldown = 0;
player.onCollision = (impact, source = 'environment') => {
  camShake = Math.min(0.58, impact * 0.016);
  if (damageCooldown > 0) return;
  const policeHit = source === 'police';
  const threshold = policeHit ? 7 : 5;
  const scale = policeHit ? 0.12 : 0.3;
  const damage = Math.min(policeHit ? 3.5 : 8, Math.max(0, (impact - threshold) * scale));
  if (damage <= 0) return;

  player.health = Math.max(0, player.health - damage);
  damageCooldown = policeHit ? 0.85 : 1.0;
  audio.crash(impact);
  const flash = document.getElementById('damageFlash');
  flash.classList.remove('hit', 'impact');
  void flash.offsetWidth;
  flash.classList.add('hit', 'impact');
  if (collisionFeedbackCooldown <= 0) {
    showMsg(player.health < 30 ? '车辆严重受损' : '车体受撞', 'impact', 1050, '碰撞警报 · IMPACT');
    collisionFeedbackCooldown = 0.9;
  }
};
let playerVisual = null;

/* ============ 警车 ============ */
const police = new PoliceManager(scene, world);

/* ============ 音效 / 输入 ============ */
const audio = new GameAudio();
const input = new Input();

/* ============ 预加载车模，完成后开始渲染 ============ */
const ALL_MODELS = [
  'assets/car_santana.fbx',
  'assets/police1.fbx',
  'assets/police2.fbx',
];
const startBtn = document.getElementById('startBtn');
startBtn.disabled = true;
startBtn.textContent = '模型加载中…';

Promise.all(ALL_MODELS.map(preloadCarModel)).then(() => {
  playerVisual = buildCarVisual(CAR_CFG.player.url, CAR_CFG.player);
  scene.add(playerVisual.group);
  startBtn.disabled = false;
  startBtn.textContent = '点火出发';
}).catch((err) => {
  console.error('车模加载失败，使用占位方块', err);
  playerVisual = buildCarVisual(CAR_CFG.player.url, CAR_CFG.player);
  scene.add(playerVisual.group);
  startBtn.disabled = false;
  startBtn.textContent = '点火出发（模型加载失败）';
});

/* ============ 特效：车辙 + 雪雾喷溅 ============ */
// 车辙（对象池）
const MARK_POOL = 700;
const markGeo = new THREE.PlaneGeometry(0.32, 1.0);
markGeo.rotateX(-Math.PI / 2);
const marks = [];
for (let i = 0; i < MARK_POOL; i++) {
  const mat = new THREE.MeshBasicMaterial({
    color: 0x555a70, transparent: true, opacity: 0, depthWrite: false,
  });
  const m = new THREE.Mesh(markGeo, mat);
  m.visible = false;
  scene.add(m);
  marks.push({ mesh: m, life: 0 });
}
let markIdx = 0, markDist = 0;
const wheelOffsets = [
  { x: -0.78, z: 1.35, r: false }, { x: 0.78, z: 1.35, r: false },
  { x: -0.78, z: -1.35, r: true }, { x: 0.78, z: -1.35, r: true },
];
function spawnTireMarks(dt) {
  const slipping = player.drifting || (player.brake > 0 && player.speedKmh > 30) ||
                   (player.handbrake && player.speedKmh > 10);
  if (!slipping) return;
  markDist += player.vel.length() * dt;
  if (markDist < 0.55) return;
  markDist = 0;
  const fwd = player.forward, rgt = player.right;
  for (const w of wheelOffsets) {
    if (!w.r) continue;    // 只留后轮印，干净
    const m = marks[markIdx++ % MARK_POOL];
    const px = player.pos.x + fwd.x * w.z + rgt.x * w.x;
    const pz = player.pos.z + fwd.z * w.z + rgt.z * w.x;
    m.mesh.position.set(px, world.height(px, pz) + 0.04, pz);
    m.mesh.rotation.y = player.heading;
    m.mesh.visible = true;
    m.life = 6;
    m.mesh.material.opacity = 0.5;
  }
}
function updateMarks(dt) {
  for (const m of marks) {
    if (m.life <= 0) continue;
    m.life -= dt;
    m.mesh.material.opacity = Math.min(0.5, m.life * 0.12);
    if (m.life <= 0) m.mesh.visible = false;
  }
}

// 雪雾喷溅（点精灵池）
const SPRAY = 300;
const sprayPos = new Float32Array(SPRAY * 3);
const sprayVel = new Float32Array(SPRAY * 3);
const sprayLife = new Float32Array(SPRAY);
const sprayGeo = new THREE.BufferGeometry();
sprayGeo.setAttribute('position', new THREE.BufferAttribute(sprayPos, 3));
const spray = new THREE.Points(sprayGeo, new THREE.PointsMaterial({
  color: 0xdde6f8, size: 0.7, transparent: true, opacity: 0.55, depthWrite: false,
}));
spray.frustumCulled = false;
scene.add(spray);
let sprayIdx = 0, sprayDist = 0;
function spawnSpray(dt) {
  const intensity = player.slipAmount * (player.onRoad ? 0.4 : 1) * Math.min(1, player.speedKmh / 40);
  sprayDist += player.vel.length() * dt;
  const n = Math.min(6, Math.floor(intensity * sprayDist * 4));
  if (n <= 0) return;
  sprayDist = 0;
  const fwd = player.forward, rgt = player.right;
  for (let k = 0; k < n; k++) {
    const i = sprayIdx++ % SPRAY;
    const side = Math.random() < 0.5 ? -0.8 : 0.8;
    sprayPos[i * 3] = player.pos.x + fwd.x * -1.4 + rgt.x * side;
    sprayPos[i * 3 + 1] = player.pos.y + 0.3;
    sprayPos[i * 3 + 2] = player.pos.z + fwd.z * -1.4 + rgt.z * side;
    sprayVel[i * 3] = (Math.random() - 0.5) * 3 - player.vel.x * 0.15;
    sprayVel[i * 3 + 1] = 1.5 + Math.random() * 2.5;
    sprayVel[i * 3 + 2] = (Math.random() - 0.5) * 3 - player.vel.z * 0.15;
    sprayLife[i] = 0.7 + Math.random() * 0.5;
  }
}
function updateSpray(dt) {
  let any = false;
  for (let i = 0; i < SPRAY; i++) {
    if (sprayLife[i] <= 0) { sprayPos[i * 3 + 1] = -999; continue; }
    any = true;
    sprayLife[i] -= dt;
    sprayVel[i * 3 + 1] -= 9.8 * dt;
    sprayPos[i * 3] += sprayVel[i * 3] * dt;
    sprayPos[i * 3 + 1] += sprayVel[i * 3 + 1] * dt;
    sprayPos[i * 3 + 2] += sprayVel[i * 3 + 2] * dt;
  }
  if (any) sprayGeo.attributes.position.needsUpdate = true;
}

/* ============ 相机 ============ */
let camShake = 0;
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
let camInit = false;

function updateCamera(dt, firstPerson) {
  const fwd = player.forward;
  const speedT = Math.min(1, player.speedKmh / 160);
  if (firstPerson) {
    camPos.copy(player.pos).add(new THREE.Vector3(0, 1.25, 0)).addScaledVector(fwd, 0.3);
    camLook.copy(player.pos).add(new THREE.Vector3(0, 1.1, 0)).addScaledVector(fwd, 30);
    camera.fov = 78 + speedT * 8;
  } else {
    // 第三人称：落后 + 速度拉远 + 漂移侧移
    const dist = 7.2 + speedT * 2.6;
    const height = 3.1 + speedT * 0.7;
    const rgt = player.right;
    const side = THREE.MathUtils.clamp(player.vel.dot(rgt) * 0.12, -1.6, 1.6);
    const desired = new THREE.Vector3()
      .copy(player.pos)
      .addScaledVector(fwd, -dist)
      .addScaledVector(rgt, side);
    desired.y = player.pos.y + height;
    // 相机不穿地
    const gh = world.height(desired.x, desired.z) + 1.2;
    if (desired.y < gh) desired.y = gh;

    if (!camInit) { camPos.copy(desired); camInit = true; }
    const lag = 1 - Math.exp(-dt * 4.5);
    camPos.lerp(desired, lag);

    const lookAhead = new THREE.Vector3()
      .copy(player.pos)
      .addScaledVector(player.vel, 0.22)
      .add(new THREE.Vector3(0, 1.4, 0));
    camLook.lerp(lookAhead, 1 - Math.exp(-dt * 7));
    camera.fov = 70 + speedT * 14 + camZoomPunch;
    camZoomPunch *= Math.exp(-dt * 4.5);
    if (Math.abs(camZoomPunch) < 0.05) camZoomPunch = 0;
  }

  // 碰撞抖动
  if (camShake > 0.001) {
    camPos.x += (Math.random() - 0.5) * camShake;
    camPos.y += (Math.random() - 0.5) * camShake * 0.6;
    camPos.z += (Math.random() - 0.5) * camShake;
    camShake *= Math.exp(-dt * 6);
  }

  camera.position.copy(camPos);
  camera.lookAt(camLook);
  camera.updateProjectionMatrix();
}

/* ============ HUD ============ */
const hud = document.getElementById('hud');
const speedVal = document.getElementById('speedVal');
const polRow = document.getElementById('polRow');
const polText = document.getElementById('polText');
const heatText = document.getElementById('heatText');
const chaseBar = document.getElementById('chaseBar');
const chaseFill = document.getElementById('chaseFill');
const bigMsg = document.getElementById('bigMsg');
const bigMsgKicker = document.getElementById('bigMsgKicker');
const bigMsgText = document.getElementById('bigMsgText');
const wantedText = document.getElementById('wantedText');
const unitCount = document.getElementById('unitCount');
const radarDots = document.getElementById('radarDots');
const radioText = document.getElementById('radioText');
const healthText = document.getElementById('healthText');
const healthFill = document.getElementById('healthFill');
const scoreValue = document.getElementById('scoreValue');
const slowMoVignette = document.getElementById('slowMo');
const takedown = document.getElementById('takedown');
const tdScore = takedown.querySelector('.tdScore');
const tdCount = takedown.querySelector('.tdCount');

let msgTimer = null, radioTimer = null, tdTimer = null, timeScale = 1, timeScaleHold = 0, camZoomPunch = 0;
let realElapsed = 0, simElapsed = 0;
function showTakedown(score) {
  tdScore.textContent = `+${score}`;
  tdCount.textContent = `累计摧毁 ${S.policeDestroyed} 辆`;
  takedown.classList.remove('show');
  void takedown.offsetWidth;
  takedown.classList.add('show');
  clearTimeout(tdTimer);
  tdTimer = setTimeout(() => takedown.classList.remove('show'), 1900);
  timeScale = 0.18;
  timeScaleHold = 0.85;
  camZoomPunch = -9;
}
function showMsg(text, cls = '', dur = 2000, kicker = '') {
  const impact = cls === 'impact';
  bigMsg.className = '';
  void bigMsg.offsetWidth;
  bigMsgText.textContent = text;
  bigMsgKicker.textContent = kicker || (impact ? '碰撞警报 · IMPACT' : cls === 'amber' ? '追逐事件' : cls === 'red' ? '警情通报' : '追逐动态');
  bigMsg.className = `show ${cls}`;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { bigMsg.className = ''; }, dur);
}
function showRadio(text, dur = 4200) {
  radioText.textContent = text;
  radioText.classList.add('active');
  clearTimeout(radioTimer);
  radioTimer = setTimeout(() => radioText.classList.remove('active'), dur);
}

function updateRadar() {
  const units = police.units;
  unitCount.textContent = `${units.length} 辆`;
  wantedText.textContent = `追捕等级 ${S.heatLevel} ${'★'.repeat(S.heatLevel)}`;
  while (radarDots.children.length < units.length) {
    const dot = document.createElement('i');
    dot.className = 'radarDot';
    radarDots.appendChild(dot);
  }
  while (radarDots.children.length > units.length) radarDots.lastElementChild.remove();

  const forward = player.forward, right = player.right;
  const range = 420, radius = 55;
  units.forEach((unit, index) => {
    const dx = unit.car.pos.x - player.pos.x;
    const dz = unit.car.pos.z - player.pos.z;
    const rightward = dx * right.x + dz * right.z;
    const forwardward = dx * forward.x + dz * forward.z;
    const length = Math.hypot(rightward, forwardward) || 1;
    const scale = Math.min(radius, (length / range) * radius) / length;
    const dot = radarDots.children[index];
    dot.className = unit.role === 'roadblock' ? 'radarDot roadblock' : 'radarDot';
    dot.style.left = `${66 + rightward * scale}px`;
    dot.style.top = `${66 - forwardward * scale}px`;
  });

  const health = Math.round(player.health);
  healthText.textContent = `${health}%`;
  healthFill.style.width = `${health}%`;
  healthFill.style.background = health < 30 ? '#ff3939' : health < 60 ? '#ffad42' : 'linear-gradient(90deg,#ff5959,#ffd36e,#7de08a)';
  scoreValue.textContent = Math.floor(S.score).toString().padStart(6, '0');
}

/* ============ 游戏状态 ============ */
const S = {
  running: false,
  over: false,
  firstPerson: false,
  bustTimer: 0,        // 被逼停进度 0..1
  escapeTimer: 0,      // 甩脱进度 0..1
  wavesSurvived: 0,
  heatLevel: 1,
  policeDestroyed: 0,
  score: 0,
  driftTime: 0,
  driftRadioCooldown: 0,
  nearMissCooldown: 0,
  alertCooldown: 0,
  lastPoliceCount: 0,
  elapsed: 0,
  msgCd: 0,
};

function startGame() {
  const start = world.getSpawnPoint();
  world.updateStreaming(start.x, start.z, true);
  player.pos.set(start.x, start.y, start.z);
  player.heading = start.heading;
  player.vel.set(0, 0, 0);
  if (playerVisual) syncVisual(playerVisual, player);
  camInit = false;

  S.running = true;
  S.over = false;
  S.bustTimer = 0;
  S.escapeTimer = 0;
  player.health = 100;
  collisionFeedbackCooldown = 0;
  damageCooldown = 0;
  timeScale = 1;
  timeScaleHold = 0;
  camZoomPunch = 0;
  clearTimeout(tdTimer);
  takedown.classList.remove('show');
  S.wavesSurvived = 0;
  S.heatLevel = 1;
  S.policeDestroyed = 0;
  S.score = 0;
  S.driftTime = 0;
  S.driftRadioCooldown = 0;
  S.nearMissCooldown = 0;
  S.alertCooldown = 0;
  S.elapsed = 0;
  police.reset(player, 3);
  S.lastPoliceCount = police.units.length;
  hud.classList.add('show');
  showRadio('无线电：发现目标，三组巡逻单位接近');
  showMsg('追捕开始', 'amber', 2200);
}

function endGame(win, reason) {
  S.running = false;
  S.over = true;
  police.stop();
  const mins = Math.floor(S.elapsed / 60), secs = Math.floor(S.elapsed % 60);
  document.getElementById('endTitle').textContent = win ? '成功甩脱' : '已被抓获';
  document.getElementById('endTitle').style.color = win ? '#7de08a' : '#ff5b5b';
  document.getElementById('endSub').textContent = reason;
  document.getElementById('endStats').innerHTML =
    `坚持时间 ${mins}分${secs.toString().padStart(2, '0')}秒 · 甩脱波次 ${S.wavesSurvived}<br>逃亡积分 ${Math.floor(S.score).toLocaleString()} · 最高追捕等级 ${S.heatLevel}<br>摧毁警车 ${S.policeDestroyed} 辆`;
  document.getElementById('endScreen').classList.remove('hidden');
  document.getElementById('restartBtn').style.display = 'block';
}

/* ============ 主循环 ============ */
const clock = new THREE.Clock();
let nearestPolice = 1e9;
// 调试用（浏览器控制台可查看）
window.__GAME = {
  player, police, world, S, scene, renderer, camera, showTakedown,
  get playerVisual() { return playerVisual; },
  get nearest() { return nearestPolice; },
  get timeScale() { return timeScale; },
  get timeScaleHold() { return timeScaleHold; },
  get clocks() { return { real: realElapsed, sim: simElapsed }; },
};

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.033, clock.getDelta());
  const time = clock.elapsedTime;

  // 撞毁警车时的短促慢镜：先维持极慢，再平滑恢复正常速度
  if (timeScaleHold > 0) {
    timeScaleHold -= dt;
    if (timeScaleHold <= 0) timeScaleHold = 0;
  } else if (timeScale < 1) {
    timeScale += (1 - timeScale) * Math.min(1, dt * 3.2);
    if (timeScale > 0.985) timeScale = 1;
  }
  const simDt = dt * timeScale;
  realElapsed += dt;
  simElapsed += simDt;
  slowMoVignette.style.opacity = timeScale < 0.99 ? `${(1 - timeScale) * 0.85}` : '0';

  if (S.running) {
    S.elapsed += dt;

    /* --- 玩家输入 --- */
    const inp = input.sample();
    if (input.has('KeyC') && !S._cDown) { S.firstPerson = !S.firstPerson; S._cDown = true; }
    if (!input.has('KeyC')) S._cDown = false;
    if (input.has('KeyR')) { startGame(); document.getElementById('endScreen').classList.add('hidden'); }

    player.throttle = inp.throttle;
    player.brake = inp.brake;
    player.steerInput = inp.steer;
    player.handbrake = inp.handbrake;
    player.update(simDt);
    if (playerVisual) {
      syncVisual(playerVisual, player, simDt);
      updateCarVisual(playerVisual, player, camera, time, { lightsOn: true });
    }

    /* --- 特效 --- */
    spawnTireMarks(simDt);
    updateMarks(dt);
    spawnSpray(simDt);
    updateSpray(simDt);

    /* --- 警车、无线电与动态事件 --- */
    collisionFeedbackCooldown = Math.max(0, collisionFeedbackCooldown - dt);
    damageCooldown = Math.max(0, damageCooldown - dt);
    S.nearMissCooldown = Math.max(0, S.nearMissCooldown - dt);
    S.alertCooldown = Math.max(0, S.alertCooldown - dt);
    S.driftRadioCooldown = Math.max(0, S.driftRadioCooldown - dt);
    S.score += dt * (7 + S.heatLevel * 2);

    const oldPoliceCount = S.lastPoliceCount;
    nearestPolice = police.update(simDt, player);
    for (const event of police.consumeEvents()) {
      if (event.type === 'ram') {
        showMsg(`警车耐久 ${Math.ceil(event.health)}%`, 'impact', 1000, '撞击命中 · RAM');
        showRadio(`撞击命中：警车剩余耐久 ${Math.ceil(event.health)}%`);
      } else if (event.type === 'destroy') {
        S.policeDestroyed++;
        S.score += 1400;
        showTakedown(1400);
        camShake = Math.min(0.5, camShake + 0.28);
        audio.takedown();
        showRadio('无线电：一辆警车失去行动，增援正在补位');
      }
    }
    S.lastPoliceCount = police.units.length;
    const closestUnit = police.units.reduce((best, unit) => {
      const d = unit.car.pos.distanceTo(player.pos);
      return !best || d < best.distance ? { unit, distance: d } : best;
    }, null);
    if (oldPoliceCount === 0 && police.units.length > 0 && S.elapsed > 1) {
      showRadio(`无线电：增援抵达，当前 ${police.units.length} 辆警车`);
      showMsg('增援抵达', 'red', 1500);
    }
    if (nearestPolice < 85 && S.alertCooldown <= 0) {
      showRadio('警告：警车正在逼近');
      showMsg('警车逼近！', 'red', 1200);
      S.alertCooldown = 5;
    }

    // 高速擦身而过奖励，以及漂移连段积分/语音提示
    if (player.speedKmh > 55 && nearestPolice > 3.2 && nearestPolice < 11 && S.nearMissCooldown <= 0) {
      S.score += 250;
      S.nearMissCooldown = 4;
      showMsg('擦身而过  +250', 'amber', 1200);
      showRadio('险些被截停：保持移动');
    }
    if (player.drifting && player.speedKmh > 30) {
      S.driftTime += dt;
      S.score += player.slipAmount * 9 * dt;
      if (S.driftTime > 1.5 && S.driftRadioCooldown <= 0) {
        showRadio(`雪地漂移连段 · ${Math.floor(S.driftTime * 100)} m/s 侧滑`);
        S.driftRadioCooldown = 4;
      }
    } else {
      if (S.driftTime > 1.4) {
        const bonus = Math.round(S.driftTime * 120);
        S.score += bonus;
        showMsg(`漂亮漂移  +${bonus}`, 'amber', 1250);
      }
      S.driftTime = 0;
    }

    /* --- 抓捕 / 逃脱判定 --- */
    const slow = player.speedKmh < 12;
    if (police.units.length > 0) {
      if (nearestPolice < 14 && slow) {
        S.bustTimer = Math.min(1, S.bustTimer + dt / 6);
        S.escapeTimer = Math.max(0, S.escapeTimer - dt * 0.5);
        if (S.bustTimer >= 1) endGame(false, '警车已将你逼停包围');
      } else {
        S.bustTimer = Math.max(0, S.bustTimer - dt / 3);
        if (nearestPolice > 260) {
          S.escapeTimer = Math.min(1, S.escapeTimer + dt / 9);
          if (S.escapeTimer >= 1) {
            S.wavesSurvived++;
            S.heatLevel = Math.min(5, 1 + S.wavesSurvived);
            police.escaped(player, Math.min(5, 3 + S.wavesSurvived));
            showMsg(`甩脱追捕 · 通缉等级 ${S.heatLevel}`, 'amber', 2300);
            showRadio('无线电：目标信号丢失，增援正在赶来');
            S.score += 1000 * S.heatLevel;
            S.escapeTimer = 0;
          }
        } else {
          S.escapeTimer = Math.max(0, S.escapeTimer - dt * 0.35);
        }
      }
    } else {
      S.bustTimer = Math.max(0, S.bustTimer - dt / 3);
      S.escapeTimer = 0;
    }

    /* --- HUD --- */
    speedVal.textContent = Math.round(player.speedKmh);
    if (nearestPolice < 300) {
      polRow.style.display = 'flex';
      polText.textContent = `POLICE · ${police.units.length} UNITS`;
    } else {
      polRow.style.display = 'none';
    }
    heatText.textContent = police.units.length === 0 ? '增援途中' : `${Math.round(nearestPolice)} m`;
    const showBar = S.bustTimer > 0.02 || S.escapeTimer > 0.02;
    chaseBar.classList.toggle('on', showBar);
    if (S.bustTimer > 0.02) {
      chaseFill.style.width = `${S.bustTimer * 100}%`;
      chaseFill.style.background = 'linear-gradient(90deg,#ff2b2b,#ff7040)';
    } else {
      chaseFill.style.width = `${S.escapeTimer * 100}%`;
      chaseFill.style.background = 'linear-gradient(90deg,#2b6bff,#6ee07a)';
    }
    updateRadar();

    /* --- 有方向感的警笛 --- */
    audio.update(dt, player, nearestPolice, time, closestUnit?.unit.car);
  }

  /* --- 相机 & 环境始终更新 --- */
  updateCamera(dt, S.firstPerson);
  world.updateSnow(dt, camera.position);
  renderer.render(scene, camera);
}
loop();

/* ============ 界面事件 ============ */
document.getElementById('startBtn').addEventListener('click', () => {
  audio.init();
  document.getElementById('startScreen').classList.add('hidden');
  startGame();
});
document.getElementById('restartBtn').addEventListener('click', () => {
  document.getElementById('endScreen').classList.add('hidden');
  startGame();
});
