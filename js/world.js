// world.js —— 无限分块雪原 + 程序化道路网 + 动态针叶林
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const CHUNK_SIZE = 320;
const CHUNK_SEGMENTS = 48;
const ROAD_SPACING = 260;
const ROAD_WIDTH = 9;
const ROAD_HALF = ROAD_WIDTH * 0.5;
const TREE_CELL = 24;
const STREAM_RADIUS = 2;

function hash2(x, z) {
  const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return h - Math.floor(h);
}
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z, oct = 4) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    s += amp * vnoise(x * f, z * f);
    amp *= 0.5;
    f *= 2.07;
  }
  return s;
}
function trackX(k) { return k * ROAD_SPACING + (hash2(k, 71) - 0.5) * 42; }
function trackZ(k) { return k * ROAD_SPACING + (hash2(83, k) - 0.5) * 42; }

const terrainMat = new THREE.MeshStandardMaterial({
  map: makeSnowTexture(), vertexColors: true, roughness: 1, metalness: 0,
});
const roadMat = new THREE.MeshStandardMaterial({ map: makeRoadTexture(), roughness: 0.82, metalness: 0 });
const trunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 2.2, 5);
trunkGeo.translate(0, 1.1, 0);
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x2e1f16, roughness: 1 });
const foliageGeo = makeFoliageGeometry();
const foliageMat = new THREE.MeshStandardMaterial({ color: 0x1d3326, roughness: 1, flatShading: true });
const snowCapGeo = makeSnowCapGeometry();
const snowCapMat = new THREE.MeshStandardMaterial({ color: 0xf3e7d5, roughness: 1, flatShading: true });

function makeFoliageGeometry() {
  const geos = [];
  for (const [r, h, y] of [[1.9, 2.6, 2.6], [1.5, 2.2, 4.6], [1.0, 2.0, 6.3]]) {
    const g = new THREE.ConeGeometry(r, h, 6);
    g.translate(0, y, 0);
    geos.push(g);
  }
  return mergeGeometries(geos);
}

