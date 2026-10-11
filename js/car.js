// car.js —— Beware 风格驾驶物理 + 车辆模型加载 + 灯光
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

/* =========================================================
 * 车辆物理（街机 + 动量漂移，重点还原 Beware 手感）
 *
 * 核心思路：
 *  - 速度分解为前向/侧向分量
 *  - 侧向速度按"抓地力"衰减 → 抓地力低（雪地/手刹）时侧滑，形成漂移
 *  - 转向由运动学自行车模型给出角速度，速度越快转向越钝
 *  - 手刹切断后轮侧向抓地 + 增加横摆，制造甩尾
 * ========================================================= */
export class Vehicle {
  constructor(world, opts = {}) {
    this.world = world;
    this.isPolice = !!opts.isPolice;

    // 位置与姿态
    this.pos = new THREE.Vector3();
    this.heading = 0;                 // yaw，弧度，前向 = (sin, 0, cos)
    this.vel = new THREE.Vector3();   // 世界 XZ 速度
    this.angularVel = 0;

    // 车辆参数（家用车：重、惯性大、动力适中）
    const P = this.params = {
      mass: 1250,
      enginePower: opts.isPolice ? 7800 : 8200,   // N：玩家起步略猛
      brakeForce: 10500,
      reversePower: 3800,
      // 极速：警车稍快（约158 vs 152 km/h），但过弯/穿林会掉队 → 技术上可甩脱
      maxSpeed: opts.isPolice ? 44 : 42.4,        // m/s
      drag: 0.42,
      rollRes: 9,
      snowRollRes: 60,
      gripRoad: 10.5,          // 侧向抓地衰减率（柏油）
      gripSnow: 5.6,           // 雪地
      handbrakeGrip: 0.18,     // 手刹侧向抓地乘数（越低越滑）
      handbrakeYawBoost: 0.9,
      wheelBase: 2.6,
      steerMax: 0.62,          // 最大前轮角
      steerSpeed: 3.2,         // 转向响应
      steerReturn: 4.5,
    };

    // 输入
    this.throttle = 0;   // 0..1
    this.brake = 0;      // 0..1
    this.steerInput = 0; // -1..1
    this.handbrake = false;

    // 状态
    this.steer = 0;
    this.speedKmh = 0;
    this.drifting = false;
    this.slipAmount = 0;
    this.slipSigned = 0;
    this.bodyPitch = 0;
    this.bodyRoll = 0;
    this.onRoad = false;
    this.wheelSpin = 0;
    this.engineRpm = 0.15;
    this.health = 100;
    this.stuckTimer = 0;
    this.reversing = false;
  }

  get forward() {
    return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
  }
  get right() {
    return new THREE.Vector3(Math.cos(this.heading), 0, -Math.sin(this.heading));
  }

