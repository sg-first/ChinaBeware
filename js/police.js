// police.js —— 警车追逐 AI：预判追击、卡住脱困、互相避让、撞击逼停
import * as THREE from 'three';
import { Vehicle, buildCarVisual, updateCarVisual } from './car.js';

const POLICE_MODELS = ['assets/police1.fbx', 'assets/police2.fbx'];

function makeRadialTexture(innerColor, outerColor = 'rgba(0,0,0,0)') {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  gradient.addColorStop(0, innerColor);
  gradient.addColorStop(1, outerColor);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeWreckEffect(unit) {
  const group = new THREE.Group();
  unit.visual.group.add(group);

  const scorch = new THREE.Mesh(
    new THREE.CircleGeometry(2.2, 20),
    new THREE.MeshBasicMaterial({ color: 0x171a1e, transparent: true, opacity: 0.58, depthWrite: false, side: THREE.DoubleSide }),
  );
  scorch.rotation.x = -Math.PI / 2;
  scorch.position.y = 0.035;
  group.add(scorch);

  const smokeCount = 26;
  const smokePositions = new Float32Array(smokeCount * 3);
  const smokeAges = new Float32Array(smokeCount);
  const smokeGeo = new THREE.BufferGeometry();
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(smokePositions, 3));
  const smokeTexture = makeRadialTexture('rgba(75,82,92,0.68)');
  const smoke = new THREE.Points(smokeGeo, new THREE.PointsMaterial({
    map: smokeTexture, color: 0x8a94a3, size: 3.2, transparent: true,
    opacity: 0.72, depthWrite: false, sizeAttenuation: true,
  }));
  smoke.frustumCulled = false;
  group.add(smoke);

  const sparkCount = 20;
  const sparkPositions = new Float32Array(sparkCount * 3);
  const sparkVelocities = new Float32Array(sparkCount * 3);
  const sparkAges = new Float32Array(sparkCount);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
    map: makeRadialTexture('rgba(255,220,130,0.95)'), color: 0xff792c,
    size: 0.46, transparent: true, opacity: 0.95, depthWrite: false,
  }));
  sparks.frustumCulled = false;
  group.add(sparks);

  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff6b20, transparent: true, opacity: 0.92 });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.36, 1.25, 7), flameMat);
  flame.position.set(0.15, 1.25, 0.45);
  group.add(flame);
  const glow = new THREE.PointLight(0xff5420, 26, 22, 2);
  glow.position.set(0, 1.2, 0.4);
  group.add(glow);

  const smokeTextureAttr = smoke.geometry.attributes.position;
  for (let i = 0; i < smokeCount; i++) {
    smokeAges[i] = Math.random() * 1.8;
    smokePositions[i * 3] = (Math.random() - 0.5) * 0.8;
    smokePositions[i * 3 + 1] = 1.4 + Math.random() * 1.8;
    smokePositions[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
  }
  smokeTextureAttr.needsUpdate = true;

  for (let i = 0; i < sparkCount; i++) {
    sparkAges[i] = Math.random() * 1.1;
    sparkPositions[i * 3] = (Math.random() - 0.5) * 0.7;
    sparkPositions[i * 3 + 1] = 1.1 + Math.random() * 0.8;
    sparkPositions[i * 3 + 2] = (Math.random() - 0.5) * 0.7;
    sparkVelocities[i * 3] = (Math.random() - 0.5) * 5;
    sparkVelocities[i * 3 + 1] = 1.5 + Math.random() * 5;
    sparkVelocities[i * 3 + 2] = (Math.random() - 0.5) * 5;
  }

  return {
    group, smoke, smokeAges, smokePositions, sparks, sparkAges,
    sparkPositions, sparkVelocities, flame, flameMat, glow,
  };
}