function makeSnowCapGeometry() {
  // 比树冠略大、略微上移的白色薄壳 —— 从上方看是积雪覆盖的树冠
  const geos = [];
  for (const [r, h, y] of [[1.9, 2.6, 2.6], [1.5, 2.2, 4.6], [1.0, 2.0, 6.3]]) {
    const g = new THREE.ConeGeometry(r + 0.14, h * 0.72, 6);
    g.translate(0, y + h * 0.2, 0);
    geos.push(g);
  }
  return mergeGeometries(geos);
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map();
    this.treeGrid = new Map();
    this.gridCell = TREE_CELL;
    this.centerChunk = null;
    this.buildLights();
    this.buildSnowfall();
    this.updateStreaming(0, 0, true);
  }

  buildLights() {
    // 黄昏雪原：低角度落日 + 暖橙色浓雾 + 渐变天穹
    this.scene.background = new THREE.Color(0xcf8b52);
    this.scene.fog = new THREE.FogExp2(0xd08c52, 0.0052);

    this.hemi = new THREE.HemisphereLight(0xffb070, 0x8a5a40, 0.95);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xffb268, 2.6);
    sun.position.set(-320, 95, -240);
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0xff9a5a, 0.38));
    this.sunDir = sun.position.clone().normalize();

    this.buildSky();
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(1150, 32, 18);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: new THREE.Color(0xc06a34) },
        horizonColor: { value: new THREE.Color(0xffc07e) },
        bottomColor: { value: new THREE.Color(0x6e4023) },
        sunColor: { value: new THREE.Color(0xffe2b0) },
        sunDir: { value: this.sunDir },
      },
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 topColor, horizonColor, bottomColor, sunColor, sunDir;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = h >= 0.0
            ? mix(horizonColor, topColor, pow(h, 0.5))
            : mix(horizonColor, bottomColor, pow(clamp(-h * 4.0, 0.0, 1.0), 0.6));
          float s = max(dot(d, sunDir), 0.0);
          col += sunColor * (pow(s, 420.0) * 1.35 + pow(s, 16.0) * 0.4);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  hillHeight(x, z) {
    let h = fbm(x * 0.0035, z * 0.0035) * 46 - 14;
    h += fbm(x * 0.013 + 7.3, z * 0.013 - 2.1) * 9;
    h += fbm(x * 0.05, z * 0.05) * 1.6;
    // 大尺度山脊，连续延伸，无地图边缘
    h += Math.pow(fbm(x * 0.0013 + 20, z * 0.0013 - 11), 2) * 65;
    return h;
  }

  roadQuery(x, z) {
    let bestD2 = Infinity, bestX = x, bestZ = z, bestVertical = true;
    const ix = Math.round(x / ROAD_SPACING), iz = Math.round(z / ROAD_SPACING);
    for (let k = ix - 1; k <= ix + 1; k++) {
      const rx = trackX(k), d2 = (x - rx) ** 2;
      if (d2 < bestD2) { bestD2 = d2; bestX = rx; bestZ = z; bestVertical = true; }
    }
    for (let k = iz - 1; k <= iz + 1; k++) {
      const rz = trackZ(k), d2 = (z - rz) ** 2;
      if (d2 < bestD2) { bestD2 = d2; bestX = x; bestZ = rz; bestVertical = false; }
    }
    return { dist: Math.sqrt(bestD2), elev: this.hillHeight(bestX, bestZ), x: bestX, z: bestZ, vertical: bestVertical };
  }

  height(x, z) {
    const hill = this.hillHeight(x, z);
    const road = this.roadQuery(x, z);
    if (road.dist >= ROAD_HALF + 13) return hill;
    const t = THREE.MathUtils.clamp((road.dist - ROAD_HALF) / 13, 0, 1);
    const blend = t * t * (3 - 2 * t);
    let h = road.elev * (1 - blend) + hill * blend;
    // 除雪后堆在路缘的雪垄（只出现在路肩外侧）
    const bermT = road.dist - ROAD_HALF;
    if (bermT > -0.3 && bermT < 5) {
      const wob = 0.72 + fbm(x * 0.11, z * 0.11) * 0.56;
      h += Math.exp(-((bermT - 1.35) ** 2) / 1.9) * 0.85 * wob;
    }
    return h;
  }

  onRoad(x, z) { return this.roadQuery(x, z).dist <= ROAD_HALF + 0.5; }

  normal(x, z) {
    const e = 2.2;
    return new THREE.Vector3(
      this.height(x - e, z) - this.height(x + e, z),
      2 * e,
      this.height(x, z - e) - this.height(x, z + e),
    ).normalize();
  }

  nearestRoadPoint(x, z, preferredHeading = null) {
    const candidates = [];
    const ix = Math.round(x / ROAD_SPACING), iz = Math.round(z / ROAD_SPACING);
    for (let k = ix - 1; k <= ix + 1; k++) {
      const rx = trackX(k);
      candidates.push({ x: rx, z, vertical: true, distance: Math.abs(x - rx) });
    }
    for (let k = iz - 1; k <= iz + 1; k++) {
      const rz = trackZ(k);
      candidates.push({ x, z: rz, vertical: false, distance: Math.abs(z - rz) });
    }
    let best = null, bestCost = Infinity;
    for (const p of candidates) {
      let heading = p.vertical ? 0 : Math.PI / 2;
      if (preferredHeading !== null) {
        const dirX = Math.sin(preferredHeading), dirZ = Math.cos(preferredHeading);
        const align = p.vertical ? dirZ : dirX;
        if (align < 0) heading += Math.PI;
      }
      const alignPenalty = preferredHeading === null ? 0 : (1 - Math.abs(Math.cos(heading - preferredHeading))) * 14;
      const cost = p.distance + alignPenalty;
      if (cost < bestCost) {
        bestCost = cost;
        best = { x: p.x, z: p.z, heading, distance: p.distance, vertical: p.vertical };
      }
    }
    best.y = this.height(best.x, best.z);
    return best;
  }

  getSpawnPoint() {
    // 玩家起点靠近道路交叉口，世界坐标本身不再绑定地图原点
    return this.nearestRoadPoint(0, 0, 0);
  }

  updateStreaming(x, z, force = false) {
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    if (!force && this.centerChunk && this.centerChunk.x === cx && this.centerChunk.z === cz) return;
    this.centerChunk = { x: cx, z: cz };
    const wanted = new Set();
    for (let dx = -STREAM_RADIUS; dx <= STREAM_RADIUS; dx++) {
      for (let dz = -STREAM_RADIUS; dz <= STREAM_RADIUS; dz++) {
        const key = `${cx + dx},${cz + dz}`;
        wanted.add(key);
        if (!this.chunks.has(key)) this.loadChunk(cx + dx, cz + dz, key);
      }
    }
    for (const [key, chunk] of this.chunks) {
      if (!wanted.has(key)) this.unloadChunk(key, chunk);
    }
  }

  loadChunk(cx, cz, key = `${cx},${cz}`) {
    const group = new THREE.Group();
    const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;
    group.add(this.makeTerrainChunk(x0, z0));
    group.add(this.makeRoadChunk(x0, z0));
    const trees = this.makeForestChunk(cx, cz);
    if (trees.trunks.count) group.add(trees.trunks, trees.foliages, trees.snowcaps);
    this.scene.add(group);
    for (const tree of trees.list) this.addTreeToGrid(tree);
    this.chunks.set(key, { group, trees: trees.list, cx, cz });
  }

  unloadChunk(key, chunk) {
    this.scene.remove(chunk.group);
    for (const tree of chunk.trees) this.removeTreeFromGrid(tree);
    chunk.group.traverse((o) => {
      if (o.isMesh && o.geometry !== trunkGeo && o.geometry !== foliageGeo && o.geometry !== snowCapGeo) o.geometry.dispose();
    });
    this.chunks.delete(key);
  }

  makeTerrainChunk(x0, z0) {
    const n = CHUNK_SEGMENTS, verts = (n + 1) * (n + 1);
    const pos = new Float32Array(verts * 3), colors = new Float32Array(verts * 3);
    const uvs = new Float32Array(verts * 2);
    const indices = [];
    let v = 0;
    for (let iz = 0; iz <= n; iz++) {
      const z = z0 + (iz / n) * CHUNK_SIZE;
      for (let ix = 0; ix <= n; ix++) {
        const x = x0 + (ix / n) * CHUNK_SIZE;
        const y = this.height(x, z);
        pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
        uvs[v * 2] = x / 6; uvs[v * 2 + 1] = z / 6;
        // 暖白雪面：大尺度明暗起伏 + 细碎噪点，向远处微微偏暖
        const noise = fbm(x * 0.02, z * 0.02);
        const grain = fbm(x * 0.14 + 31, z * 0.14 - 17) * 0.05;
        const value = 0.9 + noise * 0.09 + grain;
        colors[v * 3] = value;
        colors[v * 3 + 1] = value * 0.97;
        colors[v * 3 + 2] = value * 0.93;
        if (ix < n && iz < n) {
          const a = iz * (n + 1) + ix, b = a + 1, c = a + n + 1, d = c + 1;
          indices.push(a, c, b, b, c, d);
        }
        v++;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, terrainMat);
  }

  makeRoadChunk(x0, z0) {
    const positions = [], uvs = [], indices = [];
    const steps = Math.ceil(CHUNK_SIZE / 8);
    const x1 = x0 + CHUNK_SIZE, z1 = z0 + CHUNK_SIZE;
    const addStrip = (vertical, center) => {
      const base = positions.length / 3;
      for (let i = 0; i <= steps; i++) {
        const along = i / steps * CHUNK_SIZE;
        if (vertical) {
          const z = z0 + along;
          positions.push(center - ROAD_HALF, this.hillHeight(center - ROAD_HALF, z) + 0.08, z);
          positions.push(center + ROAD_HALF, this.hillHeight(center + ROAD_HALF, z) + 0.08, z);
        } else {
          const x = x0 + along;
          positions.push(x, this.hillHeight(x, center + ROAD_HALF) + 0.08, center + ROAD_HALF);
          positions.push(x, this.hillHeight(x, center - ROAD_HALF) + 0.08, center - ROAD_HALF);
        }
        uvs.push(0, i * 0.4, 1, i * 0.4);
        if (i < steps) {
          const a = base + i * 2;
          indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      }
    };
    const kx0 = Math.floor((x0 - 32) / ROAD_SPACING), kx1 = Math.ceil((x1 + 32) / ROAD_SPACING);
    const kz0 = Math.floor((z0 - 32) / ROAD_SPACING), kz1 = Math.ceil((z1 + 32) / ROAD_SPACING);
    for (let k = kx0; k <= kx1; k++) {
      const x = trackX(k);
      if (x >= x0 - ROAD_HALF && x <= x1 + ROAD_HALF) addStrip(true, x);
    }
    for (let k = kz0; k <= kz1; k++) {
      const z = trackZ(k);
      if (z >= z0 - ROAD_HALF && z <= z1 + ROAD_HALF) addStrip(false, z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, roadMat);
  }

  makeForestChunk(cx, cz) {
    const count = 108;
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    const foliages = new THREE.InstancedMesh(foliageGeo, foliageMat, count);
    const snowcaps = new THREE.InstancedMesh(snowCapGeo, snowCapMat, count);
    const list = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), scale = new THREE.Vector3();
    const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;
    let attempts = 0;
    while (list.length < count && attempts < count * 12) {
      const i = attempts++;
      const x = x0 + 6 + hash2(cx * 1009 + i, cz * 917 + 17) * (CHUNK_SIZE - 12);
      const z = z0 + 6 + hash2(cx * 613 + i, cz * 1031 + 91) * (CHUNK_SIZE - 12);
      if (this.roadQuery(x, z).dist < 14) continue;
      const y = this.height(x, z);
      if (this.normal(x, z).y < 0.84) continue;
      const s = 0.8 + hash2(i, cx * 31 + cz) * 1.7;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash2(i, cz * 19 + cx) * Math.PI * 2);
      scale.set(s, s * (0.85 + hash2(i, 71) * 0.5), s);
      m.compose(new THREE.Vector3(x, y - 0.2, z), q, scale);
      const index = list.length;
      trunks.setMatrixAt(index, m);
      foliages.setMatrixAt(index, m);
      snowcaps.setMatrixAt(index, m);
      list.push({ x, z, r: 0.45 * s + 0.35, chunkKey: `${cx},${cz}` });
    }
    trunks.count = list.length;
    foliages.count = list.length;
    snowcaps.count = list.length;
    trunks.instanceMatrix.needsUpdate = true;
    foliages.instanceMatrix.needsUpdate = true;
    snowcaps.instanceMatrix.needsUpdate = true;
    return { trunks, foliages, snowcaps, list };
  }

  addTreeToGrid(tree) {
    const key = `${Math.floor(tree.x / TREE_CELL)},${Math.floor(tree.z / TREE_CELL)}`;
    if (!this.treeGrid.has(key)) this.treeGrid.set(key, []);
    this.treeGrid.get(key).push(tree);
  }

  removeTreeFromGrid(tree) {
    const key = `${Math.floor(tree.x / TREE_CELL)},${Math.floor(tree.z / TREE_CELL)}`;
    const bucket = this.treeGrid.get(key);
    if (!bucket) return;
    const i = bucket.indexOf(tree);
    if (i >= 0) bucket.splice(i, 1);
    if (!bucket.length) this.treeGrid.delete(key);
  }

  treesNear(x, z, radius) {
    const res = [];
    const cell = this.gridCell;
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell), rr = Math.ceil(radius / cell);
    for (let dx = -rr; dx <= rr; dx++) {
      for (let dz = -rr; dz <= rr; dz++) {
        const bucket = this.treeGrid.get(`${cx + dx},${cz + dz}`);
        if (bucket) res.push(...bucket);
      }
    }
    return res;
  }

  buildSnowfall() {
    const count = 5200;
    this.snowCount = count;
    const positions = new Float32Array(count * 3), speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 160;
      positions[i * 3 + 1] = Math.random() * 60;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 160;
      speeds[i] = 6 + Math.random() * 8;
    }
    this.snowSpd = speeds;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.snow = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xfff1de, size: 0.42, map: makeFlakeTexture(), transparent: true, opacity: 0.85,
      depthWrite: false, sizeAttenuation: true,
    }));
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);
  }

  updateSnow(dt, camPos) {
    this.sky.position.set(camPos.x, 0, camPos.z);
    const attr = this.snow.geometry.attributes.position, arr = attr.array;
    const wind = 9;
    for (let i = 0; i < this.snowCount; i++) {
      const k = i * 3;
      arr[k] += wind * dt;
      arr[k + 1] -= this.snowSpd[i] * dt;
      arr[k + 2] += Math.sin(performance.now() * 0.001 + i) * dt * 1.5;
      if (arr[k + 1] < camPos.y - 4) arr[k + 1] = camPos.y + 42 + Math.random() * 14;
      if (arr[k] < camPos.x - 80) arr[k] += 160;
      if (arr[k] > camPos.x + 80) arr[k] -= 160;
      if (arr[k + 2] < camPos.z - 80) arr[k + 2] += 160;
      if (arr[k + 2] > camPos.z + 80) arr[k + 2] -= 160;
    }
    attr.needsUpdate = true;
  }
}