  update(dt) {
    const P = this.params;
    const fwd = this.forward, rgt = this.right;
    let vF = this.vel.dot(fwd);
    let vL = this.vel.dot(rgt);

    this.onRoad = this.world.onRoad(this.pos.x, this.pos.z);
    const grip = (this.onRoad ? P.gripRoad : P.gripSnow) *
                 (this.handbrake ? P.handbrakeGrip / (this.isPolice ? 1.3 : 1) : 1);
    const rollRes = this.onRoad ? P.rollRes : P.snowRollRes;

    /* --- 纵向动力 --- */
    let force = 0;
    this.reversing = false;
    if (this.throttle > 0) {
      const falloff = Math.max(0, 1 - Math.max(0, vF) / P.maxSpeed);
      const engineCondition = 0.55 + 0.45 * (this.health / 100);
      force += P.enginePower * engineCondition * this.throttle * falloff;
    }
    if (this.brake > 0) {
      if (vF > 0.5) {
        force -= P.brakeForce * this.brake;
      } else {
        force -= P.reversePower * this.brake;       // 刹车到底变倒车
        this.reversing = vF < -0.5;
      }
    }
    // 阻力与滚阻
    force -= P.drag * vF * Math.abs(vF) * 0.5;
    force -= rollRes * vF;
    vF += (force / P.mass) * dt;
    if (Math.abs(vF) < 0.15 && this.throttle === 0 && this.brake === 0) vF = 0;
    vF = THREE.MathUtils.clamp(vF, -9, P.maxSpeed);

    // 先把纵向变化写回世界速度（侧向暂不衰减，交给转向后的投影步骤）
    this.vel.copy(fwd).multiplyScalar(vF).add(rgt.multiplyScalar(vL));

    /* --- 转向 --- */
    const speedNorm = Math.min(1, Math.abs(vF) / 30);
    const steerLimit = P.steerMax / (1 + speedNorm * 1.9);
    const target = this.steerInput * steerLimit;
    const rate = this.steerInput !== 0 ? P.steerSpeed : P.steerReturn;
    this.steer += THREE.MathUtils.clamp(target - this.steer, -rate * dt, rate * dt);

    // 运动学自行车模型 + 手刹横摆增益
    let yawRate = (vF / P.wheelBase) * Math.tan(this.steer);
    if (this.handbrake && Math.abs(vF) > 4) yawRate *= 1 + P.handbrakeYawBoost;
    // 漂移中反打方向更有效（甩尾修正感）
    if (this.drifting && Math.sign(this.steer) === -Math.sign(this.slipSigned)) yawRate *= 1.25;
    this.angularVel = yawRate;
    this.heading += yawRate * dt;

    /* --- 转向后重新投影速度（漂移核心） ---
     * 车头转了，但速度矢量不会立刻跟上：投影到新轴上产生的侧向分量
     * 按抓地力衰减 —— 抓地力越低（雪地/手刹），侧滑残留越久，即为甩尾。 */
    const nf = this.forward, nr = this.right;
    let vFn = this.vel.dot(nf);
    let vLn = this.vel.dot(nr);
    const gripDecay = 1 - Math.exp(-grip * dt);
    this.slipSigned = vLn;
    this.slipAmount = Math.abs(vLn);
    vLn -= vLn * gripDecay;
    this.drifting = Math.abs(vLn) > 2.6;

    /* --- 合成速度 --- */
    this.vel.copy(nf).multiplyScalar(vFn).add(nr.multiplyScalar(vLn));

    /* --- 位置 --- */
    this.pos.addScaledVector(this.vel, dt);
    const ground = this.world.height(this.pos.x, this.pos.z);
    this.pos.y = ground;

    // 世界采用连续全局坐标，不再设置地图边缘或越界夹回。

    /* --- 树木碰撞 --- */
    const trees = this.world.treesNear(this.pos.x, this.pos.z, 3);
    for (const t of trees) {
      const dx = this.pos.x - t.x, dz = this.pos.z - t.z;
      const d2 = dx * dx + dz * dz;
      const minD = t.r + 1.1;
      if (d2 < minD * minD && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const nx = dx / d, nz = dz / d;
        this.pos.x = t.x + nx * minD;
        this.pos.z = t.z + nz * minD;
        const impact = Math.abs(this.vel.dot(new THREE.Vector3(nx, 0, nz)));
        this.vel.multiplyScalar(impact > 8 ? 0.25 : 0.7);
        if (impact > 6 && this.onCollision) this.onCollision(impact);
      }
    }

    /* --- 姿态表现 --- */
    const speed = Math.abs(vF);
    this.speedKmh = this.vel.length() * 3.6;
    const targetPitch = -this.throttle * 0.028 + this.brake * (vF > 1 ? 0.045 : 0);
    const targetRoll = THREE.MathUtils.clamp(-yawRate * speed * 0.0055, -0.07, 0.07);
    this.bodyPitch += (targetPitch - this.bodyPitch) * Math.min(1, dt * 6);
    this.bodyRoll += (targetRoll - this.bodyRoll) * Math.min(1, dt * 6);

    // 引擎转速（音效用）
    const rpmT = Math.min(1, Math.abs(vF) / P.maxSpeed);
    const targetRpm = 0.16 + rpmT * 0.84 + (this.throttle > 0 && speed < 6 ? 0.25 : 0);
    this.engineRpm += (targetRpm - this.engineRpm) * Math.min(1, dt * 3);
    this.wheelSpin += vF * dt * 2.2;

    // 卡住计时（警车 AI 用 / 抓捕判定用）
    if (speed < 1.2) this.stuckTimer += dt; else this.stuckTimer = 0;
  }
}