function updateWreckEffect(unit, dt) {
  const fx = unit.wreckFx;
  const smokePos = fx.smoke.geometry.attributes.position;
  for (let i = 0; i < fx.smokeAges.length; i++) {
    const k = i * 3;
    fx.smokeAges[i] += dt;
    if (fx.smokeAges[i] > 1.9) {
      fx.smokeAges[i] = 0;
      fx.smokePositions[k] = (Math.random() - 0.5) * 0.7;
      fx.smokePositions[k + 1] = 1.25;
      fx.smokePositions[k + 2] = (Math.random() - 0.5) * 0.7;
    } else {
      fx.smokePositions[k] += Math.sin(unit.wreckTimer * 4 + i) * dt * 0.45;
      fx.smokePositions[k + 1] += dt * (1.1 + fx.smokeAges[i] * 0.45);
      fx.smokePositions[k + 2] += Math.cos(unit.wreckTimer * 3 + i) * dt * 0.32;
    }
  }
  smokePos.needsUpdate = true;

  const sparkPos = fx.sparks.geometry.attributes.position;
  for (let i = 0; i < fx.sparkAges.length; i++) {
    const k = i * 3;
    fx.sparkAges[i] += dt;
    if (fx.sparkAges[i] < 1.3) {
      fx.sparkVelocities[k + 1] -= 9.8 * dt;
      fx.sparkPositions[k] += fx.sparkVelocities[k] * dt;
      fx.sparkPositions[k + 1] += fx.sparkVelocities[k + 1] * dt;
      fx.sparkPositions[k + 2] += fx.sparkVelocities[k + 2] * dt;
    } else {
      fx.sparkPositions[k + 1] = -100;
    }
  }
  sparkPos.needsUpdate = true;

  const flicker = 0.72 + Math.sin(unit.wreckTimer * 18) * 0.22 + Math.sin(unit.wreckTimer * 31) * 0.08;
  fx.flame.scale.set(0.8 + flicker * 0.3, 0.75 + flicker * 0.65, 0.8 + flicker * 0.3);
  fx.flameMat.opacity = 0.68 + flicker * 0.28;
  fx.glow.intensity = 15 + flicker * 22;
}

export class PoliceUnit {
  constructor(world, modelUrl) {
    this.world = world;
    this.car = new Vehicle(world, { isPolice: true });
    this.visual = buildCarVisual(modelUrl, { isPolice: true, length: 4.8 });
    this.aiSteer = 0;
    this.aiThrottle = 0;
    this.aiBrake = 0;
    this.avoidDir = 0;
    this.avoidTimer = 0;
    this.role = 'pursuit';
    this.health = 100;
    this.ramCooldown = 0;
    this.disabled = false;
    this.wreckTimer = 0;
    this.lightPhase = Math.random() * Math.PI * 2;
    this.active = true;
  }

  applyRamDamage(amount) {
    if (this.disabled) return false;
    this.health = Math.max(0, this.health - amount);
    this.car.health = this.health;
    if (this.health <= 0) {
      this.disabled = true;
      this.wreckTimer = 6;
      this.car.throttle = 0;
      this.car.brake = 0;
      this.car.vel.multiplyScalar(0.35);
      this.car.bodyRoll = (Math.random() - 0.5) * 0.18;
      return true;
    }
    return false;
  }