function makeFlakeTexture() {
  // 柔边圆形雪片贴图，避免生硬的方块粒子
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,250,240,0.7)');
  grad.addColorStop(1, 'rgba(255,250,240,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

function makeRoadTexture() {
  // 积雪压实路面：暖白雪底 + 两条深色车辙 + 路缘亮雪垄，无车道线
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#cfc3b0';
  g.fillRect(0, 0, 256, 256);

  // 压实雪面的细碎色斑
  for (let i = 0; i < 2400; i++) {
    const v = 150 + Math.random() * 100;
    g.fillStyle = `rgba(${v},${v - 4 + Math.random() * 8},${v - 10},${0.05 + Math.random() * 0.12})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 2.5, 1.4 + Math.random() * 2);
  }

  // 车辙：两道沿行车方向（v）延伸的深色压痕，边缘柔和
  const rut = (cx, w, alpha) => {
    const grad = g.createLinearGradient(cx - w, 0, cx + w, 0);
    grad.addColorStop(0, 'rgba(78,74,88,0)');
    grad.addColorStop(0.32, `rgba(78,74,88,${alpha})`);
    grad.addColorStop(0.68, `rgba(78,74,88,${alpha})`);
    grad.addColorStop(1, 'rgba(78,74,88,0)');
    g.fillStyle = grad;
    g.fillRect(cx - w, 0, w * 2, 256);
  };
  rut(74, 19, 0.78);
  rut(182, 19, 0.78);
  // 车辙芯部更深、更窄
  rut(74, 7, 0.62);
  rut(182, 7, 0.62);

  // 中央与两侧被雪重新覆盖的浅色带
  const snowBand = (cx, w, alpha) => {
    const grad = g.createLinearGradient(cx - w, 0, cx + w, 0);
    grad.addColorStop(0, 'rgba(238,230,216,0)');
    grad.addColorStop(0.5, `rgba(238,230,216,${alpha})`);
    grad.addColorStop(1, 'rgba(238,230,216,0)');
    g.fillStyle = grad;
    g.fillRect(cx - w, 0, w * 2, 256);
  };
  snowBand(128, 26, 0.4);
  snowBand(6, 14, 0.75);
  snowBand(250, 14, 0.75);

  // 横向断续的雪痕/裂纹，打破平直感
  for (let i = 0; i < 90; i++) {
    const y = Math.random() * 256, x = Math.random() * 256;
    g.strokeStyle = `rgba(${120 + Math.random() * 60},${112 + Math.random() * 50},${104 + Math.random() * 40},${0.08 + Math.random() * 0.12})`;
    g.lineWidth = 1 + Math.random() * 2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (Math.random() - 0.5) * 34, y + (Math.random() - 0.5) * 7);
    g.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function makeSnowTexture() {
  // 雪面风蚀波纹 + 亮斑，随地形平铺（与顶点色相乘）
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f0ebe2';
  g.fillRect(0, 0, 256, 256);

  // 风向一致的波纹起伏
  for (let i = 0; i < 110; i++) {
    const y0 = Math.random() * 256;
    const amp = 1.5 + Math.random() * 3.5;
    const wl = 60 + Math.random() * 130;
    const shade = Math.random() < 0.5 ? 190 : 235;
    g.strokeStyle = `rgba(${shade},${shade - 6},${shade - 16},${0.05 + Math.random() * 0.09})`;
    g.lineWidth = 1.5 + Math.random() * 3;
    g.beginPath();
    for (let x = 0; x <= 256; x += 8) {
      const y = y0 + Math.sin((x / wl) * Math.PI * 2 + i) * amp;
      x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
  }
  // 细碎噪点与雪晶亮斑
  for (let i = 0; i < 1600; i++) {
    const a = 0.04 + Math.random() * 0.1;
    g.fillStyle = Math.random() < 0.5
      ? `rgba(200,192,180,${a})`
      : `rgba(255,252,246,${a})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}
