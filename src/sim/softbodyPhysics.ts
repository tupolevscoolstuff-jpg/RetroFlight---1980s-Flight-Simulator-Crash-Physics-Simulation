import * as THREE from 'three';
import {LoadedAircraftRig} from './ac3dLoader';
import {ObstacleBox} from './dfwScenery';
import {BreakablePartInfo, EmergencyState, StructuralZoneHealth} from './types';

interface StructuralNode {
  id: string;
  zone: keyof StructuralZoneHealth;
  restPos: THREE.Vector3;
  fractureStress: number;
  damage: number; // 0..1
  pieceKeys: string[];
}

interface DebrisBody {
  key: string;
  zone: keyof StructuralZoneHealth;
  group: THREE.Object3D;
  origParent: THREE.Object3D;
  origPos: THREE.Vector3;
  origRot: THREE.Euler;
  localCom: THREE.Vector3;
  vel: THREE.Vector3;
  angVel: THREE.Vector3;
  detached: boolean;
  label: string;
  minRadius: number;
  fractureThreshold: number;
  impactCooldown: number;
}

interface ShrapnelBit {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  quat: THREE.Quaternion;
  angVel: THREE.Vector3;
  scale: THREE.Vector3;
  life: number;
}

interface BirdInstance {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  phase: number;
  hitDone: boolean;
}

interface Particle {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  initialSize: number;
  growth: number;
  rot: number;
  rotVel: number;
  turbulence: number;
  hasCustomColor: boolean;
  color: THREE.Color;
  kind: 'smoke' | 'fire' | 'spark' | 'dust';
}

interface ExplosionBlast {
  active: boolean;
  life: number;
  maxLife: number;
  maxRadius: number;
  origin: THREE.Vector3;
  vel: THREE.Vector3;
  fireballMesh: THREE.Mesh;
  fireballMat: THREE.ShaderMaterial;
  shockwaveMesh: THREE.Mesh;
  shockwaveMat: THREE.ShaderMaterial;
}

export interface SoftbodyStepContext {
  dt: number;
  aircraftWorldPos: THREE.Vector3;
  aircraftQuat: THREE.Quaternion;
  aircraftVel: THREE.Vector3;
  aircraftAngVel: THREE.Vector3;
  liftLoadFactor: number;
  onRunway: boolean;
  groundElevation: number;
  obstacles: ObstacleBox[];
  gearDown: boolean;
  gearCollapsed: boolean;
  gearContacts?: number;
  emergencies: EmergencyState;
  windVel?: THREE.Vector3;
}

export interface SoftbodyStepResult {
  totalImpulse: THREE.Vector3;
  angularImpulse: THREE.Vector3;
  groundContacts: number;
  scraping: boolean;
  scrapeIntensity: number;
  hardImpactG: number;
  secondaryImpactIntensity: number;
  partDetachedThisStep: boolean;
  collapseGear: boolean;
  crashed: boolean;
  crashReason: string;
  integrityPercent: number;
  zones: StructuralZoneHealth;
  detachedParts: string[];
  fragmentCount: number;
}

function createSmokePuffTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 128);

  // Multi-lobe turbulent volumetric cloud puff
  const lobes: Array<[number, number, number, number]> = [
    [64, 64, 44, 0.55],
    [48, 56, 32, 0.45],
    [80, 58, 30, 0.44],
    [54, 78, 30, 0.42],
    [76, 76, 28, 0.40],
    [62, 44, 26, 0.36],
  ];
  for (const [cx, cy, r, a] of lobes) {
    const grad = ctx.createRadialGradient(cx, cy, r * 0.12, cx, cy, r);
    grad.addColorStop(0, `rgba(255,255,255,${a})`);
    grad.addColorStop(0.55, `rgba(240,242,245,${a * 0.55})`);
    grad.addColorStop(1, 'rgba(220,225,230,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createFlameCoreTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 128);

  // Intense white-hot inner flame core with organic multi-layered corona
  const corona = ctx.createRadialGradient(64, 64, 4, 64, 64, 58);
  corona.addColorStop(0, 'rgba(255,255,255,1)');
  corona.addColorStop(0.24, 'rgba(255,250,235,0.88)');
  corona.addColorStop(0.56, 'rgba(255,220,175,0.34)');
  corona.addColorStop(1, 'rgba(255,140,60,0)');
  ctx.fillStyle = corona;
  ctx.fillRect(0, 0, 128, 128);

  const wisps: Array<[number, number, number]> = [
    [54, 52, 24],
    [74, 55, 22],
    [60, 74, 24],
    [72, 72, 20],
  ];
  for (const [cx, cy, r] of wisps) {
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, r);
    g.addColorStop(0, 'rgba(255,245,220,0.45)');
    g.addColorStop(1, 'rgba(255,180,90,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createSmokeShaderMaterial(tex: THREE.CanvasTexture, pixelScale: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTexture: {value: tex},
      uPixelScale: {value: pixelScale},
    },
    vertexShader: `
      attribute vec3 aColor;
      attribute vec4 aAlphaSizeRot;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vRot;
      uniform float uPixelScale;
      void main() {
        vColor = aColor;
        vAlpha = aAlphaSizeRot.x;
        vRot = aAlphaSizeRot.z;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float dist = max(0.8, -mvPosition.z);
        gl_PointSize = clamp(aAlphaSizeRot.y * (uPixelScale / dist), 1.5, 420.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D uTexture;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vRot;
      void main() {
        vec2 uv = gl_PointCoord - vec2(0.5);
        float c = cos(vRot);
        float s = sin(vRot);
        vec2 ruv = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c) + vec2(0.5);
        if (ruv.x < 0.0 || ruv.x > 1.0 || ruv.y < 0.0 || ruv.y > 1.0) discard;
        vec4 tex = texture2D(uTexture, ruv);
        float alpha = tex.a * vAlpha;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(vColor * tex.rgb, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
}

function createFireShaderMaterial(tex: THREE.CanvasTexture, pixelScale: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTexture: {value: tex},
      uPixelScale: {value: pixelScale},
      uTime: {value: 0},
    },
    vertexShader: `
      attribute vec3 aColor;
      attribute vec4 aAlphaSizeRot;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vRot;
      varying float vKindBias;
      uniform float uPixelScale;
      void main() {
        vColor = aColor;
        vAlpha = aAlphaSizeRot.x;
        vRot = aAlphaSizeRot.z;
        vKindBias = aAlphaSizeRot.w;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float dist = max(0.8, -mvPosition.z);
        gl_PointSize = clamp(aAlphaSizeRot.y * (uPixelScale / dist), 1.5, 360.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D uTexture;
      uniform float uTime;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vRot;
      varying float vKindBias;
      void main() {
        vec2 uv = gl_PointCoord - vec2(0.5);
        float c = cos(vRot);
        float s = sin(vRot);
        vec2 ruv = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);
        if (vKindBias < 0.5) {
          float dist = length(ruv);
          float ang = atan(ruv.y, ruv.x);
          vec2 dir = dist > 0.0001 ? ruv / dist : vec2(0.0, 1.0);
          ruv += dir * (sin(ang * 3.0 + uTime * 11.0 + vRot * 5.0) * 0.055 * smoothstep(0.05, 0.45, dist));
        }
        vec2 suv = ruv + vec2(0.5);
        if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) discard;
        vec4 tex = texture2D(uTexture, suv);
        float mask = vKindBias >= 0.5 ? pow(tex.a, 1.85) : tex.a;
        float alpha = mask * vAlpha;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(vColor * tex.rgb * alpha, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function createExplosionFireballMaterial(seed: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uProgress: {value: 0},
      uSeed: {value: seed},
    },
    vertexShader: `
      uniform float uProgress;
      uniform float uSeed;
      varying vec3 vNormalDir;
      varying vec3 vViewDir;
      varying vec3 vLocalPos;
      void main() {
        vLocalPos = position;
        float t = uProgress * 6.0 + uSeed;
        float billow = sin(position.x * 4.5 + t) * cos(position.y * 5.1 - t * 0.8) * sin(position.z * 4.7 + t * 0.6);
        vec3 displaced = position + normal * (billow * (0.14 + uProgress * 0.16));
        vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
        vNormalDir = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform float uProgress;
      uniform float uSeed;
      varying vec3 vNormalDir;
      varying vec3 vViewDir;
      varying vec3 vLocalPos;
      void main() {
        vec3 p = vLocalPos * 3.4 + vec3(uSeed, uProgress * 2.5, -uSeed * 0.7);
        float n1 = sin(p.x + sin(p.y * 1.4)) * cos(p.z + cos(p.x * 1.2));
        float n2 = sin(p.y * 2.3 + n1 * 2.1) * cos(p.x * 2.1 - p.z * 1.9);
        float turb = clamp(0.5 + 0.35 * n1 + 0.25 * n2, 0.0, 1.0);

        float fresnel = pow(clamp(abs(dot(normalize(vNormalDir), normalize(vViewDir))), 0.0, 1.0), 0.7);
        float dissolve = smoothstep(uProgress * 0.92, uProgress * 0.92 + 0.28, turb + fresnel * 0.35);
        float lifeFade = (1.0 - smoothstep(0.45, 1.0, uProgress)) * dissolve * fresnel;
        if (lifeFade < 0.015) discard;

        vec3 hotCore = vec3(1.0, 0.96, 0.80);
        vec3 midFlame = vec3(1.0, 0.44, 0.06);
        vec3 deepEmber = vec3(0.75, 0.12, 0.02);
        vec3 col = mix(hotCore, midFlame, smoothstep(0.05, 0.48, uProgress + (1.0 - turb) * 0.25));
        col = mix(col, deepEmber, smoothstep(0.42, 0.92, uProgress + (1.0 - turb) * 0.2));

        gl_FragColor = vec4(col * (1.25 - uProgress * 0.4), lifeFade * 0.92);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function createShockwaveMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uProgress: {value: 0},
    },
    vertexShader: `
      varying vec3 vLocalPos;
      void main() {
        vLocalPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uProgress;
      varying vec3 vLocalPos;
      void main() {
        float r = length(vLocalPos.xz);
        float band = smoothstep(0.62, 0.84, r) * (1.0 - smoothstep(0.86, 1.0, r));
        float alpha = band * pow(1.0 - uProgress, 1.35) * 0.72;
        if (alpha < 0.01) discard;
        vec3 waveCol = mix(vec3(1.0, 0.86, 0.56), vec3(0.72, 0.56, 0.42), smoothstep(0.0, 0.55, uProgress));
        gl_FragColor = vec4(waveCol, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
}

function createJaggedShardGeometry(): THREE.BufferGeometry {
  // Asymmetric torn aluminum skin / structural rib shard
  const geo = new THREE.BoxGeometry(0.48, 0.08, 0.34, 1, 1, 1);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const skew = Math.sin(x * 7.1 + z * 5.3) * 0.12;
    pos.setXYZ(i, x * (0.85 + Math.abs(skew)), y + skew * 0.35, z * (0.8 + (i % 3) * 0.12));
  }
  geo.computeVertexNormals();
  return geo;
}

export class SoftbodyCrashEngine {
  private rig: LoadedAircraftRig;
  private scene: THREE.Scene;
  private nodes: StructuralNode[] = [];
  private debris: Map<string, DebrisBody> = new Map();
  private engineKeys: string[] = [];
  private gearKeys: string[] = [];

  // Dual GPU shader-driven particle layers: volumetric smoke/dust & additive fire/sparks
  private maxSmoke = 840;
  private smokePool: Particle[] = [];
  private nextSmokeIdx = 0;
  private smokeGeo: THREE.BufferGeometry;
  private smokeMat: THREE.ShaderMaterial;
  private smokePoints: THREE.Points;
  private smokeTex: THREE.CanvasTexture;

  private maxFire = 560;
  private firePool: Particle[] = [];
  private nextFireIdx = 0;
  private fireGeo: THREE.BufferGeometry;
  private fireMat: THREE.ShaderMaterial;
  private firePoints: THREE.Points;
  private fireTex: THREE.CanvasTexture;

  // Volumetric 3D Impact Explosion Fireballs & Ground Shockwave Rings
  private maxExplosions = 4;
  private explosions: ExplosionBlast[] = [];
  private nextExplosionIdx = 0;
  private explosionSphereGeo: THREE.BufferGeometry;
  private shockwaveRingGeo: THREE.BufferGeometry;
  private explosionFlash = 0;
  private explosionFlashPos = new THREE.Vector3();

  private fireLight: THREE.PointLight;
  private particleClock = 0;
  private activeEngineFires: boolean[] = [false, false, false, false];

  // High-speed instanced tiny rigid shrapnel fragments (force-driven!)
  private maxShrapnel = 220;
  private shrapnel: ShrapnelBit[] = [];
  private nextShrapnelIdx = 0;
  private shrapnelGeo: THREE.BufferGeometry;
  private shrapnelMat: THREE.MeshStandardMaterial;
  private shrapnelMesh: THREE.InstancedMesh;
  public activeShrapnelCount = 0;

  // Animated 3D Bird Flock for Bird Strike emergency
  private birds: BirdInstance[] = [];
  private birdGeo: THREE.BufferGeometry;
  private birdMat: THREE.MeshStandardMaterial;
  private birdMesh: THREE.InstancedMesh;

  private fireEmitterTimer = 0;
  private emergencyEmitterTimer = 0;
  private massScale = 1.0;
  private airborneAfterContactTimer = 0;
  private impactBurstCooldown = 0;
  private scrapeBreakAccum = 0;
  private scrapeBreakCooldown = 0;
  private scrapePhase = 0;
  private _primaryImpactPt = new THREE.Vector3();
  private _hitZones = new Set<keyof StructuralZoneHealth>();

  // Scratch vectors & matrices (zero GC in loop)
  private _worldPt = new THREE.Vector3();
  private _localPt = new THREE.Vector3();
  private _relVel = new THREE.Vector3();
  private _totalForce = new THREE.Vector3();
  private _totalTorque = new THREE.Vector3();
  private _rVec = new THREE.Vector3();
  private _tmpVec = new THREE.Vector3();
  private _tmpNorm = new THREE.Vector3();
  private _emitSubPos = new THREE.Vector3();
  private _emitSubVel = new THREE.Vector3();
  private _exhaustDir = new THREE.Vector3();
  private _lightSum = new THREE.Vector3();
  private _groundNorm = new THREE.Vector3(0, 1, 0);
  private _worldPos = new THREE.Vector3();
  private _worldQuat = new THREE.Quaternion();
  private _dummyMat = new THREE.Matrix4();
  private _dummyEuler = new THREE.Euler();
  private _dummyQuat = new THREE.Quaternion();
  private _zeroScale = new THREE.Vector3(0, 0, 0);

  public crashed = false;
  public crashReason = '';
  public peakG = 1.0;

  constructor(rig: LoadedAircraftRig, scene: THREE.Scene) {
    this.rig = rig;
    this.scene = scene;
    this.massScale = Math.max(0.014, rig.spec.flight.massKg / 76000);

    this.initDebris();
    this.initNodes();

    const makePool = (count: number, kind: Particle['kind'], target: Particle[]) => {
      for (let i = 0; i < count; i++) {
        target.push({
          active: false,
          pos: new THREE.Vector3(0, -999, 0),
          vel: new THREE.Vector3(),
          life: 0,
          maxLife: 1,
          initialSize: 1,
          growth: 1,
          rot: 0,
          rotVel: 0,
          turbulence: 1,
          hasCustomColor: false,
          color: new THREE.Color(1, 1, 1),
          kind,
        });
      }
    };
    makePool(this.maxSmoke, 'smoke', this.smokePool);
    makePool(this.maxFire, 'fire', this.firePool);

    const pixelScale = Math.max(320, (typeof window !== 'undefined' ? window.innerHeight : 900) * 0.94);

    // Volumetric Smoke & Dust Layer
    this.smokeTex = createSmokePuffTexture();
    this.smokeGeo = new THREE.BufferGeometry();
    const smokePos = new Float32Array(this.maxSmoke * 3);
    const smokeCol = new Float32Array(this.maxSmoke * 3);
    const smokeAttr = new Float32Array(this.maxSmoke * 4);
    smokePos.fill(-999);
    smokeCol.fill(1);
    this.smokeGeo.setAttribute('position', new THREE.BufferAttribute(smokePos, 3));
    this.smokeGeo.setAttribute('aColor', new THREE.BufferAttribute(smokeCol, 3));
    this.smokeGeo.setAttribute('aAlphaSizeRot', new THREE.BufferAttribute(smokeAttr, 4));
    this.smokeMat = createSmokeShaderMaterial(this.smokeTex, pixelScale);
    this.smokePoints = new THREE.Points(this.smokeGeo, this.smokeMat);
    this.smokePoints.frustumCulled = false;
    this.smokePoints.renderOrder = 2;
    this.scene.add(this.smokePoints);

    // Additive Fire & Sparks Layer
    this.fireTex = createFlameCoreTexture();
    this.fireGeo = new THREE.BufferGeometry();
    const firePos = new Float32Array(this.maxFire * 3);
    const fireCol = new Float32Array(this.maxFire * 3);
    const fireAttr = new Float32Array(this.maxFire * 4);
    firePos.fill(-999);
    fireCol.fill(1);
    this.fireGeo.setAttribute('position', new THREE.BufferAttribute(firePos, 3));
    this.fireGeo.setAttribute('aColor', new THREE.BufferAttribute(fireCol, 3));
    this.fireGeo.setAttribute('aAlphaSizeRot', new THREE.BufferAttribute(fireAttr, 4));
    this.fireMat = createFireShaderMaterial(this.fireTex, pixelScale);
    this.firePoints = new THREE.Points(this.fireGeo, this.fireMat);
    this.firePoints.frustumCulled = false;
    this.firePoints.renderOrder = 3;
    this.scene.add(this.firePoints);

    // Dynamic Flickering Fire Light illuminating wings, fuselage, runway & smoke
    this.fireLight = new THREE.PointLight(0xff7722, 0, 110, 1.45);
    this.scene.add(this.fireLight);

    // Pre-allocated 3D Explosion Fireball & Shockwave Ring Pool
    this.explosionSphereGeo = new THREE.IcosahedronGeometry(1, 3);
    this.shockwaveRingGeo = new THREE.RingGeometry(0.62, 1.0, 48);
    this.shockwaveRingGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < this.maxExplosions; i++) {
      const fireballMat = createExplosionFireballMaterial(i * 3.7 + 1.1);
      const fireballMesh = new THREE.Mesh(this.explosionSphereGeo, fireballMat);
      fireballMesh.visible = false;
      fireballMesh.frustumCulled = false;
      fireballMesh.renderOrder = 4;
      this.scene.add(fireballMesh);

      const shockwaveMat = createShockwaveMaterial();
      const shockwaveMesh = new THREE.Mesh(this.shockwaveRingGeo, shockwaveMat);
      shockwaveMesh.visible = false;
      shockwaveMesh.frustumCulled = false;
      shockwaveMesh.renderOrder = 1;
      this.scene.add(shockwaveMesh);

      this.explosions.push({
        active: false,
        life: 0,
        maxLife: 0.9,
        maxRadius: 12,
        origin: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        fireballMesh,
        fireballMat,
        shockwaveMesh,
        shockwaveMat,
      });
    }

    // Instanced Tiny Jagged Rigid Debris Bits
    this.shrapnelGeo = createJaggedShardGeometry();
    this.shrapnelMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.45,
      metalness: 0.65,
    });
    this.shrapnelMesh = new THREE.InstancedMesh(this.shrapnelGeo, this.shrapnelMat, this.maxShrapnel);
    this.shrapnelMesh.frustumCulled = false;
    this.shrapnelMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const accentHex = this.rig.spec.liveries[0]?.accentHex ?? '#c8102e';
    const palette = [
      new THREE.Color(0xdde3eb), // Aluminum skin
      new THREE.Color(0x94a3b8), // Titanium / rib
      new THREE.Color(0x272c35), // Charred panel
      new THREE.Color(accentHex), // Airline livery accent
      new THREE.Color(0xf1f5f9), // White fuselage panel
    ];
    for (let i = 0; i < this.maxShrapnel; i++) {
      this.shrapnel.push({
        active: false,
        pos: new THREE.Vector3(0, -500, 0),
        vel: new THREE.Vector3(),
        quat: new THREE.Quaternion(),
        angVel: new THREE.Vector3(),
        scale: new THREE.Vector3(1, 1, 1),
        life: 0,
      });
      this._dummyMat.compose(this.shrapnel[i].pos, this.shrapnel[i].quat, this._zeroScale);
      this.shrapnelMesh.setMatrixAt(i, this._dummyMat);
      this.shrapnelMesh.setColorAt(i, palette[i % palette.length]);
    }
    this.shrapnelMesh.instanceMatrix.needsUpdate = true;
    if (this.shrapnelMesh.instanceColor) this.shrapnelMesh.instanceColor.needsUpdate = true;
    this.scene.add(this.shrapnelMesh);

    // Animated 3D Bird Flock (12 birds)
    this.birdGeo = new THREE.ConeGeometry(0.18, 0.72, 4);
    this.birdGeo.rotateX(-Math.PI / 2);
    this.birdMat = new THREE.MeshStandardMaterial({color: 0x3b3532, roughness: 0.85, metalness: 0.05});
    this.birdMesh = new THREE.InstancedMesh(this.birdGeo, this.birdMat, 12);
    this.birdMesh.frustumCulled = false;
    for (let i = 0; i < 12; i++) {
      this.birds.push({
        active: false,
        pos: new THREE.Vector3(0, -500, 0),
        vel: new THREE.Vector3(),
        phase: i * 0.6,
        hitDone: false,
      });
      this._dummyMat.compose(this.birds[i].pos, this._dummyQuat, this._zeroScale);
      this.birdMesh.setMatrixAt(i, this._dummyMat);
    }
    this.birdMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.birdMesh);
  }

  private initDebris() {
    const tmpBox = new THREE.Box3();
    const tmpCenter = new THREE.Vector3();

    const add = (
      key: string,
      zone: keyof StructuralZoneHealth,
      group: THREE.Object3D,
      label: string,
      minRadius = 0.45,
      fractureThreshold = 0.55,
    ) => {
      if (group.children.length === 0 || !group.parent) return;
      group.updateMatrixWorld(true);
      tmpBox.setFromObject(group);
      if (!tmpBox.isEmpty()) {
        tmpBox.getCenter(tmpCenter);
        group.worldToLocal(tmpCenter);
      } else {
        tmpCenter.set(0, 0, 0);
      }
      this.debris.set(key, {
        key,
        zone,
        group,
        origParent: group.parent,
        origPos: group.position.clone(),
        origRot: group.rotation.clone(),
        localCom: tmpCenter.clone(),
        vel: new THREE.Vector3(),
        angVel: new THREE.Vector3(),
        detached: false,
        label,
        minRadius,
        fractureThreshold,
        impactCooldown: 0,
      });
    };

    // Register granular wing/fuselage sub-chunks first!
    for (const sp of this.rig.subPieces) {
      add(sp.key, sp.zone, sp.group, sp.label, 0.42, sp.fractureThreshold);
    }

    add('leftWing', 'leftWing', this.rig.leftWingGroup, 'Port Main Wing', 0.75, 0.62);
    add('rightWing', 'rightWing', this.rig.rightWingGroup, 'Starboard Main Wing', 0.75, 0.62);
    add('tail', 'tail', this.rig.tailGroup, 'Vertical Stabilizer & Tail Fin', 0.7, 0.52);
    add('leftHStab', 'tail', this.rig.leftHStabGroup, 'Port Horizontal Stabilizer', 0.4, 0.44);
    add('rightHStab', 'tail', this.rig.rightHStabGroup, 'Starboard Horizontal Stabilizer', 0.4, 0.44);
    add('noseCone', 'nose', this.rig.noseGroup, 'Radome Nose Section', 0.5, 0.48);
    add('aftFuselage', 'fuselage', this.rig.aftFuselageGroup, 'Aft Fuselage Section', 0.65, 0.64);

    this.engineKeys = [];
    if (this.rig.enginePods.length > 0) {
      this.rig.enginePods.forEach((pod, idx) => {
        const key = `enginePod_${idx}`;
        add(key, 'engines', pod.group, pod.label, 0.45, 0.42);
        if (this.debris.has(key)) this.engineKeys.push(key);
      });
    } else {
      add('engines', 'engines', this.rig.enginesGroup, this.rig.spec.flight.engineLabel, 0.55, 0.48);
      if (this.debris.has('engines')) this.engineKeys.push('engines');
    }

    this.gearKeys = [];
    add('noseGear', 'gear', this.rig.noseGearGroup, 'Nose Landing Gear', 0.32, 0.45);
    add('leftGear', 'gear', this.rig.leftGearGroup, 'Port Main Landing Gear', 0.36, 0.45);
    add('rightGear', 'gear', this.rig.rightGearGroup, 'Starboard Main Landing Gear', 0.36, 0.45);
    for (const gk of ['noseGear', 'leftGear', 'rightGear']) {
      if (this.debris.has(gk)) this.gearKeys.push(gk);
    }

    // Tag all exterior meshes with their narrowest owning debris key for interactive Break-Off raycasting!
    const tagGroupMeshes = (key: string, label: string, group: THREE.Object3D, overwrite: boolean) => {
      group.traverse((obj) => {
        if (obj === this.rig.cockpitRig.group) return;
        let cur: THREE.Object3D | null = obj.parent;
        while (cur) {
          if (cur === this.rig.cockpitRig.group) return;
          cur = cur.parent;
        }
        if ((obj as THREE.Mesh).isMesh) {
          if (overwrite || !obj.userData.debrisKey) {
            obj.userData.debrisKey = key;
            obj.userData.debrisLabel = label;
          }
        }
      });
    };

    // Pass 1: broader parent groups (leftWing, rightWing, tail, etc.)
    this.debris.forEach((d) => {
      if (!d.key.includes('_s') && !d.key.startsWith('fuse_') && !d.key.startsWith('enginePod_')) {
        tagGroupMeshes(d.key, d.label, d.group, false);
      }
    });
    // Pass 2: finer granular sub-pieces, engine pods, and gears overwrite their own meshes
    this.debris.forEach((d) => {
      if (d.key.includes('_s') || d.key.startsWith('fuse_') || d.key.startsWith('enginePod_')) {
        tagGroupMeshes(d.key, d.label, d.group, true);
      }
    });
  }

  private initNodes() {
    const f = this.rig.spec.flight;
    const hl = f.lengthM * 0.48;
    const hs = f.wingspanM * 0.48;
    const h = f.heightM;
    const fallbackBellyY = Math.max(0.45, h * 0.145);
    const fallbackCrownY = fallbackBellyY + Math.max(1.1, h * 0.24);
    const fallbackWingY = Math.max(0.7, h * 0.22);

    this.rig.airframeGroup.updateMatrixWorld(true);
    const invAirframe = new THREE.Matrix4().copy(this.rig.airframeGroup.matrixWorld).invert();
    const toAirframe = new THREE.Matrix4();
    const vTmp = new THREE.Vector3();

    const skipSet = new Set<THREE.Object3D>([
      this.rig.cockpitRig.group,
      this.rig.noseGearGroup,
      this.rig.leftGearGroup,
      this.rig.rightGearGroup,
      this.rig.enginesGroup,
      ...this.rig.gearMeshes,
      ...this.rig.openGearDoorMeshes,
      ...this.rig.closedGearDoorMeshes,
      ...this.rig.wheelMeshes,
      ...this.rig.strobeLights,
      ...this.rig.beaconLights,
      this.rig.landingLightBeam,
    ]);

    const visitGroupVertices = (
      group: THREE.Object3D,
      skip: Set<THREE.Object3D>,
      cb: (vx: number, vy: number, vz: number) => void,
    ) => {
      if (skip.has(group)) return;
      const mesh = group as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry) {
        const posAttr = mesh.geometry.attributes.position as THREE.BufferAttribute | undefined;
        if (posAttr) {
          toAirframe.multiplyMatrices(invAirframe, mesh.matrixWorld);
          for (let i = 0; i < posAttr.count; i++) {
            vTmp.fromBufferAttribute(posAttr, i).applyMatrix4(toAirframe);
            cb(vTmp.x, vTmp.y, vTmp.z);
          }
        }
      }
      for (let i = 0; i < group.children.length; i++) {
        visitGroupVertices(group.children[i], skip, cb);
      }
    };

    const mainGearZ = this.rig.gearContactPoints
      ? (this.rig.gearContactPoints.left.z + this.rig.gearContactPoints.right.z) * 0.5
      : f.gearWheelbaseM * 0.38;
    const coreHalfW = Math.max(1.25, f.wingspanM * 0.11);

    // Pass 1: Measure fuselage centerline bounds
    let fuseMinZ = Infinity;
    let fuseMaxZ = -Infinity;
    let noseTipX = 0;
    let noseTipY = fallbackBellyY + h * 0.08;
    let noseTipZ = -hl;
    let midMinY = Infinity;
    let midMaxY = -Infinity;

    const fuseGroups: THREE.Object3D[] = [
      this.rig.noseGroup,
      this.rig.fuselageGroup,
      this.rig.aftFuselageGroup,
    ];
    for (const fg of fuseGroups) {
      visitGroupVertices(fg, skipSet, (vx, vy, vz) => {
        if (Math.abs(vx) > coreHalfW) return;
        if (vz < fuseMinZ) {
          fuseMinZ = vz;
          noseTipX = vx;
          noseTipY = vy;
          noseTipZ = vz;
        }
        if (vz > fuseMaxZ) fuseMaxZ = vz;
        if (Math.abs(vz) < f.lengthM * 0.25) {
          if (vy < midMinY) midMinY = vy;
          if (vy > midMaxY) midMaxY = vy;
        }
      });
    }

    if (!Number.isFinite(fuseMinZ)) fuseMinZ = -hl;
    if (!Number.isFinite(fuseMaxZ)) fuseMaxZ = hl;
    if (!Number.isFinite(midMinY)) midMinY = fallbackBellyY;
    if (!Number.isFinite(midMaxY)) midMaxY = fallbackCrownY;

    const fuseLen = Math.max(4, fuseMaxZ - fuseMinZ);
    const bellyRoofCutoff = midMaxY + 0.25 * Math.max(0.5, h - midMaxY);

    let cockpitPos = new THREE.Vector3(0, midMinY + h * 0.14, fuseMinZ + fuseLen * 0.14);
    let cockpitMinY = Infinity;
    let fwdBellyPos = new THREE.Vector3(0, midMinY, fuseMinZ + fuseLen * 0.32);
    let fwdBellyMinY = Infinity;
    let midBellyPos = new THREE.Vector3(0, midMinY, mainGearZ);
    let midBellyMinY = Infinity;
    let fwdTopPos = new THREE.Vector3(0, midMaxY, fuseMinZ + fuseLen * 0.26);
    let fwdTopMaxY = -Infinity;
    let midTopPos = new THREE.Vector3(0, midMaxY, 0);
    let midTopMaxY = -Infinity;
    let aftTopPos = new THREE.Vector3(0, midMaxY, fuseMinZ + fuseLen * 0.78);
    let aftTopMaxY = -Infinity;

    // 8 aft-fuselage Z-bins behind main gear to resolve exact upsweep tailstrike curve
    const AFT_BINS = 8;
    const aftStartZ = mainGearZ + Math.max(0.8, fuseLen * 0.04);
    const aftSpanZ = Math.max(1.5, fuseMaxZ - aftStartZ);
    const aftBinMinY = new Array<number>(AFT_BINS).fill(Infinity);
    const aftBinX = new Array<number>(AFT_BINS).fill(0);
    const aftBinZ = new Array<number>(AFT_BINS).fill(aftStartZ);

    for (const fg of fuseGroups) {
      visitGroupVertices(fg, skipSet, (vx, vy, vz) => {
        if (Math.abs(vx) > coreHalfW) return;
        const frac = (vz - fuseMinZ) / fuseLen;

        if (vy <= bellyRoofCutoff) {
          if (frac >= 0.06 && frac <= 0.24 && vy < cockpitMinY) {
            cockpitMinY = vy;
            cockpitPos.set(0, vy, vz);
          }
          if (vz >= fuseMinZ + fuseLen * 0.22 && vz < mainGearZ - fuseLen * 0.08 && vy < fwdBellyMinY) {
            fwdBellyMinY = vy;
            fwdBellyPos.set(0, vy, vz);
          }
          if (vz >= mainGearZ - fuseLen * 0.08 && vz <= mainGearZ + fuseLen * 0.06 && vy < midBellyMinY) {
            midBellyMinY = vy;
            midBellyPos.set(0, vy, vz);
          }
          if (vz >= aftStartZ) {
            const b = Math.min(AFT_BINS - 1, Math.max(0, Math.floor(((vz - aftStartZ) / aftSpanZ) * AFT_BINS)));
            if (vy < aftBinMinY[b]) {
              aftBinMinY[b] = vy;
              aftBinX[b] = Math.abs(vx) < 0.35 ? 0 : vx;
              aftBinZ[b] = vz;
            }
          }
        }

        if (frac >= 0.14 && frac <= 0.38 && vy > fwdTopMaxY) {
          fwdTopMaxY = vy;
          fwdTopPos.set(0, vy, vz);
        }
        if (frac > 0.38 && frac <= 0.65 && vy > midTopMaxY) {
          midTopMaxY = vy;
          midTopPos.set(0, vy, vz);
        }
        if (frac > 0.65 && vy <= bellyRoofCutoff + 0.8 && vy > aftTopMaxY) {
          aftTopMaxY = vy;
          aftTopPos.set(0, vy, vz);
        }
      });
    }

    const pickBestAftBin = (startIdx: number, endIdx: number, fallbackFrac: number): THREE.Vector3 => {
      let bestAngle = Infinity;
      let bestVec: THREE.Vector3 | null = null;
      for (let b = startIdx; b <= endIdx; b++) {
        if (!Number.isFinite(aftBinMinY[b])) continue;
        const angle = Math.atan2(Math.max(0.05, aftBinMinY[b]), Math.max(0.5, aftBinZ[b] - mainGearZ));
        if (angle < bestAngle) {
          bestAngle = angle;
          bestVec = new THREE.Vector3(aftBinX[b], aftBinMinY[b], aftBinZ[b]);
        }
      }
      if (bestVec) return bestVec;
      return new THREE.Vector3(0, midMinY + h * 0.08, aftStartZ + aftSpanZ * fallbackFrac);
    };

    const aftBellyPos = pickBestAftBin(0, 2, 0.25);
    const tailConePos = pickBestAftBin(3, 5, 0.62);
    const tailBumperPos = pickBestAftBin(5, AFT_BINS - 1, 0.9);

    // Measure actual Left & Right wing span/height/sweep profiles
    const measureWingNodes = (group: THREE.Object3D, side: -1 | 1) => {
      let maxAbsX = 0;
      visitGroupVertices(group, skipSet, (vx) => {
        if (side < 0 ? vx < -0.5 : vx > 0.5) {
          const ax = Math.abs(vx);
          if (ax > maxAbsX) maxAbsX = ax;
        }
      });
      if (maxAbsX < 1.5) maxAbsX = hs;

      const rootX = Math.min(maxAbsX * 0.35, Math.max(1.2, f.wingspanM * 0.12));
      const wingSpan = Math.max(1.5, maxAbsX - rootX);
      const tipThresholdX = Math.max(rootX + wingSpan * 0.86, maxAbsX * 0.93);

      let rootMinY = Infinity;
      const rootPos = new THREE.Vector3(side * (rootX + wingSpan * 0.14), fallbackWingY, 0);
      let midMinYSide = Infinity;
      const midPos = new THREE.Vector3(side * (rootX + wingSpan * 0.56), fallbackWingY + h * 0.04, hl * 0.14);
      let tipMinY = Infinity;
      const tipPos = new THREE.Vector3(side * maxAbsX, fallbackWingY + h * 0.08, hl * 0.28);

      visitGroupVertices(group, skipSet, (vx, vy, vz) => {
        if (side < 0 ? vx >= -0.5 : vx <= 0.5) return;
        const ax = Math.abs(vx);
        if (ax <= rootX + wingSpan * 0.34) {
          if (vy < rootMinY) {
            rootMinY = vy;
            rootPos.set(vx, vy, vz);
          }
        } else if (ax <= rootX + wingSpan * 0.76) {
          if (vy < midMinYSide) {
            midMinYSide = vy;
            midPos.set(vx, vy, vz);
          }
        } else if (ax >= tipThresholdX) {
          if (vy < tipMinY) {
            tipMinY = vy;
            tipPos.set(vx, vy, vz);
          }
        }
      });
      return {rootPos, midPos, tipPos};
    };

    const lWing = measureWingNodes(this.rig.leftWingGroup, -1);
    const rWing = measureWingNodes(this.rig.rightWingGroup, 1);

    // Measure Vertical Fin & Horizontal Stabilizer Tips
    let finTopPos = new THREE.Vector3(0, h * 0.92, hl * 0.9);
    let finMaxY = -Infinity;
    visitGroupVertices(this.rig.tailGroup, skipSet, (vx, vy, vz) => {
      if (vy > finMaxY) {
        finMaxY = vy;
        finTopPos.set(vx, vy, vz);
      }
    });

    let lStabPos: THREE.Vector3 | null = null;
    let lStabMinX = Infinity;
    visitGroupVertices(this.rig.leftHStabGroup, skipSet, (vx, vy, vz) => {
      if (vx < lStabMinX) {
        lStabMinX = vx;
        if (!lStabPos) lStabPos = new THREE.Vector3(vx, vy, vz);
        else lStabPos.set(vx, vy, vz);
      }
    });

    let rStabPos: THREE.Vector3 | null = null;
    let rStabMaxX = -Infinity;
    visitGroupVertices(this.rig.rightHStabGroup, skipSet, (vx, vy, vz) => {
      if (vx > rStabMaxX) {
        rStabMaxX = vx;
        if (!rStabPos) rStabPos = new THREE.Vector3(vx, vy, vz);
        else rStabPos.set(vx, vy, vz);
      }
    });

    const defs: Array<[string, keyof StructuralZoneHealth, THREE.Vector3, number, string[]]> = [
      ['noseTip', 'nose', new THREE.Vector3(noseTipX, noseTipY, noseTipZ), 0.42, ['noseCone', 'noseGear']],
      ['cockpit', 'nose', cockpitPos, 0.56, ['noseCone', 'fuse_fwd']],
      ['fwdBelly', 'fuselage', fwdBellyPos, 0.6, ['noseGear', 'fuse_fwd']],
      ['midBelly', 'fuselage', midBellyPos, 0.68, ['leftGear', 'rightGear', 'fuse_aftmid']],
      ['aftBelly', 'fuselage', aftBellyPos, 0.52, ['fuse_aftmid', 'aftFuselage']],
      ['fwdTop', 'nose', fwdTopPos, 0.5, ['noseCone', 'fuse_fwd']],
      ['midTop', 'fuselage', midTopPos, 0.58, ['fuse_fwd', 'fuse_aftmid']],
      ['aftTop', 'tail', aftTopPos, 0.5, ['aftFuselage', 'tail']],
      ['tailCone', 'tail', tailConePos, 0.44, ['aftFuselage', 'leftHStab', 'rightHStab', 'tail']],
      ['tailAftBumper', 'tail', tailBumperPos, 0.4, ['aftFuselage', 'tail', 'leftHStab', 'rightHStab']],
      ['finTop', 'tail', finTopPos, 0.4, ['tail']],
      ['lWingRoot', 'leftWing', lWing.rootPos, 0.6, ['leftWing_s0', 'leftWing']],
      ['lWingMid', 'leftWing', lWing.midPos, 0.4, ['leftWing_s1', 'leftWing']],
      ['lWingTip', 'leftWing', lWing.tipPos, 0.28, ['leftWing_s2', 'leftWing_s1', 'leftWing']],
      ['rWingRoot', 'rightWing', rWing.rootPos, 0.6, ['rightWing_s0', 'rightWing']],
      ['rWingMid', 'rightWing', rWing.midPos, 0.4, ['rightWing_s1', 'rightWing']],
      ['rWingTip', 'rightWing', rWing.tipPos, 0.28, ['rightWing_s2', 'rightWing_s1', 'rightWing']],
    ];

    if (lStabPos) {
      defs.push(['lStabTip', 'tail', lStabPos, 0.36, ['leftHStab', 'tail']]);
    }
    if (rStabPos) {
      defs.push(['rStabTip', 'tail', rStabPos, 0.36, ['rightHStab', 'tail']]);
    }

    // Measure actual engine pod undersides individually (wing pods, rear fuse pods, tail S-duct)
    const podSkipSet = new Set<THREE.Object3D>([
      this.rig.cockpitRig.group,
      ...this.rig.strobeLights,
      ...this.rig.beaconLights,
    ]);
    this.rig.enginePods.forEach((pod, idx) => {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      visitGroupVertices(pod.group, podSkipSet, (vx, vy, vz) => {
        if (vx < minX) minX = vx;
        if (vx > maxX) maxX = vx;
        if (vy < minY) minY = vy;
        if (vz < minZ) minZ = vz;
        if (vz > maxZ) maxZ = vz;
      });
      if (Number.isFinite(minY)) {
        defs.push([
          `engPod_${idx}`,
          'engines',
          new THREE.Vector3((minX + maxX) * 0.5, minY, (minZ + maxZ) * 0.5),
          0.36,
          [`enginePod_${idx}`],
        ]);
      }
    });

    this.nodes = defs.map(([id, zone, restPos, fractureStress, pieceKeys]) => ({
      id,
      zone,
      restPos,
      fractureStress,
      damage: 0,
      pieceKeys,
    }));
  }

  public spawnParticle(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    kind: Particle['kind'],
    size = 2.0,
    maxLife = 1.4,
    tint?: [number, number, number],
  ) {
    const isFireLayer = kind === 'fire' || kind === 'spark';
    const pool = isFireLayer ? this.firePool : this.smokePool;
    const p = isFireLayer
      ? pool[this.nextFireIdx]
      : pool[this.nextSmokeIdx];
    if (isFireLayer) {
      this.nextFireIdx = (this.nextFireIdx + 1) % this.maxFire;
    } else {
      this.nextSmokeIdx = (this.nextSmokeIdx + 1) % this.maxSmoke;
    }

    p.active = true;
    p.pos.copy(pos);
    p.vel.copy(vel);
    p.life = 0;
    p.maxLife = Math.max(0.08, maxLife);
    p.kind = kind;
    p.rot = Math.random() * Math.PI * 2;
    p.hasCustomColor = Boolean(tint);

    if (kind === 'fire') {
      p.initialSize = size * (0.85 + Math.random() * 0.35);
      p.growth = size * 0.95;
      p.rotVel = (Math.random() - 0.5) * 3.4;
      p.turbulence = 1.15;
      if (tint) p.color.setRGB(tint[0], tint[1], tint[2]);
      else p.color.setRGB(1.0, 0.92, 0.65);
    } else if (kind === 'spark') {
      p.initialSize = Math.min(1.05, Math.max(0.42, size * 0.48));
      p.growth = -p.initialSize * 0.45;
      p.rotVel = (Math.random() - 0.5) * 9.0;
      p.turbulence = 0.25;
      if (tint) p.color.setRGB(tint[0], tint[1], tint[2]);
      else p.color.setRGB(1.0, 0.85, 0.35);
    } else if (kind === 'dust') {
      p.initialSize = size * (0.9 + Math.random() * 0.3);
      p.growth = size * 1.45;
      p.rotVel = (Math.random() - 0.5) * 1.3;
      p.turbulence = 0.85;
      if (tint) p.color.setRGB(tint[0], tint[1], tint[2]);
      else p.color.setRGB(0.64, 0.58, 0.48);
    } else {
      p.initialSize = size * (0.85 + Math.random() * 0.35);
      p.growth = size * 2.15;
      p.rotVel = (Math.random() - 0.5) * 1.4;
      p.turbulence = 1.05;
      if (tint) {
        p.color.setRGB(tint[0], tint[1], tint[2]);
      } else {
        const shade = 0.22 + Math.random() * 0.08;
        p.color.setRGB(shade, shade, shade + 0.015);
      }
    }
  }

  public spawnShrapnelBurst(worldPos: THREE.Vector3, baseVel: THREE.Vector3, forceMag: number, count: number) {
    const clampedCount = Math.min(count, this.maxShrapnel);
    const speedBlast = THREE.MathUtils.clamp(forceMag * 0.75, 6, 48);
    const sizeScale = THREE.MathUtils.clamp(this.rig.spec.flight.lengthM / 35, 0.45, 1.85);

    for (let i = 0; i < clampedCount; i++) {
      const bit = this.shrapnel[this.nextShrapnelIdx];
      this.nextShrapnelIdx = (this.nextShrapnelIdx + 1) % this.maxShrapnel;

      bit.active = true;
      bit.life = 0;
      bit.pos.set(
        worldPos.x + (Math.random() - 0.5) * 3.0,
        Math.max(0.25, worldPos.y + (Math.random() - 0.3) * 2.2),
        worldPos.z + (Math.random() - 0.5) * 3.0,
      );
      bit.vel.set(
        baseVel.x * (0.45 + Math.random() * 0.4) + (Math.random() - 0.5) * speedBlast,
        Math.max(2.5, baseVel.y * 0.3 + Math.random() * speedBlast * 0.65),
        baseVel.z * (0.45 + Math.random() * 0.4) + (Math.random() - 0.5) * speedBlast,
      );
      this._dummyEuler.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      bit.quat.setFromEuler(this._dummyEuler);
      bit.angVel.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18);
      const s = (0.42 + Math.random() * 1.15) * sizeScale;
      bit.scale.set(s, s * (0.5 + Math.random() * 0.8), s * (0.6 + Math.random() * 1.1));
    }
  }

  public triggerBirdStrike(aircraftPos: THREE.Vector3, aircraftQuat: THREE.Quaternion, aircraftVel: THREE.Vector3) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(aircraftQuat);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(aircraftQuat);
    const spawnDist = Math.max(18, this.rig.spec.flight.lengthM * 0.75);
    const noseOrigin = aircraftPos.clone().addScaledVector(fwd, spawnDist).add(new THREE.Vector3(0, 2.2, 0));

    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];
      b.active = true;
      b.hitDone = false;
      b.pos
        .copy(noseOrigin)
        .addScaledVector(right, (Math.random() - 0.5) * 14)
        .add(new THREE.Vector3(0, (Math.random() - 0.4) * 5, 0));
      b.vel.copy(aircraftVel).multiplyScalar(-0.25).addScaledVector(fwd, -14);
    }

    // Immediate visible impact burst at radome/windshield/wing leading edge
    const hitPt = aircraftPos.clone().addScaledVector(fwd, this.rig.spec.flight.lengthM * 0.36).add(new THREE.Vector3(0, 2.4, 0));
    this.spawnShrapnelBurst(hitPt, aircraftVel, 14, 14);
    for (let i = 0; i < 16; i++) {
      this._tmpVec.copy(aircraftVel).multiplyScalar(0.3).add(new THREE.Vector3((Math.random() - 0.5) * 14, Math.random() * 8, (Math.random() - 0.5) * 14));
      this.spawnParticle(hitPt, this._tmpVec, i % 3 === 0 ? 'spark' : 'dust', 1.8, 0.85);
    }
    const noseNode = this.nodes.find((n) => n.id === 'noseTip');
    if (noseNode) noseNode.damage = Math.min(0.45, noseNode.damage + 0.14);
  }

  public spawnTouchdownSmoke(worldPos: THREE.Vector3, aircraftVel: THREE.Vector3) {
    for (let i = 0; i < 5; i++) {
      this._tmpVec.set(
        (Math.random() - 0.5) * 3.5,
        0.9 + Math.random() * 1.4,
        (Math.random() - 0.5) * 3.5,
      );
      this._tmpVec.addScaledVector(aircraftVel, 0.18);
      this.spawnParticle(worldPos, this._tmpVec, 'smoke', 1.5, 0.95, [0.88, 0.9, 0.92]);
    }
  }

  public detachPart(
    key: string,
    impactVel: THREE.Vector3,
    aircraftQuat?: THREE.Quaternion,
    forceMag = 16,
  ): boolean {
    const d = this.debris.get(key);
    if (!d || d.detached) return false;
    d.detached = true;

    d.group.updateMatrixWorld(true);
    d.group.getWorldPosition(this._worldPos);
    d.group.getWorldQuaternion(this._worldQuat);

    d.origParent.remove(d.group);
    this.scene.add(d.group);
    d.group.position.copy(this._worldPos);
    d.group.quaternion.copy(this._worldQuat);

    const pushDir = d.localCom.clone();
    if (pushDir.lengthSq() < 0.1) pushDir.set(Math.random() - 0.5, 0.4, Math.random() - 0.5);
    pushDir.normalize();
    if (aircraftQuat) pushDir.applyQuaternion(aircraftQuat);

    const blast = THREE.MathUtils.clamp(forceMag * 0.45, 6, 28);
    d.vel.copy(impactVel).multiplyScalar(0.68);
    d.vel.addScaledVector(pushDir, blast * (0.7 + Math.random() * 0.6));
    d.vel.y += 4 + Math.random() * (blast * 0.45);
    d.angVel.set((Math.random() - 0.5) * 6.5, (Math.random() - 0.5) * 5.0, (Math.random() - 0.5) * 6.5);

    const burstOrigin = this._worldPos.clone().add(
      d.localCom.clone().applyQuaternion(this._worldQuat),
    );
    // Spawn tiny tumbling shrapnel proportional to force right at the fracture joint!
    const shardCount = Math.round(THREE.MathUtils.clamp(forceMag * 0.85, 6, 26));
    this.spawnShrapnelBurst(burstOrigin, impactVel, forceMag, shardCount);

    for (let i = 0; i < 6; i++) {
      this._tmpVec.set((Math.random() - 0.5) * 18, 2 + Math.random() * 14, (Math.random() - 0.5) * 18);
      this.spawnParticle(burstOrigin, this._tmpVec, i % 2 === 0 ? 'fire' : 'spark', 2.8, 1.15);
    }
    return true;
  }

  public spawnExplosion(
    worldPos: THREE.Vector3,
    baseVel: THREE.Vector3,
    forceMag: number,
    scaleMult = 1.0,
    groundElevation = 0,
  ) {
    const aircraftScale = THREE.MathUtils.clamp(this.rig.spec.flight.lengthM / 36, 0.52, 1.55);
    const forceScale = THREE.MathUtils.clamp(forceMag / 22, 0.65, 1.85);
    const blastRadius = 9.5 * aircraftScale * forceScale * scaleMult;

    // 1. Expanding volumetric 3D fireball core & ground shockwave ring
    const blast = this.explosions[this.nextExplosionIdx];
    this.nextExplosionIdx = (this.nextExplosionIdx + 1) % this.maxExplosions;
    blast.active = true;
    blast.life = 0;
    blast.maxLife = THREE.MathUtils.clamp(0.75 + 0.25 * forceScale, 0.72, 1.18);
    blast.maxRadius = blastRadius;
    blast.origin.copy(worldPos);
    blast.origin.y = Math.max(groundElevation + 0.45, blast.origin.y);
    blast.vel.copy(baseVel).multiplyScalar(0.32);

    blast.fireballMesh.position.copy(blast.origin);
    blast.fireballMesh.scale.setScalar(1.2);
    blast.fireballMesh.visible = true;
    blast.fireballMat.uniforms.uProgress.value = 0;

    blast.shockwaveMesh.position.set(blast.origin.x, Math.max(groundElevation + 0.16, blast.origin.y * 0.22 + groundElevation * 0.78), blast.origin.z);
    blast.shockwaveMesh.scale.setScalar(1.5);
    blast.shockwaveMesh.visible = true;
    blast.shockwaveMat.uniforms.uProgress.value = 0;

    // 2. Blinding thermal flash spike
    this.explosionFlash = Math.max(
      this.explosionFlash,
      THREE.MathUtils.clamp(forceMag * 2.8 * scaleMult, 42, 110),
    );
    this.explosionFlashPos.copy(blast.origin);
    this.explosionFlashPos.y += 2.2;

    // 3. White-hot flash core & rolling fireball cells
    const fireCount = Math.round(THREE.MathUtils.clamp(36 * scaleMult, 16, 48));
    for (let i = 0; i < fireCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.68;
      const spd = (6 + Math.random() * 20) * forceScale * scaleMult;
      this._emitSubPos.set(
        blast.origin.x + (Math.random() - 0.5) * blastRadius * 0.35,
        blast.origin.y + Math.random() * blastRadius * 0.25,
        blast.origin.z + (Math.random() - 0.5) * blastRadius * 0.35,
      );
      this._emitSubVel.set(
        baseVel.x * 0.38 + Math.sin(phi) * Math.cos(theta) * spd,
        Math.cos(phi) * spd * 1.15 + 4.5,
        baseVel.z * 0.38 + Math.sin(phi) * Math.sin(theta) * spd,
      );
      this.spawnParticle(
        this._emitSubPos,
        this._emitSubVel,
        'fire',
        (3.4 + Math.random() * 2.4) * aircraftScale * scaleMult,
        0.55 + Math.random() * 0.55,
      );
    }

    // 4. Dense mushrooming black soot & kicked-up terrain dust plume
    const smokeCount = Math.round(THREE.MathUtils.clamp(44 * scaleMult, 18, 56));
    for (let i = 0; i < smokeCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const radialSpd = (3 + Math.random() * 14) * forceScale * scaleMult;
      this._emitSubPos.set(
        blast.origin.x + (Math.random() - 0.5) * blastRadius * 0.45,
        blast.origin.y + Math.random() * blastRadius * 0.3,
        blast.origin.z + (Math.random() - 0.5) * blastRadius * 0.45,
      );
      this._emitSubVel.set(
        baseVel.x * 0.25 + Math.cos(theta) * radialSpd,
        5.5 + Math.random() * 14 * forceScale * scaleMult,
        baseVel.z * 0.25 + Math.sin(theta) * radialSpd,
      );
      const isDust = i % 4 === 0 && blast.origin.y - groundElevation < 8;
      this.spawnParticle(
        this._emitSubPos,
        this._emitSubVel,
        isDust ? 'dust' : 'smoke',
        (4.2 + Math.random() * 2.8) * aircraftScale * scaleMult,
        2.6 + Math.random() * 1.8,
      );
    }

    // 5. High-velocity radial sparks & glowing embers
    const sparkCount = Math.round(THREE.MathUtils.clamp(32 * scaleMult, 14, 42));
    for (let i = 0; i < sparkCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.62;
      const spd = (18 + Math.random() * 34) * forceScale * scaleMult;
      this._emitSubVel.set(
        baseVel.x * 0.45 + Math.sin(phi) * Math.cos(theta) * spd,
        Math.cos(phi) * spd * 0.95 + 6.0,
        baseVel.z * 0.45 + Math.sin(phi) * Math.sin(theta) * spd,
      );
      this.spawnParticle(
        blast.origin,
        this._emitSubVel,
        'spark',
        0.85 + Math.random() * 0.45,
        0.65 + Math.random() * 0.75,
      );
    }
  }

  public getBreakableParts(): BreakablePartInfo[] {
    const out: BreakablePartInfo[] = [];
    this.debris.forEach((d) => {
      out.push({
        key: d.key,
        label: d.label,
        zone: d.zone,
        detached: d.detached,
      });
    });
    return out;
  }

  public getDebrisGroup(key: string): THREE.Object3D | null {
    return this.debris.get(key)?.group ?? null;
  }

  public isPartDetached(key: string): boolean {
    return Boolean(this.debris.get(key)?.detached);
  }

  public getWingIntactFraction(side: -1 | 1): number {
    const prefix = side < 0 ? 'leftWing' : 'rightWing';
    if (this.debris.get(prefix)?.detached) return 0.1;
    let totalSegs = 0;
    let intactSegs = 0;
    for (let s = 0; s < 3; s++) {
      const d = this.debris.get(`${prefix}_s${s}`);
      if (d) {
        totalSegs++;
        if (!d.detached) intactSegs++;
      }
    }
    if (totalSegs === 0) return 1.0;
    return 0.15 + 0.85 * (intactSegs / totalSegs);
  }

  public getTailIntegrityFactor(): {pitch: number; yaw: number} {
    const lDet = this.debris.get('leftHStab')?.detached ? 1 : 0;
    const rDet = this.debris.get('rightHStab')?.detached ? 1 : 0;
    const tDet = this.debris.get('tail')?.detached ? 1 : 0;
    const pitch = Math.max(0.2, 1.0 - (lDet + rDet) * 0.35 - tDet * 0.25);
    const yaw = tDet ? 0.22 : 1.0;
    return {pitch, yaw};
  }

  private getZoneCascadeKeys(zone: keyof StructuralZoneHealth): string[] {
    const portEngines = this.engineKeys.filter((_, idx) => idx % 2 === 0);
    const stbdEngines = this.engineKeys.filter((_, idx) => idx % 2 === 1);
    switch (zone) {
      case 'leftWing':
        return ['leftWing_s2', 'leftWing_s1', ...portEngines, 'leftWing_s0', 'leftWing'];
      case 'rightWing':
        return ['rightWing_s2', 'rightWing_s1', ...stbdEngines, 'rightWing_s0', 'rightWing'];
      case 'nose':
        return ['noseGear', 'noseCone', 'fuse_fwd'];
      case 'tail':
        return ['leftHStab', 'rightHStab', 'tail', 'aftFuselage', ...this.engineKeys];
      case 'engines':
        return [...this.engineKeys, 'aftFuselage', 'leftWing_s0', 'rightWing_s0'];
      case 'gear':
        return [...this.gearKeys, 'fuse_fwd', 'fuse_aftmid'];
      case 'fuselage':
      default:
        return ['noseGear', 'leftGear', 'rightGear', 'fuse_fwd', 'fuse_aftmid', 'aftFuselage', ...this.engineKeys];
    }
  }

  private detachNextByZones(
    zones: Set<keyof StructuralZoneHealth>,
    impactVel: THREE.Vector3,
    aircraftQuat: THREE.Quaternion,
    forceMag: number,
  ): boolean {
    for (const zone of zones) {
      const candidates = this.getZoneCascadeKeys(zone);
      for (const key of candidates) {
        const d = this.debris.get(key);
        if (d && !d.detached) {
          return this.detachPart(key, impactVel, aircraftQuat, forceMag);
        }
      }
    }
    // Fallback to any remaining intact debris piece
    for (const [key, d] of this.debris) {
      if (!d.detached) {
        return this.detachPart(key, impactVel, aircraftQuat, forceMag);
      }
    }
    return false;
  }

  private shatterAirframe(impactVel: THREE.Vector3, aircraftQuat: THREE.Quaternion, forceMag: number): boolean {
    // Number of structural sub-sections & shrapnel bits scales cleanly with crash energy!
    const pieceBudget = forceMag > 36 ? 14 : forceMag > 24 ? 8 : forceMag > 15 ? 4 : 2;
    const candidates = Array.from(this.debris.keys()).filter((k) => !this.debris.get(k)?.detached);
    let anyDetached = false;
    for (let i = 0; i < Math.min(pieceBudget, candidates.length); i++) {
      const idx = Math.floor(Math.random() * candidates.length);
      const pick = candidates.splice(idx, 1)[0];
      if (this.detachPart(pick, impactVel, aircraftQuat, forceMag)) {
        anyDetached = true;
      }
    }
    return anyDetached;
  }

  private shatterOnSecondaryImpact(
    impactVel: THREE.Vector3,
    aircraftQuat: THREE.Quaternion,
    forceMag: number,
    hitZones: Set<keyof StructuralZoneHealth>,
    impactPt: THREE.Vector3,
    groundElevation = 0,
  ): boolean {
    let anyDetached = false;
    // First snap intact parts in the exact zones slamming into the ground on this 2nd impact
    const zoneQuota = forceMag > 26 ? 4 : forceMag > 15 ? 2 : 1;
    for (let i = 0; i < zoneQuota; i++) {
      if (this.detachNextByZones(hitZones, impactVel, aircraftQuat, forceMag)) {
        anyDetached = true;
      } else {
        break;
      }
    }
    // Also propagate shock fracture through additional intact assemblies based on 2nd impact force
    const extraQuota = forceMag > 30 ? 4 : forceMag > 18 ? 2 : 0;
    const candidates = Array.from(this.debris.keys()).filter((k) => !this.debris.get(k)?.detached);
    for (let i = 0; i < Math.min(extraQuota, candidates.length); i++) {
      const idx = Math.floor(Math.random() * candidates.length);
      const pick = candidates.splice(idx, 1)[0];
      if (this.detachPart(pick, impactVel, aircraftQuat, forceMag)) {
        anyDetached = true;
      }
    }
    // Always erupt jagged shrapnel, sparks/fire, and secondary explosion on hard 2nd impact!
    const burstCount = Math.round(THREE.MathUtils.clamp(forceMag * 1.25, 10, 36));
    this.spawnShrapnelBurst(impactPt, impactVel, forceMag, burstCount);
    if (forceMag >= 13.5) {
      this.spawnExplosion(impactPt, impactVel, forceMag, 0.78, groundElevation);
    } else {
      for (let i = 0; i < 16; i++) {
        this._tmpVec.set((Math.random() - 0.5) * 18, 2.5 + Math.random() * 14, (Math.random() - 0.5) * 18);
        this.spawnParticle(impactPt, this._tmpVec, i % 2 === 0 ? 'fire' : 'spark', 3.2, 1.15);
      }
    }
    return anyDetached;
  }

  public step(ctx: SoftbodyStepContext): SoftbodyStepResult {
    const dt = Math.min(ctx.dt, 0.033);
    this._totalForce.set(0, 0, 0);
    this._totalTorque.set(0, 0, 0);
    this.impactBurstCooldown = Math.max(0, this.impactBurstCooldown - dt);
    this.scrapeBreakCooldown = Math.max(0, this.scrapeBreakCooldown - dt);
    this.scrapePhase += dt;
    this._hitZones.clear();

    let groundContacts = 0;
    let scraping = false;
    let scrapeIntensity = 0;
    let maxScrapeSpeed = 0;
    let maxContactSpeed = 0;
    let collapseGear = false;
    let triggeredCrashNow = false;
    let crashCause = '';
    let maxSeverity = 0;
    let secondaryImpactIntensity = 0;
    let partDetachedThisStep = false;

    const airframeOffsetY = this.rig.airframeGroup.position.y;
    const leftWingDetached = Boolean(this.debris.get('leftWing')?.detached);
    const rightWingDetached = Boolean(this.debris.get('rightWing')?.detached);
    const tailDetached = Boolean(this.debris.get('tail')?.detached);
    const aftDetached = Boolean(this.debris.get('aftFuselage')?.detached);
    const fuseAftMidDetached = Boolean(this.debris.get('fuse_aftmid')?.detached);
    const noseDetached = Boolean(this.debris.get('noseCone')?.detached);

    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      if (
        (node.id === 'lWingTip' && (leftWingDetached || this.debris.get('leftWing_s2')?.detached)) ||
        (node.id === 'lWingMid' && (leftWingDetached || this.debris.get('leftWing_s1')?.detached)) ||
        (node.id === 'lWingRoot' && (leftWingDetached || this.debris.get('leftWing_s0')?.detached)) ||
        (node.id === 'rWingTip' && (rightWingDetached || this.debris.get('rightWing_s2')?.detached)) ||
        (node.id === 'rWingMid' && (rightWingDetached || this.debris.get('rightWing_s1')?.detached)) ||
        (node.id === 'rWingRoot' && (rightWingDetached || this.debris.get('rightWing_s0')?.detached)) ||
        (node.id === 'finTop' && tailDetached) ||
        (node.id === 'tailAftBumper' && (aftDetached || tailDetached)) ||
        (node.id === 'tailCone' && aftDetached && tailDetached) ||
        (node.id === 'aftBelly' && aftDetached && fuseAftMidDetached) ||
        (node.id === 'lStabTip' && (tailDetached || this.debris.get('leftHStab')?.detached)) ||
        (node.id === 'rStabTip' && (tailDetached || this.debris.get('rightHStab')?.detached)) ||
        (node.id === 'noseTip' && noseDetached) ||
        (node.id.startsWith('engPod_') && this.debris.get(node.pieceKeys[0])?.detached)
      ) {
        continue;
      }

      this._localPt.copy(node.restPos);
      this._localPt.y += airframeOffsetY;
      this._worldPt.copy(this._localPt).applyQuaternion(ctx.aircraftQuat).add(ctx.aircraftWorldPos);

      const groundH = ctx.groundElevation;
      let penetration = groundH - this._worldPt.y;
      let hitNormal = this._groundNorm;
      let hitObstacleName = '';

      if (penetration <= 0 && this._worldPt.y < 105) {
        for (let o = 0; o < ctx.obstacles.length; o++) {
          const box = ctx.obstacles[o];
          if (
            this._worldPt.x >= box.minX &&
            this._worldPt.x <= box.maxX &&
            this._worldPt.y >= box.minY &&
            this._worldPt.y <= box.maxY &&
            this._worldPt.z >= box.minZ &&
            this._worldPt.z <= box.maxZ
          ) {
            const dxMin = this._worldPt.x - box.minX;
            const dxMax = box.maxX - this._worldPt.x;
            const dyMax = box.maxY - this._worldPt.y;
            const dzMin = this._worldPt.z - box.minZ;
            const dzMax = box.maxZ - this._worldPt.z;
            const minPen = Math.min(dxMin, dxMax, dyMax, dzMin, dzMax);
            penetration = Math.max(0.25, minPen);
            if (minPen === dyMax) this._tmpNorm.set(0, 1, 0);
            else if (minPen === dxMin) this._tmpNorm.set(-1, 0, 0);
            else if (minPen === dxMax) this._tmpNorm.set(1, 0, 0);
            else if (minPen === dzMin) this._tmpNorm.set(0, 0, -1);
            else this._tmpNorm.set(0, 0, 1);
            hitNormal = this._tmpNorm;
            hitObstacleName = box.name;
            break;
          }
        }
      }

      if (penetration > 0) {
        groundContacts++;
        this._hitZones.add(node.zone);
        this._rVec.copy(this._worldPt).sub(ctx.aircraftWorldPos);
        this._relVel.copy(ctx.aircraftAngVel).cross(this._rVec).add(ctx.aircraftVel);

        const vn = this._relVel.dot(hitNormal);
        maxContactSpeed = Math.max(maxContactSpeed, Math.abs(vn));

        const kGround = 1250000 * this.massScale;
        const cGround = 145000 * this.massScale;
        const rawNormalForce = Math.max(0, penetration * kGround - vn * cGround);
        const maxNormalForce =
          this.rig.spec.flight.massKg *
          9.81 *
          (hitObstacleName ? 14 : 5.5) *
          (1 + Math.min(2.5, Math.abs(vn) * 0.25));
        const normalForceMag = Math.min(rawNormalForce, maxNormalForce);

        const mu = ctx.onRunway ? 0.38 : 0.65;
        this._tmpVec.copy(this._relVel).addScaledVector(hitNormal, -vn);
        const tangentSpeed = this._tmpVec.length();
        if (tangentSpeed > 0.2) {
          scraping = true;
          maxScrapeSpeed = Math.max(maxScrapeSpeed, tangentSpeed);
          scrapeIntensity = Math.max(scrapeIntensity, Math.min(1, tangentSpeed / 40));
          this._tmpVec.divideScalar(tangentSpeed);
        } else {
          this._tmpVec.set(0, 0, 0);
        }

        // Terrain roughness snagging while scraping off-runway or during gear-up / crashed skid
        const snagGain =
          tangentSpeed > 6 && (this.crashed || !ctx.onRunway || !ctx.gearDown || ctx.gearCollapsed)
            ? Math.sin(this.scrapePhase * 19.7 + i * 2.3) * (ctx.onRunway ? 0.08 : 0.28)
            : 0;
        const fx = hitNormal.x * normalForceMag - this._tmpVec.x * normalForceMag * (mu + snagGain);
        const fy =
          hitNormal.y * (normalForceMag * (1 + Math.max(0, snagGain) * 0.45)) -
          this._tmpVec.y * normalForceMag * mu;
        const fz = hitNormal.z * normalForceMag - this._tmpVec.z * normalForceMag * (mu + snagGain);

        this._totalForce.x += fx;
        this._totalForce.y += fy;
        this._totalForce.z += fz;

        this._totalTorque.x += this._rVec.y * fz - this._rVec.z * fy;
        this._totalTorque.y += this._rVec.z * fx - this._rVec.x * fz;
        this._totalTorque.z += this._rVec.x * fy - this._rVec.y * fx;

        const slamSpeed = Math.max(0, -vn);
        const aircraftWeight = Math.max(1, this.rig.spec.flight.massKg * 9.81);
        const normalLoadG = normalForceMag / aircraftWeight;
        const isTailStrikeNode =
          node.id === 'tailAftBumper' || node.id === 'tailCone' || node.id === 'aftBelly';
        const isWingStrikeNode =
          node.id === 'lWingTip' ||
          node.id === 'lWingMid' ||
          node.id === 'rWingTip' ||
          node.id === 'rWingMid' ||
          node.id.startsWith('engPod_');

        const impactRate =
          Math.max(0, slamSpeed - (isTailStrikeNode || isWingStrikeNode ? 1.4 : 1.8)) *
            (isWingStrikeNode ? 0.34 : 0.28) +
          Math.max(0, penetration - 0.12) * 1.45 +
          (hitObstacleName ? 12.0 : 0);

        const scrapeRate =
          tangentSpeed > 4.5 && normalLoadG > 0.015
            ? ((tangentSpeed - 4.0) / 55) *
              Math.min(2.4, 0.22 + normalLoadG * 1.6) *
              (ctx.onRunway ? 0.44 : 1.35)
            : 0;

        const stressRate = impactRate + scrapeRate;
        const contactForceScore =
          slamSpeed * 1.65 +
          penetration * 10 +
          (hitObstacleName ? 26 : 0) +
          (ctx.onRunway ? Math.min(4.5, scrapeRate * 3.5) : scrapeRate * 6.5);

        if (contactForceScore >= maxSeverity) {
          maxSeverity = contactForceScore;
          this._primaryImpactPt.copy(this._worldPt);
        }

        if (stressRate > 0.05 || hitObstacleName !== '') {
          const damageDelta = Math.min(0.95, stressRate * dt);
          node.damage = Math.min(1.0, node.damage + damageDelta);

          if (!ctx.gearCollapsed && ctx.gearDown && slamSpeed > 5.8 && !isTailStrikeNode && !isWingStrikeNode) {
            collapseGear = true;
          }

          let detachedPrimaryStructure = false;
          if (node.damage >= node.fractureStress) {
            if (slamSpeed >= 8.2 || hitObstacleName !== '') {
              for (const pk of node.pieceKeys) {
                if (this.detachPart(pk, ctx.aircraftVel, ctx.aircraftQuat, Math.max(10, contactForceScore))) {
                  partDetachedThisStep = true;
                  if (
                    pk === 'tail' ||
                    pk === 'leftWing' ||
                    pk === 'rightWing' ||
                    pk === 'leftWing_s0' ||
                    pk === 'rightWing_s0'
                  ) {
                    detachedPrimaryStructure = true;
                  }
                }
              }
            } else {
              // Sequential fracture: snap only the outermost struck assembly first
              for (const pk of node.pieceKeys) {
                const d = this.debris.get(pk);
                if (d && !d.detached) {
                  if (this.detachPart(pk, ctx.aircraftVel, ctx.aircraftQuat, Math.max(9, contactForceScore))) {
                    partDetachedThisStep = true;
                    node.damage = Math.max(0.18, node.fractureStress * 0.55);
                    if (
                      pk === 'tail' ||
                      pk === 'leftWing' ||
                      pk === 'rightWing' ||
                      pk === 'leftWing_s0' ||
                      pk === 'rightWing_s0'
                    ) {
                      detachedPrimaryStructure = true;
                    }
                  }
                  break;
                }
              }
            }
          } else if (slamSpeed > 4.5 && Math.random() < 0.45) {
            this.spawnShrapnelBurst(
              this._worldPt,
              ctx.aircraftVel,
              Math.max(8, contactForceScore),
              Math.min(12, Math.round(contactForceScore * 0.45)),
            );
          }

          const severeVerticalSlam = slamSpeed >= 8.2 || (!ctx.onRunway && slamSpeed >= 5.2);
          const severeBellyBreakup =
            (node.zone === 'fuselage' || node.zone === 'nose') &&
            node.damage >= 0.78 &&
            (slamSpeed >= 4.2 || !ctx.onRunway);
          if (
            !this.crashed &&
            (hitObstacleName !== '' || severeVerticalSlam || detachedPrimaryStructure || severeBellyBreakup)
          ) {
            triggeredCrashNow = true;
            if (hitObstacleName) {
              crashCause = `Collided with ${hitObstacleName}`;
            } else if (node.zone === 'nose') {
              crashCause = 'Severe Nose Impact & Forward Section Fragmentation';
            } else if (node.zone === 'leftWing' || node.zone === 'rightWing') {
              crashCause = 'Wing Ground Strike & Main Spar Disintegration';
            } else if (node.zone === 'tail') {
              crashCause = 'Excessive Tailstrike & Empennage Breakup';
            } else {
              crashCause = 'High-Energy Airframe Disintegration on Impact';
            }
          }
        }

        // Continuous scraping sparks, dirt plumes & fine shrapnel chips along the strike/crash path
        if (tangentSpeed > 4.5 && Math.random() < (isTailStrikeNode || isWingStrikeNode ? 0.9 : 0.78)) {
          this._tmpVec.copy(ctx.aircraftVel).multiplyScalar(0.35);
          this._tmpVec.x += (Math.random() - 0.5) * 10;
          this._tmpVec.y += 2 + Math.random() * 8;
          this._tmpVec.z += (Math.random() - 0.5) * 10;
          this.spawnParticle(
            this._worldPt,
            this._tmpVec,
            ctx.onRunway ? 'spark' : 'dust',
            ctx.onRunway ? 1.7 : 3.4,
            ctx.onRunway ? 0.55 : 1.15,
          );
          if (tangentSpeed > 15 && (this.crashed || !ctx.gearDown || ctx.gearCollapsed) && Math.random() < 0.24) {
            this.spawnShrapnelBurst(this._worldPt, ctx.aircraftVel, Math.min(20, tangentSpeed * 0.45), 2);
          }
        }
      }
    }

    // Individual or total landing gear failures shear off gear struts/wheels!
    if (ctx.emergencies.noseGearFailure && !this.debris.get('noseGear')?.detached && (ctx.aircraftVel.lengthSq() > 400 || collapseGear)) {
      if (this.detachPart('noseGear', ctx.aircraftVel, ctx.aircraftQuat, 12)) partDetachedThisStep = true;
    }
    if (ctx.emergencies.leftGearFailure && !this.debris.get('leftGear')?.detached && (ctx.aircraftVel.lengthSq() > 400 || collapseGear)) {
      if (this.detachPart('leftGear', ctx.aircraftVel, ctx.aircraftQuat, 12)) partDetachedThisStep = true;
    }
    if (ctx.emergencies.rightGearFailure && !this.debris.get('rightGear')?.detached && (ctx.aircraftVel.lengthSq() > 400 || collapseGear)) {
      if (this.detachPart('rightGear', ctx.aircraftVel, ctx.aircraftQuat, 12)) partDetachedThisStep = true;
    }
    if (collapseGear || ctx.gearCollapsed) {
      for (const gk of this.gearKeys) {
        if (!this.debris.get(gk)?.detached && Math.random() < (maxSeverity > 8 ? 0.85 : 0.25)) {
          if (this.detachPart(gk, ctx.aircraftVel, ctx.aircraftQuat, maxSeverity)) partDetachedThisStep = true;
        }
      }
    }

    if (triggeredCrashNow) {
      this.crashed = true;
      this.crashReason = crashCause;
      if (this.shatterAirframe(ctx.aircraftVel, ctx.aircraftQuat, maxSeverity)) {
        partDetachedThisStep = true;
      }
      const impactOrigin = this._primaryImpactPt.lengthSq() > 0.01 ? this._primaryImpactPt : ctx.aircraftWorldPos;
      this.spawnExplosion(impactOrigin, ctx.aircraftVel, Math.max(22, maxSeverity), 1.05, ctx.groundElevation);
    }

    // Detect 2nd (and subsequent) ground impacts after bouncing/tumbling back into the air!
    const totalContacts = groundContacts + (ctx.gearContacts ?? 0);
    if (totalContacts === 0) {
      this.airborneAfterContactTimer += dt;
    } else if (groundContacts > 0) {
      const speedMag = ctx.aircraftVel.length();
      if (
        !triggeredCrashNow &&
        this.crashed &&
        this.airborneAfterContactTimer >= 0.06 &&
        this.impactBurstCooldown <= 0 &&
        (maxContactSpeed > 2.4 || maxSeverity > 3.6 || speedMag > 7.5)
      ) {
        this.impactBurstCooldown = 0.22;
        const secondForce = Math.max(maxSeverity, maxContactSpeed * 2.1 + speedMag * 0.26, 12);
        secondaryImpactIntensity = secondForce;
        if (
          this.shatterOnSecondaryImpact(
            ctx.aircraftVel,
            ctx.aircraftQuat,
            secondForce,
            this._hitZones,
            this._primaryImpactPt,
            ctx.groundElevation,
          )
        ) {
          partDetachedThisStep = true;
        }
        // Apply additional structural wear on nodes involved in the 2nd impact
        for (const node of this.nodes) {
          if (this._hitZones.has(node.zone)) {
            node.damage = Math.min(1.0, node.damage + 0.22);
          }
        }
      }
      this.airborneAfterContactTimer = 0;
    } else {
      this.airborneAfterContactTimer = 0;
    }

    // Progressive crash-path scraping breakup as fuselage/wings grind along terrain or runway
    const roughnessMult = ctx.onRunway ? 1.0 : 1.65;
    if (
      !triggeredCrashNow &&
      scraping &&
      maxScrapeSpeed > 6.5 &&
      (this.crashed || !ctx.gearDown || ctx.gearCollapsed || maxSeverity > 7.5)
    ) {
      this.scrapeBreakAccum += maxScrapeSpeed * roughnessMult * dt;
      const scrapeBreakThreshold = this.crashed ? 16 : 26;
      if (this.scrapeBreakAccum >= scrapeBreakThreshold && this.scrapeBreakCooldown <= 0) {
        this.scrapeBreakAccum = 0;
        this.scrapeBreakCooldown = 0.22;
        const scrapeForce = Math.max(10, maxScrapeSpeed * 0.42 * roughnessMult);
        if (this.detachNextByZones(this._hitZones, ctx.aircraftVel, ctx.aircraftQuat, scrapeForce)) {
          partDetachedThisStep = true;
        } else {
          // Even after all major assemblies detach, keep shearing jagged skin shards off the scraping hull
          this.spawnShrapnelBurst(
            this._primaryImpactPt,
            ctx.aircraftVel,
            scrapeForce,
            Math.min(14, Math.round(maxScrapeSpeed * 0.32)),
          );
        }
      }
    }

    // Cache active engine fires for detached engine pods & dynamic fire point lighting
    for (let e = 0; e < 4; e++) {
      this.activeEngineFires[e] = Boolean(ctx.emergencies.engineFires[e]);
    }
    this.particleClock += dt;

    // Continuous 3D Engine Fires, Hydraulic Leaks, Fuel Trails (55 Hz + high-speed sub-steps)
    const speedMag = ctx.aircraftVel.length();
    const fireSizeScale = THREE.MathUtils.clamp(this.rig.spec.flight.lengthM / 38, 0.65, 1.55);
    this._exhaustDir.set(0, 0, 1).applyQuaternion(ctx.aircraftQuat);
    this._lightSum.set(0, 0, 0);
    let activeFiresCount = 0;

    const centers = this.rig.engineCenters;
    for (let e = 0; e < Math.min(centers.length, 4); e++) {
      if (!ctx.emergencies.engineFires[e]) continue;
      if (this.debris.get(`enginePod_${e}`)?.detached) continue;
      this._worldPt
        .copy(centers[e])
        .setY(centers[e].y + airframeOffsetY)
        .applyQuaternion(ctx.aircraftQuat)
        .add(ctx.aircraftWorldPos);
      this._lightSum.add(this._worldPt);
      activeFiresCount++;
    }

    this.emergencyEmitterTimer += dt;
    if (this.emergencyEmitterTimer >= 0.018) {
      const emitDt = this.emergencyEmitterTimer;
      this.emergencyEmitterTimer = 0;
      const stepDist = speedMag * emitDt;
      const subSteps = Math.min(6, Math.max(1, Math.ceil(stepDist / 2.4)));

      for (let e = 0; e < Math.min(centers.length, 4); e++) {
        if (!ctx.emergencies.engineFires[e]) continue;
        if (this.debris.get(`enginePod_${e}`)?.detached) continue;

        this._worldPt
          .copy(centers[e])
          .setY(centers[e].y + airframeOffsetY)
          .applyQuaternion(ctx.aircraftQuat)
          .add(ctx.aircraftWorldPos);

        const exhaustBackSpeed = 14 + Math.min(26, speedMag * 0.25);
        for (let s = 0; s < subSteps; s++) {
          const frac = subSteps > 1 ? s / subSteps : 0;
          this._emitSubPos
            .copy(this._worldPt)
            .addScaledVector(ctx.aircraftVel, -emitDt * frac)
            .addScaledVector(this._exhaustDir, 0.8 + frac * 1.4);

          this._emitSubVel
            .copy(ctx.aircraftVel)
            .multiplyScalar(0.28)
            .addScaledVector(this._exhaustDir, exhaustBackSpeed * (0.7 + Math.random() * 0.45));
          this._emitSubVel.x += (Math.random() - 0.5) * 3.2;
          this._emitSubVel.y += 1.4 + Math.random() * 3.4;
          this._emitSubVel.z += (Math.random() - 0.5) * 3.2;

          this.spawnParticle(
            this._emitSubPos,
            this._emitSubVel,
            'fire',
            (1.9 + Math.random() * 0.9) * fireSizeScale,
            0.42 + Math.random() * 0.26,
          );

          // Billowing black soot slightly behind the flame core
          this._emitSubPos.addScaledVector(this._exhaustDir, 1.15);
          this._emitSubVel
            .copy(ctx.aircraftVel)
            .multiplyScalar(0.18)
            .addScaledVector(this._exhaustDir, exhaustBackSpeed * 0.45);
          this._emitSubVel.x += (Math.random() - 0.5) * 4.5;
          this._emitSubVel.y += 2.2 + Math.random() * 4.2;
          this._emitSubVel.z += (Math.random() - 0.5) * 4.5;
          this.spawnParticle(
            this._emitSubPos,
            this._emitSubVel,
            'smoke',
            (2.4 + Math.random() * 1.1) * fireSizeScale,
            2.1 + Math.random() * 1.1,
          );

          if (s === 0 && Math.random() < 0.35) {
            this._emitSubVel.x += (Math.random() - 0.5) * 12;
            this._emitSubVel.y += 2 + Math.random() * 8;
            this._emitSubVel.z += (Math.random() - 0.5) * 12;
            this.spawnParticle(this._emitSubPos, this._emitSubVel, 'spark', 0.8, 0.45 + Math.random() * 0.3);
          }
        }
      }

      if (ctx.emergencies.fuelLeak) {
        this._worldPt
          .set(-this.rig.spec.flight.wingspanM * 0.25, airframeOffsetY + 1.2, 0.8)
          .applyQuaternion(ctx.aircraftQuat)
          .add(ctx.aircraftWorldPos);
        this._emitSubVel.copy(ctx.aircraftVel).multiplyScalar(0.22);
        this._emitSubVel.y += 0.4;
        this.spawnParticle(this._worldPt, this._emitSubVel, 'smoke', 1.6, 1.15, [0.88, 0.92, 0.96]);
      }

      if (ctx.emergencies.hydraulicFailure && Math.random() < 0.55) {
        this._worldPt
          .set(0, airframeOffsetY + 0.6, 2.0)
          .applyQuaternion(ctx.aircraftQuat)
          .add(ctx.aircraftWorldPos);
        this._emitSubVel.copy(ctx.aircraftVel).multiplyScalar(0.18);
        this._emitSubVel.y -= 0.8;
        this.spawnParticle(this._worldPt, this._emitSubVel, 'smoke', 1.25, 0.85, [0.35, 0.78, 0.48]);
      }
    }

    // Continuous billowing smoke & flame core on crashed or fractured airframe
    const integrity = this.computeIntegrity();
    if (this.crashed || integrity < 68) {
      this._lightSum.add(ctx.aircraftWorldPos);
      activeFiresCount++;
      this.fireEmitterTimer += dt;
      if (this.fireEmitterTimer >= 0.022) {
        this.fireEmitterTimer = 0;
        const hullSpread = THREE.MathUtils.clamp(this.rig.spec.flight.lengthM * 0.24, 3.0, 12.0);
        this._worldPt
          .set((Math.random() - 0.5) * 3.2, airframeOffsetY + 0.45, (Math.random() - 0.5) * hullSpread)
          .applyQuaternion(ctx.aircraftQuat)
          .add(ctx.aircraftWorldPos);
        this._emitSubVel.set(
          ctx.aircraftVel.x * 0.2 + (Math.random() - 0.5) * 4.5,
          3.8 + Math.random() * 5.8,
          ctx.aircraftVel.z * 0.2 + (Math.random() - 0.5) * 4.5,
        );
        this.spawnParticle(this._worldPt, this._emitSubVel, 'smoke', 2.8 * fireSizeScale, 2.5 + Math.random() * 1.1);
        if (this.crashed || integrity < 48) {
          this.spawnParticle(this._worldPt, this._emitSubVel, 'fire', 2.1 * fireSizeScale, 0.55 + Math.random() * 0.35);
          if (Math.random() < 0.45) {
            this._emitSubVel.y += 4.5 + Math.random() * 6;
            this._emitSubVel.x += (Math.random() - 0.5) * 10;
            this._emitSubVel.z += (Math.random() - 0.5) * 10;
            this.spawnParticle(this._worldPt, this._emitSubVel, 'spark', 0.85, 0.65);
          }
        }
      }
    }

    // Flickering dynamic PointLight tracking active fire centroid + intense impact explosion flash
    this.explosionFlash *= Math.exp(-5.8 * dt);
    if (this.explosionFlash > 1.5) {
      this.fireLight.position.copy(this.explosionFlashPos);
      this.fireLight.distance = 175;
      this.fireLight.color.setHex(0xffa458);
      this.fireLight.intensity = this.explosionFlash + (activeFiresCount > 0 ? 12 : 0);
    } else if (activeFiresCount > 0) {
      this._lightSum.divideScalar(activeFiresCount);
      this.fireLight.position.copy(this._lightSum);
      this.fireLight.distance = 95;
      this.fireLight.color.setHex(0xff7722);
      const t = this.particleClock;
      const flicker = 0.78 + Math.sin(t * 24.3) * 0.14 + Math.sin(t * 41.7) * 0.11 + Math.random() * 0.16;
      this.fireLight.intensity = Math.min(26, (7.5 + activeFiresCount * 3.8) * flicker);
    } else {
      this.fireLight.intensity = 0;
    }

    // Subtle elastic wing flex while intact
    if (!this.debris.get('leftWing')?.detached) {
      const targetFlex = THREE.MathUtils.clamp((ctx.liftLoadFactor - 1.0) * 0.018, -0.025, 0.045);
      this.rig.leftWingGroup.rotation.z = THREE.MathUtils.lerp(this.rig.leftWingGroup.rotation.z, -targetFlex, dt * 6);
    }
    if (!this.debris.get('rightWing')?.detached) {
      const targetFlex = THREE.MathUtils.clamp((ctx.liftLoadFactor - 1.0) * 0.018, -0.025, 0.045);
      this.rig.rightWingGroup.rotation.z = THREE.MathUtils.lerp(this.rig.rightWingGroup.rotation.z, targetFlex, dt * 6);
    }

    if (this.updateDebrisBodies(dt, ctx.groundElevation)) {
      partDetachedThisStep = true;
    }
    this.updateExplosions(dt);
    this.updateShrapnel(dt, ctx.groundElevation);
    this.updateBirds(dt);
    this.updateParticles(dt, ctx.windVel);

    const gApprox = 1.0 + this._totalForce.y / (this.rig.spec.flight.massKg * 9.81);
    this.peakG = Math.max(this.peakG, Math.abs(gApprox), secondaryImpactIntensity / 2.2);

    return {
      totalImpulse: this._totalForce,
      angularImpulse: this._totalTorque,
      groundContacts,
      scraping,
      scrapeIntensity,
      hardImpactG: maxContactSpeed / 3.0,
      secondaryImpactIntensity,
      partDetachedThisStep,
      collapseGear,
      crashed: this.crashed,
      crashReason: this.crashReason,
      integrityPercent: integrity,
      zones: this.getZoneHealth(),
      detachedParts: this.getDetachedParts(),
      fragmentCount: this.activeShrapnelCount + this.getDetachedParts().length,
    };
  }

  private updateDebrisBodies(dt: number, groundH: number): boolean {
    let subPartDetached = false;
    this.debris.forEach((d) => {
      if (!d.detached) return;
      d.impactCooldown = Math.max(0, d.impactCooldown - dt);
      d.vel.y -= 9.81 * dt;
      d.group.position.addScaledVector(d.vel, dt);
      d.group.rotation.x += d.angVel.x * dt;
      d.group.rotation.y += d.angVel.y * dt;
      d.group.rotation.z += d.angVel.z * dt;

      this._worldPt.copy(d.localCom).applyQuaternion(d.group.quaternion).add(d.group.position);
      const minY = groundH + d.minRadius;
      if (this._worldPt.y < minY) {
        const downSpeed = -d.vel.y;
        d.group.position.y += minY - this._worldPt.y;
        d.vel.y = Math.abs(d.vel.y) * 0.34;
        d.vel.x *= 0.86;
        d.vel.z *= 0.86;
        d.angVel.multiplyScalar(0.75);

        // Detached assembly slamming into ground on 1st or 2nd bounce breaks into additional fragments!
        if (downSpeed > 3.6 && d.impactCooldown <= 0) {
          d.impactCooldown = 0.25;
          const burstCount = Math.min(14, Math.max(4, Math.round(downSpeed * 0.95)));
          this.spawnShrapnelBurst(this._worldPt, d.vel, downSpeed * 1.8, burstCount);
          for (let i = 0; i < 6; i++) {
            this.spawnParticle(
              this._worldPt,
              new THREE.Vector3((Math.random() - 0.5) * 9, 2.5 + Math.random() * 5, (Math.random() - 0.5) * 9),
              i % 2 === 0 ? 'spark' : 'dust',
              2.2,
              0.7,
            );
          }
          if ((d.key === 'leftWing' || d.key === 'rightWing') && downSpeed > 6.5) {
            for (const subKey of [`${d.key}_s2`, `${d.key}_s1`, `${d.key}_s0`]) {
              const sub = this.debris.get(subKey);
              if (sub && !sub.detached && this.detachPart(subKey, d.vel, undefined, downSpeed * 2.0)) {
                subPartDetached = true;
                break;
              }
            }
          }
          if ((d.key.startsWith('enginePod_') && downSpeed > 7.5) || downSpeed > 13.0) {
            this.spawnExplosion(this._worldPt, d.vel, downSpeed * 1.9, 0.52, groundH);
          }
        } else if (d.vel.lengthSq() > 14 && Math.random() < 0.45) {
          this._emitSubVel.set((Math.random() - 0.5) * 6, 3.5, (Math.random() - 0.5) * 6);
          this.spawnParticle(this._worldPt, this._emitSubVel, 'spark', 1.2, 0.5);
        }
      } else if (d.vel.lengthSq() > 25 && Math.random() < 0.38) {
        this._emitSubVel.set((Math.random() - 0.5) * 2.5, 2.4, (Math.random() - 0.5) * 2.5);
        this.spawnParticle(this._worldPt, this._emitSubVel, 'smoke', 2.2, 1.45);
      }

      // Detached burning engine pod keeps burning & smoking on the ground or in mid-air!
      if (d.key.startsWith('enginePod_')) {
        const engIdx = Number(d.key.slice('enginePod_'.length));
        if (Number.isInteger(engIdx) && this.activeEngineFires[engIdx] && Math.random() < Math.min(1, dt * 45)) {
          this._emitSubVel.set(
            d.vel.x * 0.25 + (Math.random() - 0.5) * 3.5,
            3.2 + Math.random() * 4.5,
            d.vel.z * 0.25 + (Math.random() - 0.5) * 3.5,
          );
          this.spawnParticle(this._worldPt, this._emitSubVel, 'fire', 1.8, 0.5);
          this.spawnParticle(this._worldPt, this._emitSubVel, 'smoke', 2.4, 2.0);
        }
      }
    });
    return subPartDetached;
  }

  private updateExplosions(dt: number) {
    for (let i = 0; i < this.explosions.length; i++) {
      const b = this.explosions[i];
      if (!b.active) continue;
      b.life += dt;
      const t = b.life / b.maxLife;
      if (t >= 1) {
        b.active = false;
        b.fireballMesh.visible = false;
        b.shockwaveMesh.visible = false;
        continue;
      }

      b.vel.multiplyScalar(Math.max(0, 1 - dt * 2.4));
      b.origin.addScaledVector(b.vel, dt);
      b.origin.y += dt * 3.8; // rising fireball buoyancy

      const radiusCurve = Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.5);
      const radius = 1.1 + b.maxRadius * radiusCurve;
      b.fireballMesh.position.copy(b.origin);
      b.fireballMesh.scale.set(radius, radius * (0.92 + t * 0.25), radius);
      b.fireballMat.uniforms.uProgress.value = t;

      const waveProgress = Math.min(1, t * 1.45);
      if (waveProgress < 1) {
        b.shockwaveMesh.visible = true;
        b.shockwaveMesh.position.x = b.origin.x;
        b.shockwaveMesh.position.z = b.origin.z;
        const waveRadius = 1.5 + b.maxRadius * 2.6 * (1 - Math.pow(1 - waveProgress, 2.2));
        b.shockwaveMesh.scale.setScalar(waveRadius);
        b.shockwaveMat.uniforms.uProgress.value = waveProgress;
      } else {
        b.shockwaveMesh.visible = false;
      }
    }
  }

  private updateShrapnel(dt: number, groundH: number) {
    let activeCount = 0;
    let dirty = false;

    for (let i = 0; i < this.maxShrapnel; i++) {
      const bit = this.shrapnel[i];
      if (!bit.active) continue;

      activeCount++;
      dirty = true;
      bit.life += dt;
      bit.vel.y -= 9.81 * dt;
      bit.vel.x *= 1 - dt * 0.28;
      bit.vel.z *= 1 - dt * 0.28;
      bit.pos.addScaledVector(bit.vel, dt);

      this._dummyEuler.set(bit.angVel.x * dt, bit.angVel.y * dt, bit.angVel.z * dt);
      this._dummyQuat.setFromEuler(this._dummyEuler);
      bit.quat.multiply(this._dummyQuat).normalize();

      const minY = groundH + 0.08;
      if (bit.pos.y < minY) {
        bit.pos.y = minY;
        bit.vel.y = Math.abs(bit.vel.y) * 0.32;
        bit.vel.x *= 0.78;
        bit.vel.z *= 0.78;
        bit.angVel.multiplyScalar(0.68);
        if (bit.vel.lengthSq() > 18 && Math.random() < 0.14) {
          this._emitSubVel.set(0, 2.2, 0);
          this.spawnParticle(bit.pos, this._emitSubVel, 'spark', 1.1, 0.35);
        }
      }

      this._dummyMat.compose(bit.pos, bit.quat, bit.scale);
      this.shrapnelMesh.setMatrixAt(i, this._dummyMat);
    }

    this.activeShrapnelCount = activeCount;
    if (dirty) {
      this.shrapnelMesh.instanceMatrix.needsUpdate = true;
    }
  }

  private updateBirds(dt: number) {
    let dirty = false;
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];
      if (!b.active) continue;
      dirty = true;
      b.phase += dt * 16;
      b.pos.addScaledVector(b.vel, dt);
      b.vel.y -= 4.2 * dt;
      if (b.pos.y < 0.2 || b.phase > 95) {
        b.active = false;
        this._dummyMat.compose(b.pos, this._dummyQuat, this._zeroScale);
      } else {
        this._dummyEuler.set(Math.sin(b.phase) * 0.4, b.phase * 0.2, Math.cos(b.phase) * 0.6);
        this._dummyQuat.setFromEuler(this._dummyEuler);
        this._tmpVec.set(1.2, 1.0, 1.2);
        this._dummyMat.compose(b.pos, this._dummyQuat, this._tmpVec);
      }
      this.birdMesh.setMatrixAt(i, this._dummyMat);
    }
    if (dirty) {
      this.birdMesh.instanceMatrix.needsUpdate = true;
    }
  }

  private updateParticlePool(
    pool: Particle[],
    maxCount: number,
    geo: THREE.BufferGeometry,
    dt: number,
    windVel: THREE.Vector3 | undefined,
    isFireLayer: boolean,
  ) {
    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    const colAttr = geo.attributes.aColor as THREE.BufferAttribute;
    const attrAttr = geo.attributes.aAlphaSizeRot as THREE.BufferAttribute;
    const posArr = posAttr.array as Float32Array;
    const colArr = colAttr.array as Float32Array;
    const asrArr = attrAttr.array as Float32Array;

    for (let i = 0; i < maxCount; i++) {
      const p = pool[i];
      const idx3 = i * 3;
      const idx4 = i * 4;
      if (!p.active) {
        posArr[idx3] = 0;
        posArr[idx3 + 1] = -999;
        posArr[idx3 + 2] = 0;
        asrArr[idx4] = 0;
        continue;
      }

      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        posArr[idx3 + 1] = -999;
        asrArr[idx4] = 0;
        continue;
      }

      const t = p.life / p.maxLife;
      p.rot += p.rotVel * dt;

      if (p.kind === 'spark') {
        p.vel.y -= 17.5 * dt;
        p.vel.x *= 1 - dt * 0.5;
        p.vel.z *= 1 - dt * 0.5;
      } else if (p.kind === 'fire') {
        p.vel.multiplyScalar(1 - dt * 2.2);
        p.vel.y += 5.2 * dt; // strong thermal buoyancy
        const curl = Math.sin(this.particleClock * 7.5 + i * 1.7) * p.turbulence * dt * 3.0;
        p.vel.x += curl;
        p.vel.z += Math.cos(this.particleClock * 6.9 + i * 2.1) * p.turbulence * dt * 3.0;
      } else {
        p.vel.multiplyScalar(1 - dt * 1.55);
        p.vel.y += (p.kind === 'dust' ? 1.2 : 2.8) * dt;
        p.vel.x += Math.sin(this.particleClock * 2.3 + i * 1.3) * p.turbulence * dt * 1.8;
        p.vel.z += Math.cos(this.particleClock * 2.1 + i * 1.9) * p.turbulence * dt * 1.8;
        if (windVel) {
          p.pos.x += windVel.x * dt * 0.72;
          p.pos.z += windVel.z * dt * 0.72;
        }
      }

      p.pos.addScaledVector(p.vel, dt);
      posArr[idx3] = p.pos.x;
      posArr[idx3 + 1] = p.pos.y;
      posArr[idx3 + 2] = p.pos.z;

      let alpha = 0;
      let size = p.initialSize;
      let r = p.color.r;
      let g = p.color.g;
      let b = p.color.b;

      if (p.kind === 'fire') {
        const riseIn = Math.min(1, t / 0.14);
        const fadeOut = Math.pow(1 - t, 1.35);
        alpha = riseIn * fadeOut * 0.92;
        size = p.initialSize + p.growth * Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.5);
        if (!p.hasCustomColor) {
          if (t < 0.22) {
            const k = t / 0.22;
            r = 1.0;
            g = 0.95 - k * 0.35;
            b = 0.72 - k * 0.55;
          } else if (t < 0.62) {
            const k = (t - 0.22) / 0.4;
            r = 1.0 - k * 0.08;
            g = 0.60 - k * 0.36;
            b = 0.17 - k * 0.14;
          } else {
            const k = (t - 0.62) / 0.38;
            r = 0.92 - k * 0.28;
            g = 0.24 - k * 0.16;
            b = 0.03;
          }
        }
      } else if (p.kind === 'spark') {
        alpha = Math.pow(1 - t, 0.85);
        size = Math.max(0.28, p.initialSize + p.growth * t);
        if (!p.hasCustomColor) {
          r = 1.0;
          g = 0.86 - t * 0.58;
          b = 0.35 - t * 0.32;
        }
      } else {
        // Volumetric smoke or dust
        const riseIn = Math.min(1, t / 0.12);
        const fadeOut = Math.pow(1 - t, 1.25);
        alpha = riseIn * fadeOut * (p.kind === 'dust' ? 0.56 : p.hasCustomColor ? 0.62 : 0.72);
        size = p.initialSize + p.growth * Math.pow(t, 0.76);
        if (!p.hasCustomColor && p.kind === 'smoke') {
          if (t < 0.18) {
            const k = t / 0.18;
            r = 0.06 + k * 0.10;
            g = 0.06 + k * 0.10;
            b = 0.07 + k * 0.10;
          } else {
            const k = (t - 0.18) / 0.82;
            r = 0.16 + k * 0.12;
            g = 0.16 + k * 0.13;
            b = 0.17 + k * 0.14;
          }
        }
      }

      colArr[idx3] = r;
      colArr[idx3 + 1] = g;
      colArr[idx3 + 2] = b;
      asrArr[idx4] = alpha;
      asrArr[idx4 + 1] = size;
      asrArr[idx4 + 2] = p.rot;
      asrArr[idx4 + 3] = isFireLayer ? (p.kind === 'spark' ? 1.0 : 0.0) : p.kind === 'dust' ? 1.0 : 0.0;
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    attrAttr.needsUpdate = true;
  }

  private updateParticles(dt: number, windVel?: THREE.Vector3) {
    if (typeof window !== 'undefined') {
      const pixelScale = Math.max(320, window.innerHeight * 0.94);
      this.smokeMat.uniforms.uPixelScale.value = pixelScale;
      this.fireMat.uniforms.uPixelScale.value = pixelScale;
    }
    this.fireMat.uniforms.uTime.value = this.particleClock;
    this.updateParticlePool(this.smokePool, this.maxSmoke, this.smokeGeo, dt, windVel, false);
    this.updateParticlePool(this.firePool, this.maxFire, this.fireGeo, dt, windVel, true);
  }

  private getZoneHealth(): StructuralZoneHealth {
    const avg = (zone: keyof StructuralZoneHealth) => {
      const list = this.nodes.filter((n) => n.zone === zone);
      if (list.length === 0) return 100;
      const sum = list.reduce((acc, n) => acc + n.damage, 0);
      return Math.max(0, Math.round((1 - sum / list.length) * 100));
    };

    const zoneFractionIntact = (zone: keyof StructuralZoneHealth): number => {
      let total = 0;
      let intact = 0;
      this.debris.forEach((d) => {
        if (d.zone === zone) {
          total++;
          if (!d.detached) intact++;
        }
      });
      return total > 0 ? Math.round((intact / total) * 100) : 100;
    };

    const engDetached = this.engineKeys.filter((k) => this.debris.get(k)?.detached).length;
    const engHealth =
      this.engineKeys.length > 0
        ? Math.min(avg('engines'), Math.round(((this.engineKeys.length - engDetached) / this.engineKeys.length) * 100))
        : avg('engines');
    const gearDetached = this.gearKeys.filter((k) => this.debris.get(k)?.detached).length;
    const gearHealth =
      this.gearKeys.length > 0
        ? Math.round(((this.gearKeys.length - gearDetached) / this.gearKeys.length) * 100)
        : 100;

    return {
      nose: Math.min(avg('nose'), zoneFractionIntact('nose')),
      fuselage: Math.min(avg('fuselage'), zoneFractionIntact('fuselage')),
      leftWing: Math.min(avg('leftWing'), zoneFractionIntact('leftWing')),
      rightWing: Math.min(avg('rightWing'), zoneFractionIntact('rightWing')),
      tail: Math.min(avg('tail'), zoneFractionIntact('tail')),
      engines: engHealth,
      gear: gearHealth,
    };
  }

  private computeIntegrity(): number {
    const z = this.getZoneHealth();
    return Math.round((z.nose + z.fuselage + z.leftWing + z.rightWing + z.tail + z.engines + z.gear) / 7);
  }

  private getDetachedParts(): string[] {
    const out: string[] = [];
    this.debris.forEach((d) => {
      if (d.detached) out.push(d.label);
    });
    return out;
  }

  public reset() {
    this.crashed = false;
    this.crashReason = '';
    this.peakG = 1.0;
    this.activeShrapnelCount = 0;
    this.airborneAfterContactTimer = 0;
    this.impactBurstCooldown = 0;
    this.scrapeBreakAccum = 0;
    this.scrapeBreakCooldown = 0;
    this.scrapePhase = 0;
    this._hitZones.clear();

    for (const node of this.nodes) {
      node.damage = 0;
    }

    this.debris.forEach((d) => {
      if (d.detached) {
        this.scene.remove(d.group);
        d.origParent.add(d.group);
        d.group.position.copy(d.origPos);
        d.group.rotation.copy(d.origRot);
        d.group.visible = true;
        d.detached = false;
      }
      d.vel.set(0, 0, 0);
      d.angVel.set(0, 0, 0);
      d.impactCooldown = 0;
    });

    for (let i = 0; i < this.maxShrapnel; i++) {
      this.shrapnel[i].active = false;
      this.shrapnel[i].pos.set(0, -500, 0);
      this._dummyMat.compose(this.shrapnel[i].pos, this._dummyQuat, this._zeroScale);
      this.shrapnelMesh.setMatrixAt(i, this._dummyMat);
    }
    this.shrapnelMesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < this.birds.length; i++) {
      this.birds[i].active = false;
      this.birds[i].pos.set(0, -500, 0);
      this._dummyMat.compose(this.birds[i].pos, this._dummyQuat, this._zeroScale);
      this.birdMesh.setMatrixAt(i, this._dummyMat);
    }
    this.birdMesh.instanceMatrix.needsUpdate = true;

    for (const p of this.smokePool) {
      p.active = false;
      p.pos.set(0, -999, 0);
    }
    for (const p of this.firePool) {
      p.active = false;
      p.pos.set(0, -999, 0);
    }
    for (const b of this.explosions) {
      b.active = false;
      b.fireballMesh.visible = false;
      b.shockwaveMesh.visible = false;
    }
    this.explosionFlash = 0;
    this.fireLight.intensity = 0;
    this.activeEngineFires.fill(false);
    this.updateParticles(0, undefined);
  }

  public dispose() {
    this.scene.remove(this.smokePoints);
    this.smokeGeo.dispose();
    this.smokeMat.dispose();
    this.smokeTex.dispose();

    this.scene.remove(this.firePoints);
    this.fireGeo.dispose();
    this.fireMat.dispose();
    this.fireTex.dispose();

    for (const b of this.explosions) {
      this.scene.remove(b.fireballMesh);
      b.fireballMat.dispose();
      this.scene.remove(b.shockwaveMesh);
      b.shockwaveMat.dispose();
    }
    this.explosionSphereGeo.dispose();
    this.shockwaveRingGeo.dispose();

    this.scene.remove(this.fireLight);

    this.scene.remove(this.shrapnelMesh);
    this.shrapnelGeo.dispose();
    this.shrapnelMat.dispose();

    this.scene.remove(this.birdMesh);
    this.birdGeo.dispose();
    this.birdMat.dispose();
  }
}