/* =========================================================
 * 车辆外观：加载 FBX 低模并归一化（尺寸/朝向/落地）
 * ========================================================= */
const fbxCache = new Map();

export function preloadCarModel(url) {
  return new Promise((resolve, reject) => {
    const loader = new FBXLoader();
    loader.load(url, (fbx) => {
      fbxCache.set(url, fbx);
      resolve(fbx);
    }, undefined, reject);
  });
}

/**
 * 构建车辆外观容器
 * @param url FBX 路径
 * @param opts { length 目标车长, yawFix 朝向修正(弧度), color 兜底涂装, police 是否警车 }
 */
export function buildCarVisual(url, opts = {}) {
  const src = fbxCache.get(url);
  const group = new THREE.Group();      // 物理姿态容器
  const body = new THREE.Group();       // 悬挂俯仰/侧倾容器
  group.add(body);

  if (src) {
    const model = src.clone(true);
    // 归一化：包围盒 → 目标车长
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const len = Math.max(size.x, size.z);
    const s = (opts.length || 4.6) / len;
    model.scale.setScalar(s);
    // 若车长在 X 轴，旋转 90° 使其朝 Z
    if (size.x > size.z) model.rotation.y = Math.PI / 2;
    model.rotation.y += opts.yawFix || 0;
    // 底部落地、中心对齐
    const box2 = new THREE.Box3().setFromObject(model);
    const center = box2.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= box2.min.y;
    // 统一材质：FBX 带的是 MeshPhong（specular 亮 + shininess 0 → 全表面白高光，糊掉 basecolor）
    // 这里转成 Standard，只保留 basecolor(map) 与 normalMap，去掉金属/镜面反射
    model.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      o.castShadow = false;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      const conv = list.map((m) => {
        if (!m || m.isMeshBasicMaterial) return m;
        const std = new THREE.MeshStandardMaterial({
          map: m.map || null,
          normalMap: m.normalMap || null,
          color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
          metalness: 0,
          roughness: 0.68,
          envMapIntensity: 0,          // 不吃环境反射
        });
        if (m.normalScale) std.normalScale.copy(m.normalScale);
        std.transparent = m.transparent;
        std.opacity = m.opacity;
        std.alphaTest = m.alphaTest || 0;
        std.side = m.side;
        std.name = m.name;
        // 贴图色彩空间与清晰度
        if (std.map) { std.map.colorSpace = THREE.SRGBColorSpace; std.map.anisotropy = 8; }
        if (std.normalMap) std.normalMap.anisotropy = 8;
        return std;
      });
      o.material = Array.isArray(o.material) ? conv : conv[0];
    });
    body.add(model);
  } else {
    // 兜底：简单方块车
    const geo = new THREE.BoxGeometry(1.8, 1.1, 4.5);
    const mat = new THREE.MeshStandardMaterial({ color: opts.color || 0x334455, roughness: 0.6 });
    const m = new THREE.Mesh(geo, mat);
    m.position.y = 0.75;
    body.add(m);
  }

  addCarLights(body, opts);
  return { group, body };
}