  update(dt, playerCar, timeSec) {
    const car = this.car;
    const toPlayer = new THREE.Vector3().subVectors(playerCar.pos, car.pos);
    const dist = toPlayer.length();

    /* --- 预判追击：瞄准玩家前方位置 --- */
    const playerSpeed = playerCar.vel.length();
    const lead = THREE.MathUtils.clamp(dist / 30, 0, 1.4) * playerSpeed;
    const target = new THREE.Vector3()
      .copy(playerCar.pos)
      .addScaledVector(playerCar.vel, lead * 0.05);
    if (this.role === 'pursuit-left') target.addScaledVector(playerCar.right, -5);
    if (this.role === 'pursuit-right') target.addScaledVector(playerCar.right, 5);

    /* --- 避树：前方探测 --- */
    this.avoidTimer -= dt;
    const fwd = car.forward;
    if (this.avoidTimer <= 0) {
      this.avoidTimer = 0.25;
      const probe = 10 + car.vel.length() * 0.6;
      const px = car.pos.x + fwd.x * probe, pz = car.pos.z + fwd.z * probe;
      const trees = this.world.treesNear(px, pz, 6);
      let steerFix = 0;
      for (const t of trees) {
        const dx = t.x - px, dz = t.z - pz;
        const d = Math.hypot(dx, dz);
        if (d < 6) steerFix += (dx * fwd.z - dz * fwd.x) > 0 ? -1 : 1;
      }
      this.avoidDir = steerFix !== 0 ? Math.sign(steerFix) : 0;
    }

    /* --- 转向控制 --- */
    const fwd2 = car.forward;
    const desired = Math.atan2(target.x - car.pos.x, target.z - car.pos.z);
    let diff = desired - car.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    let steer = THREE.MathUtils.clamp(diff * 1.6, -1, 1) + this.avoidDir * 0.35;

    /* --- 油门/刹车 --- */
    let throttle = 1, brake = 0;
    const speed = car.vel.length();
    // 急弯减速
    if (Math.abs(diff) > 0.9 && speed > 16) { throttle = 0.1; brake = 0.5; }
    // 近距离正面拦截：不减速，直接顶
    // 卡住脱困：倒车
    if (car.stuckTimer > 1.6) {
      throttle = 0; brake = 1;
      if (car.stuckTimer > 3.4) { steer = -steer; }
      if (car.stuckTimer > 4.5) car.stuckTimer = 0;
    }

    car.steerInput = THREE.MathUtils.clamp(steer, -1, 1);
    car.throttle = throttle;
    car.brake = brake;
    car.handbrake = Math.abs(diff) > 1.5 && speed > 14;   // 甩尾过弯

    car.update(dt);

    /* --- 视觉同步 --- */
    syncVisual(this.visual, car, dt);
    // 远处警车关闭实时光源（雾里也看不见，省性能）
    updateCarVisual(this.visual, car, null, timeSec + this.lightPhase, { isPolice: true, lightsOn: dist < 260 });

    return dist;
  }
}

/* ---------- 视觉同步（也供玩家车使用） ----------
 * 贴地：车身 up 对齐地形法线（保持车头朝向），带平滑过渡 */
const _svN = new THREE.Vector3();
const _svF = new THREE.Vector3();
const _svX = new THREE.Vector3();
const _svM = new THREE.Matrix4();
const _svQ = new THREE.Quaternion();

export function syncVisual(visual, car, dt = 0) {
  visual.group.position.copy(car.pos);

  const n = _svN.copy(car.world.normal(car.pos.x, car.pos.z));
  const fwd = _svF.set(Math.sin(car.heading), 0, Math.cos(car.heading));
  fwd.addScaledVector(n, -fwd.dot(n)).normalize();   // 车头投影到坡面
  const x = _svX.crossVectors(n, fwd).normalize();
  _svM.makeBasis(x, n, fwd);
  _svQ.setFromRotationMatrix(_svM);

  if (dt > 0) visual.group.quaternion.slerp(_svQ, Math.min(1, dt * 9));
  else visual.group.quaternion.copy(_svQ);

  visual.body.rotation.x = car.bodyPitch;
  visual.body.rotation.z = car.bodyRoll;
}