/* ---------- 车灯 ---------- */
function addCarLights(body, opts) {
  const lights = {};

  // 头灯：发光片
  const hlMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
  const hlGeo = new THREE.BoxGeometry(0.42, 0.16, 0.06);
  for (const sx of [-0.62, 0.62]) {
    const m = new THREE.Mesh(hlGeo, hlMat);
    m.position.set(sx, 0.72, 2.28);
    body.add(m);
  }

  // 尾灯
  const tlMat = new THREE.MeshBasicMaterial({ color: 0x551111 });
  const tlGeo = new THREE.BoxGeometry(0.42, 0.14, 0.06);
  const tails = [];
  for (const sx of [-0.62, 0.62]) {
    const m = new THREE.Mesh(tlGeo, tlMat.clone());
    m.position.set(sx, 0.76, -2.26);
    body.add(m);
    tails.push(m);
  }

  // 头灯 spotlight（真实照明）
  const spots = [];
  if (opts.headlights !== false) {
    // 玩家车两束；警车只用一束（控制实时光源数量）
    const offsets = opts.isPolice ? [0] : [-0.62, 0.62];
    for (const sx of offsets) {
      const spot = new THREE.SpotLight(0xf7ecd2, opts.isPolice ? 320 : 300, 110, 0.46, 0.55, 1.6);
      spot.position.set(sx, 0.85, 2.1);
      const target = new THREE.Object3D();
      target.position.set(sx * 2.2, -0.6, 24);
      body.add(target);
      spot.target = target;
      body.add(spot);
      spots.push(spot);
    }
  }

  if (opts.isPolice) {
    // 警灯：红蓝发光盒 + 闪烁点光
    const barRed = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.14, 0.24),
      new THREE.MeshBasicMaterial({ color: 0xff2222 })
    );
    barRed.position.set(-0.3, 1.52, 0.1);
    const barBlue = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.14, 0.24),
      new THREE.MeshBasicMaterial({ color: 0x2244ff })
    );
    barBlue.position.set(0.3, 1.52, 0.1);
    body.add(barRed, barBlue);

    const pRed = new THREE.PointLight(0xff2020, 0, 42, 1.8);
    pRed.position.set(-0.4, 1.8, 0);
    const pBlue = new THREE.PointLight(0x2040ff, 0, 42, 1.8);
    pBlue.position.set(0.4, 1.8, 0);
    body.add(pRed, pBlue);

    lights.barRed = barRed;
    lights.barBlue = barBlue;
    lights.pRed = pRed;
    lights.pBlue = pBlue;
  }

  lights.tails = tails;
  lights.spots = spots;
  body.userData.lights = lights;
}

/* ---------- 每帧灯光刷新 ---------- */
export function updateCarVisual(visual, vehicle, camera, timeSec, opts = {}) {
  const L = visual.body.userData.lights;
  if (!L) return;

  // 刹车灯
  const braking = vehicle.brake > 0 && !vehicle.reversing;
  for (const t of L.tails) {
    t.material.color.setHex(braking ? 0xff2a1a : 0x661512);
  }
  // 头灯朝向相机时降亮度（防刺眼）：简化为固定
  if (L.spots.length) L.spots.forEach(s => { s.intensity = opts.lightsOn ? (opts.isPolice ? 260 : 200) : 0; });

  // 警灯闪烁
  if (opts.isPolice && L.pRed) {
    if (opts.disabled) {
      L.pRed.intensity = 0;
      L.pBlue.intensity = 0;
      L.barRed.material.color.setHex(0x321919);
      L.barBlue.material.color.setHex(0x191e32);
    } else {
      const phase = Math.sin(timeSec * 9) > 0;
      L.pRed.intensity = phase ? 320 : 0;
      L.pBlue.intensity = phase ? 0 : 320;
      L.barRed.material.color.setHex(phase ? 0xff5040 : 0x550f0f);
      L.barBlue.material.color.setHex(phase ? 0x102060 : 0x5060ff);
    }
  }
}