export class PoliceManager {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.units = [];
    this.wrecks = [];
    this.events = [];
    this.wave = 0;
    this.time = 0;
    this.spawnCooldown = 0;
    this.targetCount = 0;
    this.active = false;
  }

  reset(playerCar, count = 2) {
    this.removeAll();
    this.events.length = 0;
    this.wave = 0;
    this.time = 0;
    this.targetCount = count;
    this.spawnCooldown = 0.25;
    this.active = true;
    this.spawnNearPlayer(playerCar, count);
  }

  escaped(playerCar, count) {
    this.removeAll();
    this.wave++;
    this.targetCount = count;
    this.spawnCooldown = 6;
    this.active = true;
  }

  stop() {
    this.active = false;
    this.targetCount = 0;
    this.spawnCooldown = 0;
    this.removeAll();
  }

  clear() { this.removeAll(); }

  consumeEvents() {
    const events = this.events.slice();
    this.events.length = 0;
    return events;
  }

  removeAll() {
    for (const unit of [...this.units, ...this.wrecks]) {
      this.scene.remove(unit.visual.group);
      if (unit.wreckFx) this.disposeWreckEffect(unit.wreckFx);
    }
    this.units.length = 0;
    this.wrecks.length = 0;
  }

  disposeWreckEffect(fx) {
    fx.group.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (material.map) material.map.dispose();
          material.dispose();
        }
      }
    });
  }

  spawnNearPlayer(playerCar, count) {
    if (!this.active || !count) return;
    const forward = playerCar.forward;
    const right = playerCar.right;
    const added = [];
    for (let i = 0; i < count; i++) {
      const roleIndex = i % 3;
      const lane = Math.floor(i / 3);
      const roadblock = roleIndex === 2;
      const role = roadblock ? 'roadblock' : roleIndex === 0 ? 'pursuit-left' : 'pursuit-right';
      const policeHeading = playerCar.heading + (roadblock ? Math.PI : 0);
      const url = POLICE_MODELS[(this.wave + i) % POLICE_MODELS.length];
      const unit = new PoliceUnit(this.world, url);
      unit.role = role;
      let road = null;
      for (let attempt = 0; attempt < 6; attempt++) {
        const ahead = roadblock ? 125 + lane * 50 + attempt * 25 : 0;
        const behind = roadblock ? 0 : 112 + lane * 60 + roleIndex * 40 + attempt * 30;
        const longitudinal = roadblock ? ahead : -behind;
        const sideBase = roleIndex === 0 ? -24 : roleIndex === 1 ? 24 : (lane % 2 ? -22 : 22);
        const side = sideBase + Math.sign(sideBase || 1) * attempt * 10;
        const x = playerCar.pos.x + forward.x * longitudinal + right.x * side;
        const z = playerCar.pos.z + forward.z * longitudinal + right.z * side;
        const candidate = this.world.nearestRoadPoint(x, z, policeHeading);
        const dx = candidate.x - playerCar.pos.x, dz = candidate.z - playerCar.pos.z;
        const distance = Math.hypot(dx, dz);
        const clearOfOtherCars = [...this.units, ...added].every((other) =>
          Math.hypot(candidate.x - other.car.pos.x, candidate.z - other.car.pos.z) > 24
        );
        if (distance >= 100 && distance <= 340 && clearOfOtherCars) { road = candidate; break; }
        road = candidate;
      }
      unit.car.pos.set(road.x, this.world.height(road.x, road.z), road.z);
      unit.car.heading = road.heading;
      syncVisual(unit.visual, unit.car);
      this.scene.add(unit.visual.group);
      this.units.push(unit);
      added.push(unit);
    }
    this.spawnCooldown = 0;
  }

  update(dt, playerCar) {
    this.time += dt;
    this.world.updateStreaming(playerCar.pos.x, playerCar.pos.z);
    this.spawnCooldown = Math.max(0, this.spawnCooldown - dt);

    // 持续刷新机制：远离追捕范围的警车退场，冷却结束后由道路网补位。
    const expired = [], destroyed = [];
    let nearest = Infinity;
    for (const unit of this.units) {
      unit.ramCooldown = Math.max(0, unit.ramCooldown - dt);
      const d = unit.update(dt, playerCar, this.time);
      if (d > 900) { expired.push(unit); continue; }
      nearest = Math.min(nearest, d);

      const dp = new THREE.Vector3().subVectors(unit.car.pos, playerCar.pos);
      const dd = dp.length();
      if (dd < 4.1 && dd > 1e-4) {
        const n = dp.normalize();
        const overlap = 4.1 - dd;
        unit.car.pos.addScaledVector(n, overlap * 0.62);
        playerCar.pos.addScaledVector(n, -overlap * 0.38);
        const relV = new THREE.Vector3().subVectors(unit.car.vel, playerCar.vel).dot(n);
        const playerAlongImpact = playerCar.vel.dot(n);
        const playerSpeed = playerCar.vel.length();
        const impactAngle = playerSpeed > 0.01 ? playerAlongImpact / playerSpeed : -1;

        // 正面、斜向和侧擦都能撞伤警车；只有正后方追尾不算玩家主动撞击。
        // 约 29 km/h 起可造成伤害，速度越高单次伤害越大；每车有独立冷却避免贴车连击。
        if (!unit.disabled && playerSpeed >= 8 && impactAngle > -0.5 && unit.ramCooldown <= 0) {
          const damage = THREE.MathUtils.clamp(9 + (playerSpeed - 8) * 1.15, 9, 24);
          const isDestroyed = unit.applyRamDamage(damage);
          unit.ramCooldown = 0.85;
          this.events.push({ type: 'ram', damage, health: unit.health, unit, impact: playerSpeed, angle: impactAngle });
          if (isDestroyed) destroyed.push(unit);
        }

        if (relV < -6) {
          if (playerCar.onCollision) playerCar.onCollision(Math.abs(relV), 'police');
          playerCar.vel.addScaledVector(n, relV * 0.25);
          unit.car.vel.addScaledVector(n, -relV * 0.75);
        }
      }
    }

    for (const unit of expired) {
      this.scene.remove(unit.visual.group);
      this.units.splice(this.units.indexOf(unit), 1);
    }
    for (const unit of destroyed) {
      const index = this.units.indexOf(unit);
      if (index >= 0) this.units.splice(index, 1);
      unit.car.bodyPitch = 0.12;
      unit.car.bodyRoll = (Math.random() < 0.5 ? -1 : 1) * (0.62 + Math.random() * 0.12);
      unit.visual.body.rotation.x = unit.car.bodyPitch;
      unit.visual.body.rotation.z = unit.car.bodyRoll;
      unit.car.vel.multiplyScalar(0.3);
      unit.car.angularVel = (Math.random() - 0.5) * 1.2;
      unit.visual.body.traverse((object) => {
        if (!object.isMesh || !object.material) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (material.isMeshStandardMaterial && material.color) {
            material.color.multiplyScalar(0.66);
            material.roughness = 1;
          }
        }
      });
      unit.wreckFx = makeWreckEffect(unit);
      updateWreckEffect(unit, 0);
      this.wrecks.push(unit);
      this.events.push({ type: 'destroy', unit });
      this.spawnCooldown = Math.max(this.spawnCooldown, 7.5);
    }
    if (expired.length && this.active) {
      this.spawnCooldown = Math.max(this.spawnCooldown, 4 + Math.random() * 3);
    }

    for (let i = this.wrecks.length - 1; i >= 0; i--) {
      const wreck = this.wrecks[i];
      wreck.wreckTimer -= dt;
      wreck.car.pos.addScaledVector(wreck.car.vel, dt);
      wreck.car.vel.multiplyScalar(Math.exp(-dt * 2.2));
      wreck.car.pos.y = this.world.height(wreck.car.pos.x, wreck.car.pos.z);
      syncVisual(wreck.visual, wreck.car, dt);
      wreck.car.heading += wreck.car.angularVel * dt;
      wreck.car.angularVel *= Math.exp(-dt * 0.75);
      updateCarVisual(wreck.visual, wreck.car, null, this.time, { isPolice: true, lightsOn: false, disabled: true });
      updateWreckEffect(wreck, dt);
      if (wreck.wreckTimer <= 0) {
        this.scene.remove(wreck.visual.group);
        this.disposeWreckEffect(wreck.wreckFx);
        this.wrecks.splice(i, 1);
      }
    }

    // 警车互避
    for (let i = 0; i < this.units.length; i++) {
      for (let j = i + 1; j < this.units.length; j++) {
        const a = this.units[i].car, b = this.units[j].car;
        const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 4.5 && d > 1e-4) {
          const push = (4.5 - d) * 0.5 / d;
          a.pos.x += dx * push; a.pos.z += dz * push;
          b.pos.x -= dx * push; b.pos.z -= dz * push;
        }
      }
    }

    if (this.active && this.units.length < this.targetCount && this.spawnCooldown <= 0) {
      this.spawnNearPlayer(playerCar, this.targetCount - this.units.length);
    }
    return nearest;
  }
}
