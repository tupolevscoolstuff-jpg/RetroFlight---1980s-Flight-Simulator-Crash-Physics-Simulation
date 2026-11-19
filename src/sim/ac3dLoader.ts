import * as THREE from 'three';
import {AircraftSpec, AircraftVariant} from './aircraftCatalog';
import {CockpitRig, createCockpitRig} from './cockpitRig';
import {buildDc9FamilyRig} from './dc9Builder';
import {StructuralZoneHealth} from './types';
import {
  applyPreGroundVariantGeometry,
  attachPostGroundVariantParts,
  shouldFilterMeshForVariant,
} from './variantGeometry';

export type ControlSurfaceKind =
  | 'flap'
  | 'slat'
  | 'aileron'
  | 'elevator'
  | 'elevon'
  | 'rudder'
  | 'spoiler';

export interface ControlSurfaceEntry {
  kind: ControlSurfaceKind;
  side: -1 | 0 | 1;
  pivot: THREE.Group;
  basePos: THREE.Vector3;
  hingeAxis: THREE.Vector3;
  chordM: number;
}

export interface EnginePodEntry {
  group: THREE.Group;
  label: string;
}

export interface SubPieceEntry {
  key: string;
  group: THREE.Group;
  zone: keyof StructuralZoneHealth;
  label: string;
  fractureThreshold: number;
}

export interface LoadedAircraftRig {
  spec: AircraftSpec;
  variantId: string;
  root: THREE.Group;
  airframeGroup: THREE.Group;
  fuselageGroup: THREE.Group;
  aftFuselageGroup: THREE.Group;
  leftWingGroup: THREE.Group;
  rightWingGroup: THREE.Group;
  tailGroup: THREE.Group;
  leftHStabGroup: THREE.Group;
  rightHStabGroup: THREE.Group;
  enginesGroup: THREE.Group;
  enginePods: EnginePodEntry[];
  engineCenters: THREE.Vector3[];
  subPieces: SubPieceEntry[];
  noseGroup: THREE.Group;
  noseGearGroup: THREE.Group;
  leftGearGroup: THREE.Group;
  rightGearGroup: THREE.Group;
  gearContactPoints: {
    nose: THREE.Vector3;
    left: THREE.Vector3;
    right: THREE.Vector3;
  };
  gearMeshes: THREE.Object3D[];
  openGearDoorMeshes: THREE.Object3D[];
  closedGearDoorMeshes: THREE.Object3D[];
  wheelMeshes: THREE.Object3D[];
  fanMeshes: THREE.Object3D[];
  propGroups: THREE.Object3D[];
  visorMeshes: THREE.Object3D[];
  controlSurfaces: ControlSurfaceEntry[];
  cockpitRig: CockpitRig;
  cockpitHiddenMeshes: THREE.Object3D[];
  strobeLights: THREE.Mesh[];
  beaconLights: THREE.Mesh[];
  landingLightBeam: THREE.SpotLight;
  liveryMaterials: THREE.MeshStandardMaterial[];
  groundClearanceY: number;
  setLiveryTexture: (textureUrl: string) => Promise<void>;
  dispose: () => void;
}

interface AcMaterialDef {
  name: string;
  rgb: [number, number, number];
  emis: [number, number, number];
  spec: [number, number, number];
  shi: number;
  trans: number;
}

interface AcSurface {
  flags: number;
  matIdx: number;
  refs: Array<{idx: number; u: number; v: number}>;
}

interface AcNode {
  type: string;
  name: string;
  loc: [number, number, number];
  rot: number[];
  texture: string;
  texrep: [number, number];
  texoff: [number, number];
  verts: Array<[number, number, number]>;
  surfs: AcSurface[];
  kids: AcNode[];
}

const acTextCache = new Map<string, string>();
const textureLoader = new THREE.TextureLoader();

const SKIP_NAME_RE =
  /lightcone|taxilight|landinglight|\.spot\b|hotspot|shadow|halo|corona|_dummy\b|collision|bounding|\.dazzle\b|\.light\b|\.glow\b|\.flare\b|afterburner|reheat|^fx$|^stair\d|^porteechelle/i;

function tokenizeLine(line: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const len = line.length;
  while (i < len) {
    while (i < len && (line[i] === ' ' || line[i] === '\t' || line[i] === '\r')) i++;
    if (i >= len) break;
    if (line[i] === '"') {
      i++;
      const start = i;
      while (i < len && line[i] !== '"') i++;
      tokens.push(line.slice(start, i));
      if (i < len && line[i] === '"') i++;
    } else {
      const start = i;
      while (i < len && line[i] !== ' ' && line[i] !== '\t' && line[i] !== '\r') i++;
      tokens.push(line.slice(start, i));
    }
  }
  return tokens;
}

function parseAc3dText(text: string): {materials: AcMaterialDef[]; roots: AcNode[]} {
  const lines = text.split(/\r?\n/);
  const materials: AcMaterialDef[] = [];
  const roots: AcNode[] = [];
  let cursor = 0;

  if (lines[0]?.startsWith('AC3D')) cursor = 1;

  function parseObject(): AcNode {
    const first = tokenizeLine(lines[cursor++] || '');
    const node: AcNode = {
      type: first[1] || 'poly',
      name: '',
      loc: [0, 0, 0],
      rot: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      texture: '',
      texrep: [1, 1],
      texoff: [0, 0],
      verts: [],
      surfs: [],
      kids: [],
    };
    let kidCount = 0;

    while (cursor < lines.length) {
      const raw = lines[cursor++].trim();
      if (!raw) continue;
      if (raw.startsWith('MATERIAL ')) continue;
      const tok = tokenizeLine(raw);
      const key = tok[0];
      if (key === 'name') {
        node.name = tok[1] || '';
      } else if (key === 'loc') {
        node.loc = [parseFloat(tok[1]) || 0, parseFloat(tok[2]) || 0, parseFloat(tok[3]) || 0];
      } else if (key === 'rot') {
        node.rot = tok.slice(1, 10).map((n) => parseFloat(n) || 0);
        if (node.rot.length < 9) node.rot = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      } else if (key === 'texture') {
        node.texture = tok[1] || '';
      } else if (key === 'texrep') {
        node.texrep = [parseFloat(tok[1]) || 1, parseFloat(tok[2]) || 1];
      } else if (key === 'texoff') {
        node.texoff = [parseFloat(tok[1]) || 0, parseFloat(tok[2]) || 0];
      } else if (key === 'numvert') {
        const count = parseInt(tok[1], 10) || 0;
        for (let v = 0; v < count && cursor < lines.length; v++) {
          const vt = lines[cursor++].trim().split(/\s+/);
          node.verts.push([parseFloat(vt[0]) || 0, parseFloat(vt[1]) || 0, parseFloat(vt[2]) || 0]);
        }
      } else if (key === 'numsurf') {
        const count = parseInt(tok[1], 10) || 0;
        for (let s = 0; s < count && cursor < lines.length; s++) {
          let flags = 0;
          let matIdx = 0;
          const refs: Array<{idx: number; u: number; v: number}> = [];
          while (cursor < lines.length) {
            const sl = lines[cursor++].trim();
            if (!sl) continue;
            if (sl.startsWith('SURF ')) {
              flags = parseInt(sl.slice(5).trim(), 0) || 0;
            } else if (sl.startsWith('mat ')) {
              matIdx = parseInt(sl.slice(4).trim(), 10) || 0;
            } else if (sl.startsWith('refs ')) {
              const rCount = parseInt(sl.slice(5).trim(), 10) || 0;
              for (let r = 0; r < rCount && cursor < lines.length; r++) {
                const rt = lines[cursor++].trim().split(/\s+/);
                refs.push({
                  idx: parseInt(rt[0], 10) || 0,
                  u: parseFloat(rt[1]) || 0,
                  v: parseFloat(rt[2]) || 0,
                });
              }
              break;
            }
          }
          node.surfs.push({flags, matIdx, refs});
        }
      } else if (key === 'kids') {
        kidCount = parseInt(tok[1], 10) || 0;
        break;
      }
    }

    for (let k = 0; k < kidCount && cursor < lines.length; k++) {
      while (cursor < lines.length && !lines[cursor].trim().startsWith('OBJECT ')) {
        cursor++;
      }
      if (cursor < lines.length) {
        node.kids.push(parseObject());
      }
    }
    return node;
  }

  while (cursor < lines.length) {
    const raw = lines[cursor].trim();
    if (!raw) {
      cursor++;
      continue;
    }
    if (raw.startsWith('MATERIAL ')) {
      const tok = tokenizeLine(raw);
      const getVec = (tag: string, def: [number, number, number]): [number, number, number] => {
        const i = tok.indexOf(tag);
        if (i >= 0 && i + 3 < tok.length) {
          return [parseFloat(tok[i + 1]) || 0, parseFloat(tok[i + 2]) || 0, parseFloat(tok[i + 3]) || 0];
        }
        return def;
      };
      const getNum = (tag: string, def: number): number => {
        const i = tok.indexOf(tag);
        return i >= 0 && i + 1 < tok.length ? parseFloat(tok[i + 1]) || def : def;
      };
      materials.push({
        name: tok[1] || 'mat',
        rgb: getVec('rgb', [0.85, 0.85, 0.85]),
        emis: getVec('emis', [0, 0, 0]),
        spec: getVec('spec', [0.4, 0.4, 0.4]),
        shi: getNum('shi', 32),
        trans: getNum('trans', 0),
      });
      cursor++;
    } else if (raw.startsWith('OBJECT ')) {
      roots.push(parseObject());
    } else {
      cursor++;
    }
  }

  return {materials, roots};
}

function getBaseName(pathStr: string): string {
  const idx = Math.max(pathStr.lastIndexOf('/'), pathStr.lastIndexOf('\\'));
  return idx >= 0 ? pathStr.slice(idx + 1) : pathStr;
}

function loadTextureAsync(url: string, maxAniso: number): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    textureLoader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.flipY = true;
        tex.anisotropy = Math.min(4, maxAniso);
        tex.needsUpdate = true;
        resolve(tex);
      },
      undefined,
      () => resolve(null),
    );
  });
}

function isGlassLike(name: string, texBase: string, matName: string, trans: number): boolean {
  if (trans > 0.06) return true;
  const s = `${name} ${texBase} ${matName}`;
  return /glass|window|windshield|canopy|vitre|verriere|transparent|nowindows|window_black/i.test(s);
}

function isSoftwareGlassOrProp(name: string, trans: number): boolean {
  if (trans > 0.1) return true;
  return /glass|window|canopy|vitre|windshield|transparent|prop/i.test(name);
}

/**
 * Rotate geometry vertices around an arbitrary pivot point & Euler axis in airframe space.
 * Used to unfold Citation II's stowed AC3D gear cleanly before ground-box calculation.
 */
function rotateGeometryAboutPivot(
  geo: THREE.BufferGeometry,
  pivot: THREE.Vector3,
  euler: THREE.Euler,
) {
  const posAttr = geo.attributes.position as THREE.BufferAttribute;
  const normAttr = geo.attributes.normal as THREE.BufferAttribute;
  const q = new THREE.Quaternion().setFromEuler(euler);
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (let i = 0; i < posAttr.count; i++) {
    v.fromBufferAttribute(posAttr, i).sub(pivot).applyQuaternion(q).add(pivot);
    posAttr.setXYZ(i, v.x, v.y, v.z);
    n.fromBufferAttribute(normAttr, i).applyQuaternion(q).normalize();
    normAttr.setXYZ(i, n.x, n.y, n.z);
  }
  posAttr.needsUpdate = true;
  normAttr.needsUpdate = true;
  geo.computeBoundingBox();
}

/**
 * Split a combined BufferGeometry cleanly by triangle centroid so merged AC3D parts
 * (e.g., left+right wings, nose+fuselage+aft tail, left+right hstab, multiple engines)
 * break off cleanly as crisp rigid pieces with ZERO polygon stretching.
 */
function splitGeometryByKey(
  geo: THREE.BufferGeometry,
  classifyTri: (cx: number, cy: number, cz: number) => string,
): Array<{tag: string; geometry: THREE.BufferGeometry}> {
  const posAttr = geo.attributes.position as THREE.BufferAttribute;
  const normAttr = geo.attributes.normal as THREE.BufferAttribute;
  const uvAttr = geo.attributes.uv as THREE.BufferAttribute;

  const groups = new Map<string, {pos: number[]; norm: number[]; uv: number[]}>();
  const triCount = Math.floor(posAttr.count / 3);

  for (let t = 0; t < triCount; t++) {
    const i0 = t * 3;
    const i1 = i0 + 1;
    const i2 = i0 + 2;
    const cx = (posAttr.getX(i0) + posAttr.getX(i1) + posAttr.getX(i2)) / 3;
    const cy = (posAttr.getY(i0) + posAttr.getY(i1) + posAttr.getY(i2)) / 3;
    const cz = (posAttr.getZ(i0) + posAttr.getZ(i1) + posAttr.getZ(i2)) / 3;
    const tag = classifyTri(cx, cy, cz);

    let bucket = groups.get(tag);
    if (!bucket) {
      bucket = {pos: [], norm: [], uv: []};
      groups.set(tag, bucket);
    }

    for (const vi of [i0, i1, i2]) {
      bucket.pos.push(posAttr.getX(vi), posAttr.getY(vi), posAttr.getZ(vi));
      bucket.norm.push(normAttr.getX(vi), normAttr.getY(vi), normAttr.getZ(vi));
      bucket.uv.push(uvAttr.getX(vi), uvAttr.getY(vi));
    }
  }

  if (groups.size <= 1) {
    const onlyTag = groups.keys().next().value ?? 'default';
    return [{tag: onlyTag, geometry: geo}];
  }

  const out: Array<{tag: string; geometry: THREE.BufferGeometry}> = [];
  groups.forEach((b, tag) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b.pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(b.norm), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(b.uv), 2));
    g.computeBoundingBox();
    out.push({tag, geometry: g});
  });
  return out;
}

function createProceduralJetEnginePod(
  pos: THREE.Vector3,
  radius: number,
  length: number,
  cowlingMat: THREE.Material,
  chromeMat: THREE.Material,
  darkMat: THREE.Material,
  fanMat: THREE.Material,
  bladeMat: THREE.Material,
  disposableGeos: THREE.BufferGeometry[],
): {podGroup: THREE.Group; fanPivot: THREE.Group} {
  const podGroup = new THREE.Group();
  podGroup.position.copy(pos);

  // Outer sleek JT3D / turbojet nacelle profile rotated around Z (-Z intake, +Z exhaust)
  const pts = [
    new THREE.Vector2(radius * 0.8, -length * 0.5),
    new THREE.Vector2(radius * 0.96, -length * 0.43),
    new THREE.Vector2(radius, -length * 0.15),
    new THREE.Vector2(radius * 0.94, length * 0.18),
    new THREE.Vector2(radius * 0.72, length * 0.48),
  ];
  const cowlGeo = new THREE.LatheGeometry(pts, 20);
  cowlGeo.rotateX(Math.PI / 2);
  disposableGeos.push(cowlGeo);
  const cowl = new THREE.Mesh(cowlGeo, cowlingMat);
  cowl.castShadow = true;
  cowl.receiveShadow = true;
  podGroup.add(cowl);

  // Polished Chrome Intake Lip Ring
  const lipGeo = new THREE.TorusGeometry(radius * 0.84, radius * 0.11, 10, 22);
  disposableGeos.push(lipGeo);
  const lip = new THREE.Mesh(lipGeo, chromeMat);
  lip.position.z = -length * 0.47;
  podGroup.add(lip);

  // Dark Intake Bypass Throat + Tailpipe Exhaust Cone
  const throatGeo = new THREE.CylinderGeometry(radius * 0.76, radius * 0.68, length * 0.36, 16);
  throatGeo.rotateX(Math.PI / 2);
  disposableGeos.push(throatGeo);
  const throat = new THREE.Mesh(throatGeo, darkMat);
  throat.position.z = -length * 0.28;
  podGroup.add(throat);

  const tailConeGeo = new THREE.ConeGeometry(radius * 0.56, length * 0.34, 16);
  tailConeGeo.rotateX(Math.PI / 2);
  disposableGeos.push(tailConeGeo);
  const tailCone = new THREE.Mesh(tailConeGeo, darkMat);
  tailCone.position.z = length * 0.48;
  podGroup.add(tailCone);

  // Signature JT3D dorsal turbocompressor scoop hump on top of cowling
  const scoopGeo = new THREE.BoxGeometry(radius * 0.42, radius * 0.32, length * 0.56);
  disposableGeos.push(scoopGeo);
  const scoop = new THREE.Mesh(scoopGeo, cowlingMat);
  scoop.position.set(0, radius * 0.92, -length * 0.05);
  podGroup.add(scoop);

  // Spinning 16-Blade Compressor Fan + White/Steel Nose Cone
  const fanPivot = new THREE.Group();
  fanPivot.position.set(0, 0, -length * 0.36);
  const hubGeo = new THREE.ConeGeometry(radius * 0.22, radius * 0.34, 12);
  hubGeo.rotateX(-Math.PI / 2);
  const bladeGeo = new THREE.BoxGeometry(radius * 0.09, radius * 0.52, 0.03);
  disposableGeos.push(hubGeo, bladeGeo);

  const hub = new THREE.Mesh(hubGeo, fanMat);
  hub.position.z = -radius * 0.1;
  fanPivot.add(hub);

  for (let b = 0; b < 14; b++) {
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    const ang = (b / 14) * Math.PI * 2;
    blade.position.set(Math.sin(ang) * radius * 0.42, Math.cos(ang) * radius * 0.42, 0);
    blade.rotation.z = -ang;
    blade.rotation.y = 0.32;
    fanPivot.add(blade);
  }
  podGroup.add(fanPivot);

  return {podGroup, fanPivot};
}

function createProceduralMainGearBogie(
  xPos: number,
  axleCenterY: number,
  axleCenterZ: number,
  strutTopY: number,
  wheelRadius: number,
  wheelWidth: number,
  axleTrackOffset: number,
  tandemSpacingZ: number,
  tireMat: THREE.Material,
  rimMat: THREE.Material,
  strutMat: THREE.Material,
  disposableGeos: THREE.BufferGeometry[],
): {gearAttachGroup: THREE.Group; tires: THREE.Object3D[]} {
  const gearAttachGroup = new THREE.Group();
  const tires: THREE.Object3D[] = [];

  // Main oleo lower piston connecting upper leg down to bogie beam
  const strutLen = Math.max(0.25, strutTopY - axleCenterY);
  const strutGeo = new THREE.CylinderGeometry(wheelRadius * 0.22, wheelRadius * 0.24, strutLen, 10);
  const beamGeo = new THREE.BoxGeometry(wheelRadius * 0.34, wheelRadius * 0.26, tandemSpacingZ + wheelRadius * 0.4);
  const diagGeo = new THREE.CylinderGeometry(wheelRadius * 0.1, wheelRadius * 0.1, strutLen * 0.9, 8);
  const tireGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 18);
  tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(wheelRadius * 0.56, wheelRadius * 0.56, wheelWidth * 1.03, 14);
  rimGeo.rotateZ(Math.PI / 2);
  disposableGeos.push(strutGeo, beamGeo, diagGeo, tireGeo, rimGeo);

  const strut = new THREE.Mesh(strutGeo, strutMat);
  strut.position.set(xPos, axleCenterY + strutLen * 0.5, axleCenterZ);
  strut.castShadow = true;
  gearAttachGroup.add(strut);

  const dragBrace = new THREE.Mesh(diagGeo, strutMat);
  dragBrace.position.set(xPos, axleCenterY + strutLen * 0.55, axleCenterZ - strutLen * 0.28);
  dragBrace.rotation.x = 0.46;
  gearAttachGroup.add(dragBrace);

  const bogieBeam = new THREE.Mesh(beamGeo, strutMat);
  bogieBeam.position.set(xPos, axleCenterY, axleCenterZ);
  bogieBeam.castShadow = true;
  gearAttachGroup.add(bogieBeam);

  // 4-wheel dual-tandem bogie centered individually on each tire axle for clean spin!
  const dzArr = [-tandemSpacingZ * 0.5, tandemSpacingZ * 0.5];
  const dxArr = [-axleTrackOffset, axleTrackOffset];
  for (const dz of dzArr) {
    for (const dx of dxArr) {
      const wheelGroup = new THREE.Group();
      wheelGroup.position.set(xPos + dx, axleCenterY, axleCenterZ + dz);
      const tire = new THREE.Mesh(tireGeo, tireMat);
      tire.castShadow = true;
      const rim = new THREE.Mesh(rimGeo, rimMat);
      wheelGroup.add(tire, rim);
      gearAttachGroup.add(wheelGroup);
      tires.push(wheelGroup);
    }
  }

  return {gearAttachGroup, tires};
}

function attachDc10UnderwingNacelle(
  podGroup: THREE.Group,
  isPort: boolean,
  lenScale: number,
  liveryMat: THREE.Material,
  chromeMat: THREE.Material,
  linerMat: THREE.Material,
  exhaustDarkMat: THREE.Material,
  pylonMat: THREE.Material,
  disposableGeos: THREE.BufferGeometry[],
) {
  let housingBox: THREE.Box3 | null = null;
  for (const child of podGroup.children) {
    if (child instanceof THREE.Mesh && /housing/i.test(child.name)) {
      child.geometry.computeBoundingBox();
      if (child.geometry.boundingBox) {
        housingBox = child.geometry.boundingBox.clone();
        break;
      }
    }
  }
  if (!housingBox) {
    const fallbackBox = new THREE.Box3().setFromObject(podGroup);
    if (fallbackBox.isEmpty()) return;
    housingBox = fallbackBox;
  }

  const centerX = (housingBox.min.x + housingBox.max.x) * 0.5;
  const centerY = (housingBox.min.y + housingBox.max.y) * 0.5;
  const datumZ = housingBox.min.z;

  const zFront = -0.78 * lenScale;
  const zAft = 2.88 * lenScale;

  // 1. Livery-mapped outer GE CF6-50 fan cowling & thrust reverser sleeve
  const cowlPts = [
    new THREE.Vector2(1.22, zFront),
    new THREE.Vector2(1.31, -0.58 * lenScale),
    new THREE.Vector2(1.36, 0.25 * lenScale),
    new THREE.Vector2(1.34, 1.55 * lenScale),
    new THREE.Vector2(1.23, 2.35 * lenScale),
    new THREE.Vector2(1.06, zAft),
  ];
  const cowlGeo = new THREE.LatheGeometry(cowlPts, 32);
  cowlGeo.rotateX(Math.PI / 2);
  cowlGeo.computeVertexNormals();

  const posAttr = cowlGeo.attributes.position as THREE.BufferAttribute;
  const uvAttr = cowlGeo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vy = posAttr.getY(i);
    const vz = posAttr.getZ(i);
    const tZ = THREE.MathUtils.clamp((vz - zFront) / Math.max(0.1, zAft - zFront), 0, 1);
    const r = Math.max(0.01, Math.hypot(vx, vy));
    const yNorm = THREE.MathUtils.clamp((vy / r + 1) * 0.5, 0, 1);

    const u = isPort ? 0.514 + tZ * (0.744 - 0.514) : 0.496 - tZ * (0.496 - 0.266);
    const v = isPort ? 0.852 + yNorm * (0.992 - 0.852) : 0.568 + yNorm * (0.708 - 0.568);
    uvAttr.setXY(i, u, v);
  }
  uvAttr.needsUpdate = true;
  disposableGeos.push(cowlGeo);

  const cowlMesh = new THREE.Mesh(cowlGeo, liveryMat);
  cowlMesh.name = isPort ? 'Engine1_Cowling' : 'Engine3_Cowling';
  cowlMesh.position.set(centerX, centerY, datumZ);
  cowlMesh.castShadow = true;
  cowlMesh.receiveShadow = true;
  podGroup.add(cowlMesh);

  // 2. Polished aluminum / chrome CF6-50 intake lip ring
  const lipPts = [
    new THREE.Vector2(1.24, -0.71 * lenScale),
    new THREE.Vector2(1.23, -0.80 * lenScale),
    new THREE.Vector2(1.19, -0.83 * lenScale),
    new THREE.Vector2(1.15, -0.78 * lenScale),
    new THREE.Vector2(1.14, -0.58 * lenScale),
  ];
  const lipGeo = new THREE.LatheGeometry(lipPts, 32);
  lipGeo.rotateX(Math.PI / 2);
  lipGeo.computeVertexNormals();
  disposableGeos.push(lipGeo);

  const lipMesh = new THREE.Mesh(lipGeo, chromeMat);
  lipMesh.name = isPort ? 'Engine1_IntakeLip' : 'Engine3_IntakeLip';
  lipMesh.position.set(centerX, centerY, datumZ);
  lipMesh.castShadow = true;
  podGroup.add(lipMesh);

  // 3. Dark acoustic intake barrel liner around spinning CF6-50 blades
  const linerLen = 0.72 * lenScale;
  const linerGeo = new THREE.CylinderGeometry(1.15, 1.14, linerLen, 28, 1, true);
  linerGeo.rotateX(Math.PI / 2);
  disposableGeos.push(linerGeo);

  const linerMesh = new THREE.Mesh(linerGeo, linerMat);
  linerMesh.name = isPort ? 'Engine1_IntakeLiner' : 'Engine3_IntakeLiner';
  linerMesh.position.set(centerX, centerY, datumZ - 0.36 * lenScale);
  podGroup.add(linerMesh);

  // 4. Aft fan bypass duct inner wall & tapered core cowl shroud around turbine shaft
  const ductLen = 1.72 * lenScale;
  const ductGeo = new THREE.CylinderGeometry(0.99, 1.12, ductLen, 28, 1, true);
  ductGeo.rotateX(Math.PI / 2);
  disposableGeos.push(ductGeo);

  const ductMesh = new THREE.Mesh(ductGeo, exhaustDarkMat);
  ductMesh.name = isPort ? 'Engine1_BypassDuct' : 'Engine3_BypassDuct';
  ductMesh.position.set(centerX, centerY, datumZ + 2.02 * lenScale);
  podGroup.add(ductMesh);

  const coreCowlLen = 1.35 * lenScale;
  const coreCowlGeo = new THREE.CylinderGeometry(0.66, 0.9, coreCowlLen, 24, 1, true);
  coreCowlGeo.rotateX(Math.PI / 2);
  disposableGeos.push(coreCowlGeo);

  const coreCowlMesh = new THREE.Mesh(coreCowlGeo, exhaustDarkMat);
  coreCowlMesh.name = isPort ? 'Engine1_CoreCowl' : 'Engine3_CoreCowl';
  coreCowlMesh.position.set(centerX, centerY, datumZ + 2.82 * lenScale);
  coreCowlMesh.castShadow = true;
  podGroup.add(coreCowlMesh);

  // 5. Swept underwing aerodynamic engine pylon mating cowl crown cleanly into DC-10 wing
  const pylonShape = new THREE.Shape();
  pylonShape.moveTo(-0.14 * lenScale, 1.12);
  pylonShape.lineTo(3.26 * lenScale, 1.96);
  pylonShape.lineTo(6.38 * lenScale, 1.48);
  pylonShape.lineTo(3.86 * lenScale, 0.68);
  pylonShape.lineTo(1.25 * lenScale, 1.12);
  pylonShape.closePath();

  const pylonDepth = 0.34;
  const pylonGeo = new THREE.ExtrudeGeometry(pylonShape, {
    depth: pylonDepth,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.04,
    bevelSegments: 2,
  });
  pylonGeo.translate(0, 0, -pylonDepth * 0.5);
  pylonGeo.rotateY(-Math.PI / 2);
  pylonGeo.computeVertexNormals();
  disposableGeos.push(pylonGeo);

  const pylonMesh = new THREE.Mesh(pylonGeo, pylonMat);
  pylonMesh.name = isPort ? 'Engine1_Pylon' : 'Engine3_Pylon';
  pylonMesh.position.set(centerX, centerY, datumZ);
  pylonMesh.castShadow = true;
  pylonMesh.receiveShadow = true;
  podGroup.add(pylonMesh);
}

export async function loadPreMadeAircraft(
  spec: AircraftSpec,
  initialLiveryId: string,
  renderer: THREE.WebGLRenderer,
  variant?: AircraftVariant,
): Promise<LoadedAircraftRig> {
  if (spec.id === 'dc9' || spec.id === 'md80') {
    return buildDc9FamilyRig(spec, initialLiveryId, renderer, variant);
  }

  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const root = new THREE.Group();
  const airframeGroup = new THREE.Group();
  root.add(airframeGroup);

  const fuselageGroup = new THREE.Group();
  const aftFuselageGroup = new THREE.Group();
  const leftWingGroup = new THREE.Group();
  const rightWingGroup = new THREE.Group();
  const tailGroup = new THREE.Group();
  const leftHStabGroup = new THREE.Group();
  const rightHStabGroup = new THREE.Group();
  const enginesGroup = new THREE.Group();
  const noseGroup = new THREE.Group();
  const noseGearGroup = new THREE.Group();
  const leftGearGroup = new THREE.Group();
  const rightGearGroup = new THREE.Group();

  airframeGroup.add(
    fuselageGroup,
    aftFuselageGroup,
    leftWingGroup,
    rightWingGroup,
    tailGroup,
    leftHStabGroup,
    rightHStabGroup,
    enginesGroup,
    noseGroup,
    noseGearGroup,
    leftGearGroup,
    rightGearGroup,
  );

  const gearMeshes: THREE.Object3D[] = [];
  const openGearDoorMeshes: THREE.Object3D[] = [];
  const closedGearDoorMeshes: THREE.Object3D[] = [];
  const wheelMeshes: THREE.Object3D[] = [];
  const fanMeshes: THREE.Object3D[] = [];
  const propGroups: THREE.Object3D[] = [];
  const visorMeshes: THREE.Object3D[] = [];
  const controlSurfaces: ControlSurfaceEntry[] = [];
  const cockpitHiddenMeshes: THREE.Object3D[] = [];
  const liveryMaterials: THREE.MeshStandardMaterial[] = [];
  const disposableGeos: THREE.BufferGeometry[] = [];
  const disposableMats: THREE.Material[] = [];
  const loadedTextures: THREE.Texture[] = [];
  const enginePods: EnginePodEntry[] = [];

  const targetLivNames = new Set(spec.liveryTargetTextures.map((t) => getBaseName(t).toLowerCase()));
  const chosenLivery = spec.liveries.find((l) => l.id === initialLiveryId) ?? spec.liveries[0];

  interface PendingMesh {
    mesh: THREE.Mesh;
    name: string;
    forceZone?: string;
    isInterior: boolean;
    isGlass: boolean;
  }
  const pendingMeshes: PendingMesh[] = [];
  const texPromiseMap = new Map<string, Promise<THREE.Texture | null>>();
  const materialCache = new Map<string, THREE.MeshStandardMaterial>();

  const rotMatrix = new THREE.Matrix4().makeRotationY(spec.modelRotY);
  const scaleVec = new THREE.Vector3(spec.modelScale, spec.modelScale, spec.modelScale);

  const getTexPromise = (url: string) => {
    let p = texPromiseMap.get(url);
    if (!p) {
      p = loadTextureAsync(url, maxAniso).then((t) => {
        if (t) loadedTextures.push(t);
        return t;
      });
      texPromiseMap.set(url, p);
    }
    return p;
  };

  const initialLiveryTexPromise = getTexPromise(chosenLivery.textureUrl);

  for (const part of spec.parts) {
    let acText = acTextCache.get(part.url);
    if (!acText) {
      const resp = await fetch(part.url);
      if (!resp.ok) {
        throw new Error(`Failed to fetch model ${part.url}: ${resp.status}`);
      }
      acText = await resp.text();
      acTextCache.set(part.url, acText);
    }

    const baseDir = part.url.slice(0, part.url.lastIndexOf('/'));
    const parsed = parseAc3dText(acText);

    const partMat = new THREE.Matrix4();
    if (part.rotation) {
      const q = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(part.rotation[0], part.rotation[1], part.rotation[2], 'XYZ'),
      );
      partMat.makeRotationFromQuaternion(q);
    }
    if (part.offset) {
      partMat.setPosition(part.offset[0], part.offset[1], part.offset[2]);
    }

    const propPivot = part.isPropAttachment ? new THREE.Group() : null;
    if (propPivot) {
      const worldPartPos = new THREE.Vector3(
        part.offset?.[0] ?? 0,
        part.offset?.[1] ?? 0,
        part.offset?.[2] ?? 0,
      )
        .multiplyScalar(spec.modelScale)
        .applyMatrix4(rotMatrix);
      propPivot.position.copy(worldPartPos);
      propGroups.push(propPivot);
      enginesGroup.add(propPivot);
    }

    const traverseNode = (node: AcNode, parentMatrix: THREE.Matrix4) => {
      if (SKIP_NAME_RE.test(node.name)) return;
      if (spec.id === 'l1011' && /^convexhull$/i.test(node.name)) return;
      if (shouldFilterMeshForVariant(spec, variant, node.name)) return;

      const localMat = new THREE.Matrix4();
      const r = node.rot;
      localMat.set(
        r[0], r[1], r[2], node.loc[0],
        r[3], r[4], r[5], node.loc[1],
        r[6], r[7], r[8], node.loc[2],
        0, 0, 0, 1,
      );
      const accMat = new THREE.Matrix4().multiplyMatrices(parentMatrix, localMat);

      if (node.verts.length > 0 && node.surfs.length > 0) {
        const finalMat = propPivot
          ? new THREE.Matrix4().multiplyMatrices(
              new THREE.Matrix4().makeRotationY(spec.modelRotY + (part.rotation?.[1] ?? 0)),
              accMat,
            )
          : new THREE.Matrix4().multiplyMatrices(rotMatrix, accMat);
        finalMat.scale(scaleVec);

        const buckets = new Map<
          string,
          {matIdx: number; doubleSide: boolean; positions: number[]; normals: number[]; uvs: number[]}
        >();

        const tmpA = new THREE.Vector3();
        const tmpB = new THREE.Vector3();
        const tmpC = new THREE.Vector3();
        const cb = new THREE.Vector3();
        const ab = new THREE.Vector3();

        const transformedVerts = node.verts.map(([vx, vy, vz]) =>
          new THREE.Vector3(vx, vy, vz).applyMatrix4(finalMat),
        );

        for (let s = 0; s < node.surfs.length; s++) {
          const surf = node.surfs[s];
          if ((surf.flags & 0x0f) !== 0 || surf.refs.length < 3) continue;
          const doubleSide = (surf.flags & 0x20) !== 0;
          const key = `${surf.matIdx}_${doubleSide ? 1 : 0}`;
          let bucket = buckets.get(key);
          if (!bucket) {
            bucket = {matIdx: surf.matIdx, doubleSide, positions: [], normals: [], uvs: []};
            buckets.set(key, bucket);
          }

          const r0 = surf.refs[0];
          const v0 = transformedVerts[r0.idx];
          if (!v0) continue;

          for (let t = 1; t + 1 < surf.refs.length; t++) {
            const r1 = surf.refs[t];
            const r2 = surf.refs[t + 1];
            const v1 = transformedVerts[r1.idx];
            const v2 = transformedVerts[r2.idx];
            if (!v1 || !v2) continue;

            tmpA.copy(v0);
            tmpB.copy(v1);
            tmpC.copy(v2);
            cb.subVectors(tmpC, tmpB);
            ab.subVectors(tmpA, tmpB);
            cb.cross(ab);
            if (cb.lengthSq() > 1e-10) cb.normalize();
            else cb.set(0, 1, 0);

            bucket.positions.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
            bucket.normals.push(cb.x, cb.y, cb.z, cb.x, cb.y, cb.z, cb.x, cb.y, cb.z);

            const [rx, ry] = node.texrep;
            const [ox, oy] = node.texoff;
            bucket.uvs.push(
              r0.u * rx + ox, r0.v * ry + oy,
              r1.u * rx + ox, r1.v * ry + oy,
              r2.u * rx + ox, r2.v * ry + oy,
            );
          }
        }

        buckets.forEach((bucket) => {
          if (bucket.positions.length === 0) return;

          const geo = new THREE.BufferGeometry();
          const posArr = new Float32Array(bucket.positions);
          const normArr = new Float32Array(bucket.normals);
          const uvArr = new Float32Array(bucket.uvs);

          geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
          geo.setAttribute('normal', new THREE.BufferAttribute(normArr, 3));
          geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
          geo.computeBoundingBox();

          const texBase = node.texture ? getBaseName(node.texture) : '';
          const isLiveryTex = texBase !== '' && targetLivNames.has(texBase.toLowerCase());
          const mDef = parsed.materials[bucket.matIdx] ?? {
            name: 'default',
            rgb: [0.85, 0.85, 0.85],
            emis: [0, 0, 0],
            spec: [0.35, 0.35, 0.35],
            shi: 40,
            trans: 0,
          };

          const isGlass = isGlassLike(node.name, texBase, mDef.name, mDef.trans);
          const isShell = /fuselage|nose|cockpit|hull/i.test(node.name) && !isGlass;
          const useDoubleSide = spec.id === 'l1011' || isGlass || (bucket.doubleSide && !isShell);

          const matKey = `${part.url}|${bucket.matIdx}|${texBase.toLowerCase()}|${useDoubleSide ? 1 : 0}|${isGlass ? 1 : 0}`;
          let mat = materialCache.get(matKey);
          if (!mat) {
            const isChrome = /chrome|metal|aluminum/i.test(texBase + ' ' + mDef.name);
            const baseCol = isLiveryTex
              ? new THREE.Color(1, 1, 1)
              : new THREE.Color(mDef.rgb[0], mDef.rgb[1], mDef.rgb[2]);

            const finalTransparent = isGlass || mDef.trans > 0.03 || /transparent|canopy|prop/i.test(texBase);
            const finalOpacity = isGlass ? Math.min(0.24, Math.max(0.14, 1 - mDef.trans)) : Math.max(0.15, 1 - mDef.trans);

            mat = new THREE.MeshStandardMaterial({
              color: texBase && !isGlass ? new THREE.Color(1, 1, 1).lerp(baseCol, isLiveryTex ? 0 : 0.25) : isGlass ? new THREE.Color(0x9bd2ff) : baseCol,
              emissive: new THREE.Color(mDef.emis[0], mDef.emis[1], mDef.emis[2]),
              roughness: isGlass ? 0.06 : isChrome ? 0.22 : Math.max(0.24, 0.82 - mDef.shi / 200),
              metalness: isGlass ? 0.15 : isChrome ? 0.88 : texBase ? 0.28 : 0.32,
              transparent: finalTransparent,
              opacity: finalOpacity,
              depthWrite: !isGlass,
              side: useDoubleSide ? THREE.DoubleSide : THREE.FrontSide,
              envMapIntensity: isGlass ? 1.5 : 1.05,
            });
            materialCache.set(matKey, mat);
            disposableMats.push(mat);

            if (isLiveryTex) {
              liveryMaterials.push(mat);
              void initialLiveryTexPromise.then((tex) => {
                if (tex && mat) {
                  mat.map = tex;
                  mat.needsUpdate = true;
                }
              });
            } else if (texBase && !isGlass) {
              const texUrl = `${baseDir}/${encodeURIComponent(texBase)}`;
              void getTexPromise(texUrl).then((tex) => {
                if (tex && mat) {
                  mat.map = tex;
                  mat.needsUpdate = true;
                }
              });
            }
          }

          // Special Pre-Grounding Fix for Citation II stowed landing gear!
          if (spec.id === 'citation' && /^gear\.(nose|left|right)\.(strut|wheel|damper|torquelink|fitting)/i.test(node.name)) {
            const nl = node.name.toLowerCase();
            if (nl.startsWith('gear.nose.')) {
              rotateGeometryAboutPivot(geo, new THREE.Vector3(0, 0.0, 1.65), new THREE.Euler(THREE.MathUtils.degToRad(-95), 0, 0));
            } else if (nl.startsWith('gear.left.')) {
              rotateGeometryAboutPivot(geo, new THREE.Vector3(-2.36, 0.05, 7.2), new THREE.Euler(0, 0, THREE.MathUtils.degToRad(-88)));
            } else if (nl.startsWith('gear.right.')) {
              rotateGeometryAboutPivot(geo, new THREE.Vector3(2.36, 0.05, 7.2), new THREE.Euler(0, 0, THREE.MathUtils.degToRad(88)));
            }
          }

          const nl = node.name.toLowerCase();
          const isInterior = /cockpit|seat|panel|console|floor|cabin|interior|instrument|pedestal|yoke|doorhandle|interiort|cockpitdoor|cockpitfloor/.test(
            nl,
          );

          if (propPivot) {
            disposableGeos.push(geo);
            const mesh = new THREE.Mesh(geo, mat);
            mesh.name = node.name;
            mesh.castShadow = false;
            mesh.receiveShadow = true;
            propPivot.add(mesh);
          } else {
            disposableGeos.push(geo);
            const mesh = new THREE.Mesh(geo, mat);
            mesh.name = node.name;
            mesh.castShadow = !isSoftwareGlassOrProp(node.name, mDef.trans);
            mesh.receiveShadow = true;
            pendingMeshes.push({
              mesh,
              name: node.name,
              forceZone: part.forceZone,
              isInterior,
              isGlass,
            });
          }
        });
      }

      for (const kid of node.kids) {
        traverseNode(kid, accMat);
      }
    };

    const startMat = propPivot ? new THREE.Matrix4() : partMat;
    for (const rNode of parsed.roots) {
      traverseNode(rNode, startMat);
    }
  }

  await initialLiveryTexPromise;

  // Apply exact cylindrical fuselage-plug scaling, outer span trimming, and gear leveling per variant
  applyPreGroundVariantGeometry(spec, variant, pendingMeshes, propGroups);

  // Fallback for any custom variant carrying fuselageLengthScale !== 1.0
  const lenScale = variant?.fuselageLengthScale ?? 1.0;
  if (Math.abs(lenScale - 1.0) > 0.001) {
    const tmpWheelCenter = new THREE.Vector3();
    for (const pm of pendingMeshes) {
      const nl = pm.name.toLowerCase();
      const isWheelObj =
        /(?:wheel|tire|tyre|whell|pneu|roue|lmgt|rmgt)/i.test(nl) &&
        !/trimwheel|well|bay|door|cover|box|arm|strut|gearbox/i.test(nl);
      if (isWheelObj) {
        pm.mesh.geometry.computeBoundingBox();
        if (pm.mesh.geometry.boundingBox) {
          pm.mesh.geometry.boundingBox.getCenter(tmpWheelCenter);
          pm.mesh.geometry.translate(0, 0, (lenScale - 1.0) * tmpWheelCenter.z);
        }
      } else {
        pm.mesh.geometry.scale(1, 1, lenScale);
      }
      pm.mesh.geometry.computeBoundingBox();
    }
    for (const pg of propGroups) {
      pg.position.z *= lenScale;
    }
  }

  // Compute overall bounds to ground tires cleanly at Y=0 and center Z/X
  const overallBox = new THREE.Box3();
  for (const pm of pendingMeshes) {
    pm.mesh.geometry.computeBoundingBox();
    if (pm.mesh.geometry.boundingBox) {
      overallBox.union(pm.mesh.geometry.boundingBox);
    }
  }

  const center = new THREE.Vector3();
  if (!overallBox.isEmpty()) {
    overallBox.getCenter(center);
  }
  const minY = overallBox.isEmpty() ? 0 : overallBox.min.y;
  const shiftX = -center.x;
  const shiftY = -minY;
  const shiftZ = -center.z;

  for (const pg of propGroups) {
    pg.position.x += shiftX;
    pg.position.y += shiftY;
    pg.position.z += shiftZ;
  }

  // Ground all vertices into normalized airframe coordinates, then split large combined meshes into breakable rigid pieces!
  const splitPending: Array<{
    mesh: THREE.Mesh;
    name: string;
    forceZone?: string;
    isInterior: boolean;
    isGlass: boolean;
    forcedTag?: string;
  }> = [];

  for (const pm of pendingMeshes) {
    pm.mesh.geometry.translate(shiftX, shiftY, shiftZ);
    pm.mesh.geometry.computeBoundingBox();
    const bb = pm.mesh.geometry.boundingBox!;
    const sizeX = bb.max.x - bb.min.x;
    const sizeZ = bb.max.z - bb.min.z;
    const mc = new THREE.Vector3();
    bb.getCenter(mc);
    const nl = pm.name.toLowerCase();

    if (spec.id === 'l1011') {
      if (nl === 'loutbslat_l1011_1_1') {
        const pieces = splitGeometryByKey(pm.mesh.geometry, (_cx, cy, cz) => {
          if (cz < -17.0) return 'nose';
          if (cz < -7.5) return 'fuse_fwd';
          if (cz > 12.0 && cy > 7.4) return 'tail';
          if (cz > 14.0) return 'aftFuselage';
          if (cz > 7.5) return 'fuse_aftmid';
          return 'fuselage';
        });
        for (const p of pieces) {
          if (p.geometry !== pm.mesh.geometry) disposableGeos.push(p.geometry);
          const m = new THREE.Mesh(p.geometry, pm.mesh.material);
          m.name = `${pm.name}_${p.tag}`;
          m.castShadow = pm.mesh.castShadow;
          m.receiveShadow = pm.mesh.receiveShadow;
          splitPending.push({...pm, mesh: m, forcedTag: p.tag});
        }
        continue;
      }
      if (nl === 'linbslat_l1011' || nl === 'lengine_l1011') {
        const isPort = nl === 'linbslat_l1011';
        const halfSpan = Math.max(4, spec.flight.wingspanM * 0.5);
        const lWingRootX = 2.2;
        const pieces = splitGeometryByKey(pm.mesh.geometry, (cx) => {
          const ax = Math.abs(cx);
          if (ax <= lWingRootX) return 'fuselage';
          const frac = (ax - lWingRootX) / Math.max(1, halfSpan - lWingRootX);
          const seg = frac < 0.34 ? 0 : frac < 0.68 ? 1 : 2;
          return isPort ? `leftWing_s${seg}` : `rightWing_s${seg}`;
        });
        for (const p of pieces) {
          if (p.geometry !== pm.mesh.geometry) disposableGeos.push(p.geometry);
          const m = new THREE.Mesh(p.geometry, pm.mesh.material);
          m.name = `${pm.name}_${p.tag}`;
          m.castShadow = pm.mesh.castShadow;
          m.receiveShadow = pm.mesh.receiveShadow;
          splitPending.push({...pm, mesh: m, forcedTag: p.tag});
        }
        continue;
      }
      if (nl === 'flandgrbdo_l1011' || nl === 'rgeararm_l1011' || nl === 'loutbailer_l1011') {
        const isNose = nl === 'flandgrbdo_l1011';
        const yCut = isNose ? 0.88 : 1.15;
        const wheelTag = isNose
          ? 'l1011_nose_wheel'
          : nl === 'rgeararm_l1011'
            ? 'l1011_lgear_wheel'
            : 'l1011_rgear_wheel';
        const strutTag = isNose
          ? 'l1011_nose_strut'
          : nl === 'rgeararm_l1011'
            ? 'l1011_lgear_strut'
            : 'l1011_rgear_strut';
        const pieces = splitGeometryByKey(pm.mesh.geometry, (_cx, cy) => (cy < yCut ? wheelTag : strutTag));
        for (const p of pieces) {
          if (p.geometry !== pm.mesh.geometry) disposableGeos.push(p.geometry);
          const m = new THREE.Mesh(p.geometry, pm.mesh.material);
          m.name = p.tag;
          m.castShadow = pm.mesh.castShadow;
          m.receiveShadow = pm.mesh.receiveShadow;
          splitPending.push({...pm, name: p.tag, mesh: m});
        }
        continue;
      }
      splitPending.push(pm);
      continue;
    }

    const isWheelCandidate =
      /(?:wheel|tire|tyre|whell|pneu|roue|lmgt|rmgt)/i.test(nl) &&
      !/trimwheel|well|bay|door|cover|box|arm|strut|gearbox/i.test(nl);
    const isGearCandidate =
      pm.forceZone === 'gear' ||
      (/gear|wheel|tire|tyre|whell|strut|oleo|scissor|bogie|axle|nlg|mlg|wlg|blg|nosegear|maingear|pneu|roue|train|gearcover|gearbox|mgdoor|fgear|lgear|rgear|flandg|mlandg/.test(
        nl,
      ) &&
        !/bay|well|trimwheel/i.test(nl));

    // Don't split small parts, glass, gears, or interior
    const canSplit = !isGearCandidate && !isWheelCandidate && !pm.isInterior && !pm.isGlass;

    const wingRootX = Math.max(1.2, spec.flight.wingspanM * 0.13);
    const isCtrlMeshCandidate =
      /flap|slat|ailer|elev(?!wing)|profondeur|helev|rudder|spoil|speedbrake|volet|\bbec\b/i.test(nl) &&
      !/track|tk\d|rod|hinge|sousvolet|trim|housing|fairing|bay|box|well|light|door|gear|flapwing|flap_.*_h\b/i.test(
        nl,
      );
    const isCenteredWideCtrl =
      canSplit && isCtrlMeshCandidate && bb.min.x < -0.45 && bb.max.x > 0.45;
    const isWideWing =
      canSplit && !isCtrlMeshCandidate && sizeX > spec.flight.wingspanM * 0.42 && !/fuselage/i.test(nl);
    const isWideStab =
      canSplit &&
      !isCtrlMeshCandidate &&
      (/hstab|horzstab|elev|tailplane|profondeur/.test(nl) || (spec.id === 'caravelle' && nl === 'derive2')) &&
      sizeX > 3.0;
    const isLongFuse = canSplit && /fuselage/i.test(nl) && sizeZ > spec.flight.lengthM * 0.55;
    const isMultiEngine =
      canSplit &&
      (pm.forceZone === 'engines' || /eng|nacelle|turbofan|moteur|reverser/.test(nl)) &&
      bb.min.x < -1.0 &&
      bb.max.x > 1.0;

    if (isCenteredWideCtrl) {
      // Split centered control surface (e.g. C172 flaps, B727 slat2, ATR42 Elevator) cleanly down X=0 only
      const isHStabCtrl = /elev|profondeur|helev/i.test(nl);
      const pieces = splitGeometryByKey(pm.mesh.geometry, (cx) => (cx < 0 ? 'L' : 'R'));
      for (const p of pieces) {
        if (p.geometry !== pm.mesh.geometry) disposableGeos.push(p.geometry);
        const m = new THREE.Mesh(p.geometry, pm.mesh.material);
        m.name = `${pm.name}_${p.tag}`;
        m.castShadow = pm.mesh.castShadow;
        m.receiveShadow = pm.mesh.receiveShadow;
        const forcedTag = isHStabCtrl ? (p.tag === 'L' ? 'leftHStab' : 'rightHStab') : undefined;
        splitPending.push({...pm, mesh: m, forcedTag});
      }
    } else if (isWideWing) {
      const halfSpan = Math.max(4, spec.flight.wingspanM * 0.5);
      const pieces = splitGeometryByKey(pm.mesh.geometry, (cx) => {
        const ax = Math.abs(cx);
        if (ax <= wingRootX) return 'fuselage';
        const frac = (ax - wingRootX) / Math.max(1, halfSpan - wingRootX);
        const seg = frac < 0.34 ? 0 : frac < 0.68 ? 1 : 2;
        return cx < 0 ? `leftWing_s${seg}` : `rightWing_s${seg}`;
      });
      for (const p of pieces) {
        if (p.geometry !== pm.mesh.geometry) disposableGeos.push(p.geometry);
        const m = new THREE.Mesh(p.geometry, pm.mesh.material);
        m.name = `${pm.name}_${p.tag}`;
        m.castShadow = pm.mesh.castShadow;
        m.receiveShadow = pm.mesh.receiveShadow;
        splitPending.push({...pm, mesh: m, forcedTag: p.tag});
      }
    } else if (isWideStab) {
      const pieces = splitGeometryByKey(pm.mesh.geometry, (cx) => {
        if (cx < -0.45) return 'leftHStab';
        if (cx > 0.45) return 'rightHStab';
        return 'tail';
      });
      for (const p of pieces) {
        if (p.geometry !== pm.mesh.geometry) disposableGeos.push(p.geometry);
        const m = new THREE.Mesh(p.geometry, pm.mesh.material);
        m.name = `${pm.name}_${p.tag}`;
        m.castShadow = pm.mesh.castShadow;
        m.receiveShadow = pm.mesh.receiveShadow;
        splitPending.push({...pm, mesh: m, forcedTag: p.tag});
      }
    } else if (isLongFuse) {
      const halfL = spec.flight.lengthM * 0.5;
      const pieces = splitGeometryByKey(pm.mesh.geometry, (_cx, cy, cz) => {
        if (cz < -halfL * 0.62) return 'nose';
        if (cz < -halfL * 0.28) return 'fuse_fwd';
        if (cz > halfL * 0.52 && cy > spec.flight.heightM * 0.36) return 'tail';
        if (cz > halfL * 0.48) return 'aftFuselage';
        if (cz > halfL * 0.14) return 'fuse_aftmid';
        return 'fuselage';
      });
      for (const p of pieces) {
        if (p.geometry !== pm.mesh.geometry) disposableGeos.push(p.geometry);
        const m = new THREE.Mesh(p.geometry, pm.mesh.material);
        m.name = `${pm.name}_${p.tag}`;
        m.castShadow = pm.mesh.castShadow;
        m.receiveShadow = pm.mesh.receiveShadow;
        splitPending.push({...pm, mesh: m, forcedTag: p.tag});
      }
    } else if (isMultiEngine) {
      const pieces = splitGeometryByKey(pm.mesh.geometry, (cx) => {
        if (spec.flight.engineCount >= 4) {
          if (cx < -spec.flight.wingspanM * 0.28) return 'engine_0';
          if (cx < -1.0) return 'engine_1';
          if (cx > spec.flight.wingspanM * 0.28) return 'engine_3';
          if (cx > 1.0) return 'engine_2';
          return 'engine_c';
        }
        return cx < 0 ? 'engine_L' : 'engine_R';
      });
      for (const p of pieces) {
        if (p.geometry !== pm.mesh.geometry) disposableGeos.push(p.geometry);
        const m = new THREE.Mesh(p.geometry, pm.mesh.material);
        m.name = `${pm.name}_${p.tag}`;
        m.castShadow = pm.mesh.castShadow;
        m.receiveShadow = pm.mesh.receiveShadow;
        splitPending.push({...pm, mesh: m, forcedTag: p.tag});
      }
    } else {
      splitPending.push(pm);
    }
  }

  // Sub-chunk registry for granular break-apart by impact energy
  const subPieces: SubPieceEntry[] = [];
  const subPieceMap = new Map<string, THREE.Group>();
  const getOrCreateSubPiece = (
    key: string,
    parent: THREE.Group,
    zone: keyof StructuralZoneHealth,
    label: string,
    fractureThreshold: number,
  ): THREE.Group => {
    let g = subPieceMap.get(key);
    if (!g) {
      g = new THREE.Group();
      subPieceMap.set(key, g);
      parent.add(g);
      subPieces.push({key, group: g, zone, label, fractureThreshold});
    }
    return g;
  };

  // Helper for individual breakable engine pods (clustered cleanly by X position)
  const enginePodBucketMap = new Map<string, THREE.Group>();
  const getOrCreateEnginePod = (key: string, label: string): THREE.Group => {
    let g = enginePodBucketMap.get(key);
    if (!g) {
      g = new THREE.Group();
      enginePodBucketMap.set(key, g);
      enginesGroup.add(g);
      enginePods.push({group: g, label});
    }
    return g;
  };

  // Track trunnion pivot heights for smooth gear swing retraction
  let nosePivotRef = new THREE.Vector3(0, spec.flight.heightM * 0.16, -spec.flight.gearWheelbaseM * 0.55);
  let leftPivotRef = new THREE.Vector3(-spec.flight.gearTrackM * 0.5, spec.flight.heightM * 0.2, 0.5);
  let rightPivotRef = new THREE.Vector3(spec.flight.gearTrackM * 0.5, spec.flight.heightM * 0.2, 0.5);
  const noseGearRaw: Array<{mesh: THREE.Mesh; isWheel: boolean; mc: THREE.Vector3}> = [];
  const leftGearRaw: Array<{mesh: THREE.Mesh; isWheel: boolean; mc: THREE.Vector3}> = [];
  const rightGearRaw: Array<{mesh: THREE.Mesh; isWheel: boolean; mc: THREE.Vector3}> = [];

  const visorPivot = new THREE.Group();
  let visorHingeSet = false;
  const maxGearAbsX = Math.max(3.0, spec.flight.gearTrackM * 0.78);

  const CONTROL_EXCLUDE_RE =
    /track|tk\d|rod|hinge|sousvolet|trim|housing|fairing|bay|box|well|light|door|gear|flapwing|flap_.*_h\b/i;
  const detectControlSurface = (
    nl: string,
    bb: THREE.Box3,
    mc: THREE.Vector3,
    isInterior: boolean,
    isGlass: boolean,
  ): {kind: ControlSurfaceKind; side: -1 | 0 | 1} | null => {
    if (isInterior || isGlass || CONTROL_EXCLUDE_RE.test(nl)) return null;
    if (spec.id === 'b707' && /^elevwing/i.test(nl)) return null;
    if (spec.id === 'l1011' && nl === 'rudder_l1011') return null;
    const side: -1 | 0 | 1 = Math.abs(mc.x) < 0.45 ? 0 : mc.x < 0 ? -1 : 1;
    if (/rudder/i.test(nl) && bb.max.x - bb.min.x < 1.4) {
      return {kind: 'rudder', side: 0};
    }
    if (spec.id === 'b767' && /^lhstab\.002/i.test(nl)) {
      return {kind: 'elevator', side: -1};
    }
    if (/elevwing|elevon/i.test(nl)) {
      return {kind: 'elevon', side: mc.x < 0 ? -1 : 1};
    }
    if (/elev|profondeur|helev/i.test(nl)) {
      return {kind: 'elevator', side: mc.x < 0 ? -1 : 1};
    }
    if (/ailer/i.test(nl)) {
      return {kind: 'aileron', side: mc.x < 0 ? -1 : 1};
    }
    if (/spoil|speedbrake/i.test(nl)) {
      return {kind: 'spoiler', side};
    }
    if (/slat|\bbec\b/i.test(nl)) {
      return {kind: 'slat', side: mc.x < 0 ? -1 : 1};
    }
    if (/flap|volet/i.test(nl)) {
      return {kind: 'flap', side: mc.x < 0 ? -1 : 1};
    }
    return null;
  };

  const resolveWingParentByX = (absX: number, isLeft: boolean): THREE.Group => {
    const wingRootX = Math.max(1.2, spec.flight.wingspanM * 0.13);
    const halfSpan = Math.max(4, spec.flight.wingspanM * 0.5);
    const frac = (absX - wingRootX) / Math.max(1, halfSpan - wingRootX);
    const seg = frac < 0.34 ? 0 : frac < 0.68 ? 1 : 2;
    const tag = `${isLeft ? 'leftWing' : 'rightWing'}_s${seg}`;
    const sub = subPieceMap.get(tag);
    if (sub) return sub;
    return isLeft ? leftWingGroup : rightWingGroup;
  };

  interface PendingCtrlItem {
    mesh: THREE.Mesh;
    parent: THREE.Group;
    ctrl: {kind: ControlSurfaceKind; side: -1 | 0 | 1};
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  }
  const pendingCtrlItems: PendingCtrlItem[] = [];

  const attachControlSurfaceCluster = (items: PendingCtrlItem[]) => {
    if (items.length === 0) return;
    const ctrl = items[0].ctrl;
    const parent = items[0].parent;
    const vPos = new THREE.Vector3();

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (const item of items) {
      const posAttr = item.mesh.geometry.attributes.position as THREE.BufferAttribute | undefined;
      if (!posAttr) continue;
      for (let i = 0; i < posAttr.count; i++) {
        vPos.fromBufferAttribute(posAttr, i);
        if (vPos.x < minX) minX = vPos.x;
        if (vPos.x > maxX) maxX = vPos.x;
        if (vPos.y < minY) minY = vPos.y;
        if (vPos.y > maxY) maxY = vPos.y;
        if (vPos.z < minZ) minZ = vPos.z;
        if (vPos.z > maxZ) maxZ = vPos.z;
      }
    }

    if (!Number.isFinite(minX)) return;

    const hingePos = new THREE.Vector3();
    const hingeAxis = new THREE.Vector3(1, 0, 0);
    let localChordM = Math.max(0.15, maxZ - minZ);

    if (ctrl.kind === 'rudder') {
      const dy = Math.max(0.2, maxY - minY);
      const SLICES = 4;
      const sMinZ = new Array<number>(SLICES).fill(Infinity);
      const sMaxZ = new Array<number>(SLICES).fill(-Infinity);
      for (const item of items) {
        const posAttr = item.mesh.geometry.attributes.position as THREE.BufferAttribute | undefined;
        if (!posAttr) continue;
        for (let i = 0; i < posAttr.count; i++) {
          const py = posAttr.getY(i);
          const pz = posAttr.getZ(i);
          const b = Math.min(SLICES - 1, Math.max(0, Math.floor(((py - minY) / dy) * SLICES)));
          if (pz < sMinZ[b]) sMinZ[b] = pz;
          if (pz > sMaxZ[b]) sMaxZ[b] = pz;
        }
      }
      let chordSum = 0;
      let chordCnt = 0;
      for (let b = 0; b < SLICES; b++) {
        if (Number.isFinite(sMinZ[b]) && sMaxZ[b] > sMinZ[b]) {
          chordSum += sMaxZ[b] - sMinZ[b];
          chordCnt++;
        }
      }
      localChordM = Math.max(0.18, chordCnt > 0 ? chordSum / chordCnt : maxZ - minZ);

      const botCutY = minY + dy * 0.24;
      const topCutY = maxY - dy * 0.24;
      let botMinZ = Infinity;
      let topMinZ = Infinity;
      for (const item of items) {
        const posAttr = item.mesh.geometry.attributes.position as THREE.BufferAttribute | undefined;
        if (!posAttr) continue;
        for (let i = 0; i < posAttr.count; i++) {
          const py = posAttr.getY(i);
          const pz = posAttr.getZ(i);
          if (py <= botCutY && pz < botMinZ) botMinZ = pz;
          if (py >= topCutY && pz < topMinZ) topMinZ = pz;
        }
      }
      const tol = Math.max(0.08, localChordM * 0.18);
      const pBot = new THREE.Vector3();
      const pTop = new THREE.Vector3();
      let botCnt = 0;
      let topCnt = 0;
      for (const item of items) {
        const posAttr = item.mesh.geometry.attributes.position as THREE.BufferAttribute | undefined;
        if (!posAttr) continue;
        for (let i = 0; i < posAttr.count; i++) {
          const px = posAttr.getX(i);
          const py = posAttr.getY(i);
          const pz = posAttr.getZ(i);
          if (py <= botCutY && pz <= botMinZ + tol) {
            pBot.x += px;
            pBot.y += py;
            pBot.z += pz;
            botCnt++;
          }
          if (py >= topCutY && pz <= topMinZ + tol) {
            pTop.x += px;
            pTop.y += py;
            pTop.z += pz;
            topCnt++;
          }
        }
      }
      if (botCnt > 0 && topCnt > 0) {
        pBot.divideScalar(botCnt);
        pTop.divideScalar(topCnt);
        hingeAxis.subVectors(pTop, pBot);
        if (hingeAxis.lengthSq() > 1e-4) hingeAxis.normalize();
        else hingeAxis.set(0, 1, 0);
        if (hingeAxis.y < 0) hingeAxis.negate();
        hingePos.addVectors(pBot, pTop).multiplyScalar(0.5);
        hingePos.x = (minX + maxX) * 0.5;
        hingePos.z += localChordM * 0.08;
      } else {
        hingePos.set((minX + maxX) * 0.5, (minY + maxY) * 0.5, minZ + localChordM * 0.12);
        hingeAxis.set(0, 1, 0);
      }
    } else {
      const dx = Math.max(0.15, maxX - minX);
      const SLICES = 6;
      const sMinZ = new Array<number>(SLICES).fill(Infinity);
      const sMaxZ = new Array<number>(SLICES).fill(-Infinity);
      for (const item of items) {
        const posAttr = item.mesh.geometry.attributes.position as THREE.BufferAttribute | undefined;
        if (!posAttr) continue;
        for (let i = 0; i < posAttr.count; i++) {
          const px = posAttr.getX(i);
          const pz = posAttr.getZ(i);
          const b = Math.min(SLICES - 1, Math.max(0, Math.floor(((px - minX) / dx) * SLICES)));
          if (pz < sMinZ[b]) sMinZ[b] = pz;
          if (pz > sMaxZ[b]) sMaxZ[b] = pz;
        }
      }
      let chordSum = 0;
      let chordCnt = 0;
      for (let b = 0; b < SLICES; b++) {
        if (Number.isFinite(sMinZ[b]) && sMaxZ[b] > sMinZ[b]) {
          chordSum += sMaxZ[b] - sMinZ[b];
          chordCnt++;
        }
      }
      localChordM = Math.max(0.14, chordCnt > 0 ? chordSum / chordCnt : maxZ - minZ);

      const leftCutX = minX + dx * 0.24;
      const rightCutX = maxX - dx * 0.24;
      const isSlat = ctrl.kind === 'slat';
      let leftSeamZ = isSlat ? -Infinity : Infinity;
      let rightSeamZ = isSlat ? -Infinity : Infinity;

      for (const item of items) {
        const posAttr = item.mesh.geometry.attributes.position as THREE.BufferAttribute | undefined;
        if (!posAttr) continue;
        for (let i = 0; i < posAttr.count; i++) {
          const px = posAttr.getX(i);
          const pz = posAttr.getZ(i);
          if (px <= leftCutX) {
            if (isSlat ? pz > leftSeamZ : pz < leftSeamZ) leftSeamZ = pz;
          }
          if (px >= rightCutX) {
            if (isSlat ? pz > rightSeamZ : pz < rightSeamZ) rightSeamZ = pz;
          }
        }
      }

      const tol = Math.max(0.06, localChordM * 0.16);
      const pLeft = new THREE.Vector3();
      const pRight = new THREE.Vector3();
      let leftCnt = 0;
      let rightCnt = 0;

      for (const item of items) {
        const posAttr = item.mesh.geometry.attributes.position as THREE.BufferAttribute | undefined;
        if (!posAttr) continue;
        for (let i = 0; i < posAttr.count; i++) {
          const px = posAttr.getX(i);
          const py = posAttr.getY(i);
          const pz = posAttr.getZ(i);
          if (px <= leftCutX && (isSlat ? pz >= leftSeamZ - tol : pz <= leftSeamZ + tol)) {
            pLeft.x += px;
            pLeft.y += py;
            pLeft.z += pz;
            leftCnt++;
          }
          if (px >= rightCutX && (isSlat ? pz >= rightSeamZ - tol : pz <= rightSeamZ + tol)) {
            pRight.x += px;
            pRight.y += py;
            pRight.z += pz;
            rightCnt++;
          }
        }
      }

      if (leftCnt > 0 && rightCnt > 0) {
        pLeft.divideScalar(leftCnt);
        pRight.divideScalar(rightCnt);
        hingeAxis.subVectors(pRight, pLeft);
        if (hingeAxis.lengthSq() > 1e-4) hingeAxis.normalize();
        else hingeAxis.set(1, 0, 0);
        if (hingeAxis.x < 0) hingeAxis.negate();
        hingePos.addVectors(pLeft, pRight).multiplyScalar(0.5);
        // Slightly inset hinge pin inside the wing/HStab shroud so rotating leaves zero seam gap
        if (isSlat) {
          hingePos.z -= localChordM * 0.14;
        } else if (ctrl.kind === 'flap') {
          hingePos.z += localChordM * 0.16;
        } else {
          hingePos.z += localChordM * 0.1;
        }
      } else {
        hingePos.set(
          (minX + maxX) * 0.5,
          (minY + maxY) * 0.5,
          isSlat ? maxZ - localChordM * 0.14 : minZ + localChordM * 0.12,
        );
        hingeAxis.set(1, 0, 0);
      }
    }

    const pivot = new THREE.Group();
    pivot.position.copy(hingePos);
    for (const item of items) {
      item.mesh.geometry.translate(-hingePos.x, -hingePos.y, -hingePos.z);
      pivot.add(item.mesh);
    }
    parent.add(pivot);
    controlSurfaces.push({
      kind: ctrl.kind,
      side: ctrl.side,
      pivot,
      basePos: hingePos.clone(),
      hingeAxis,
      chordM: localChordM,
    });
  };

  for (const pm of splitPending) {
    pm.mesh.geometry.computeBoundingBox();
    const bb = pm.mesh.geometry.boundingBox!;
    const mc = new THREE.Vector3();
    bb.getCenter(mc);
    const nl = pm.name.toLowerCase();

    // Flag cockpit internal bulkheads / doors / interior trims so cockpit view is never blocked
    if (pm.isInterior) {
      cockpitHiddenMeshes.push(pm.mesh);
    }

    // 1. Concorde Droop Nose & Visor
    if (spec.id === 'concorde' && /nose_0|nose_1|visor/i.test(nl)) {
      if (!visorHingeSet) {
        visorHingeSet = true;
        visorPivot.position.set(0, 3.85, -22.6 * lenScale + shiftZ);
        noseGroup.add(visorPivot);
        visorMeshes.push(visorPivot);
      }
      pm.mesh.geometry.translate(-visorPivot.position.x, -visorPivot.position.y, -visorPivot.position.z);
      visorPivot.add(pm.mesh);
      continue;
    }

    // 2. Exact Misnamed-Mesh Classification, Control Surfaces & Break-Apart Routing for Lockheed L-1011
    if (spec.id === 'l1011') {
      const resolveL1011WingSub = (absX: number, isLeft: boolean): THREE.Group => {
        const lWingRootX = 2.2;
        const halfSpan = Math.max(4, spec.flight.wingspanM * 0.5);
        const frac = (absX - lWingRootX) / Math.max(1, halfSpan - lWingRootX);
        const seg = frac < 0.34 ? 0 : frac < 0.68 ? 1 : 2;
        const tag = `${isLeft ? 'leftWing' : 'rightWing'}_s${seg}`;
        const label = isLeft
          ? seg === 2
            ? 'Port Wingtip'
            : seg === 1
              ? 'Port Outer Wing'
              : 'Port Inboard Wing'
          : seg === 2
            ? 'Starboard Wingtip'
            : seg === 1
              ? 'Starboard Outer Wing'
              : 'Starboard Inboard Wing';
        const thr = seg === 2 ? 0.34 : seg === 1 ? 0.48 : 0.65;
        return getOrCreateSubPiece(tag, isLeft ? leftWingGroup : rightWingGroup, isLeft ? 'leftWing' : 'rightWing', label, thr);
      };

      const pushL1011Ctrl = (parent: THREE.Group, kind: ControlSurfaceKind, side: -1 | 0 | 1) => {
        pendingCtrlItems.push({
          mesh: pm.mesh,
          parent,
          ctrl: {kind, side},
          minX: bb.min.x,
          maxX: bb.max.x,
          minZ: bb.min.z,
          maxZ: bb.max.z,
        });
      };

      // Nose & Main Landing Gear + Wheels (separated from oleo struts so struts never rotate)
      if (nl === 'l1011_nose_wheel' || nl === 'l1011_nose_strut') {
        const isWheel = nl === 'l1011_nose_wheel';
        noseGearRaw.push({mesh: pm.mesh, isWheel, mc});
        nosePivotRef.set(0, Math.max(nosePivotRef.y, bb.max.y), mc.z);
        gearMeshes.push(pm.mesh);
        continue;
      }
      if (nl === 'l1011_lgear_wheel' || nl === 'l1011_lgear_strut' || nl === 'lgear_l1011') {
        const isWheel = nl === 'l1011_lgear_wheel';
        leftGearRaw.push({mesh: pm.mesh, isWheel, mc});
        leftPivotRef.set(mc.x, Math.max(leftPivotRef.y, bb.max.y), mc.z);
        gearMeshes.push(pm.mesh);
        continue;
      }
      if (nl === 'l1011_rgear_wheel' || nl === 'l1011_rgear_strut' || nl === 'lstab_l1011') {
        const isWheel = nl === 'l1011_rgear_wheel';
        rightGearRaw.push({mesh: pm.mesh, isWheel, mc});
        rightPivotRef.set(mc.x, Math.max(rightPivotRef.y, bb.max.y), mc.z);
        gearMeshes.push(pm.mesh);
        continue;
      }

      // Closed Nose Doors vs Open Main Doors vs Gear Wells
      if (/^flandg(lbdo|lsdo|rsdo)_l1011$/i.test(nl) || /^eng2rev_l1011$/i.test(nl)) {
        closedGearDoorMeshes.push(pm.mesh);
        fuselageGroup.add(pm.mesh);
        continue;
      }
      if (/^(fgear|fgearbox|mlandgldoo|rgear|rsdoor)_l1011$/i.test(nl) || /^mlandglhol_l1011\.001$/i.test(nl)) {
        openGearDoorMeshes.push(pm.mesh);
        fuselageGroup.add(pm.mesh);
        continue;
      }
      if (/^(rwing|lgearbox|rgearbox)_l1011$/i.test(nl)) {
        fuselageGroup.add(pm.mesh);
        continue;
      }

      // Engines (#1 Left RB211, #2 Center S-Duct Exhaust, #3 Right RB211)
      if (/^(lreverser|lfan|mlandglhol)_l1011$/i.test(nl)) {
        const pod = getOrCreateEnginePod('pod_L', '#1 Left RB211 Engine');
        if (nl === 'mlandglhol_l1011') {
          pm.mesh.geometry.translate(-mc.x, -mc.y, -mc.z);
          pm.mesh.position.copy(mc);
          fanMeshes.push(pm.mesh);
        }
        pod.add(pm.mesh);
        continue;
      }
      if (/^(rreverser|lsdoor|rengine)_l1011$/i.test(nl)) {
        const pod = getOrCreateEnginePod('pod_R', '#3 Right RB211 Engine');
        if (nl === 'rengine_l1011') {
          pm.mesh.geometry.translate(-mc.x, -mc.y, -mc.z);
          pm.mesh.position.copy(mc);
          fanMeshes.push(pm.mesh);
        }
        pod.add(pm.mesh);
        continue;
      }
      if (nl === 'rudder_l1011') {
        const pod = getOrCreateEnginePod('pod_C', '#2 Center S-Duct RB211');
        pod.add(pm.mesh);
        continue;
      }

      // Horizontal Stabilizers & Flap Track Fairings
      if (/^rstab_l1011/i.test(nl)) {
        leftHStabGroup.add(pm.mesh);
        continue;
      }
      if (/^lhs_l1011/i.test(nl)) {
        rightHStabGroup.add(pm.mesh);
        continue;
      }
      if (nl === 'lwingfairi_l1011') {
        getOrCreateSubPiece('leftWing_s1', leftWingGroup, 'leftWing', 'Port Outer Wing', 0.48).add(pm.mesh);
        continue;
      }
      if (nl === 'rwingfairi_l1011') {
        getOrCreateSubPiece('rightWing_s1', rightWingGroup, 'rightWing', 'Starboard Outer Wing', 0.48).add(pm.mesh);
        continue;
      }

      // L-1011 Control Surfaces (exact AC3D-to-function mapping)
      if (nl === 'fuselage_l1011') {
        pushL1011Ctrl(tailGroup, 'rudder', 0);
        continue;
      }
      if (/^rhs_l1011/i.test(nl)) {
        pushL1011Ctrl(leftHStabGroup, 'elevator', -1);
        continue;
      }
      if (/^rfan_l1011/i.test(nl)) {
        pushL1011Ctrl(rightHStabGroup, 'elevator', 1);
        continue;
      }
      if (/^(loutbflap|routbslat)_l1011$/i.test(nl)) {
        pushL1011Ctrl(resolveL1011WingSub(Math.abs(mc.x), true), 'flap', -1);
        continue;
      }
      if (/^(routbflap|lgeararm)_l1011$/i.test(nl)) {
        pushL1011Ctrl(resolveL1011WingSub(Math.abs(mc.x), false), 'flap', 1);
        continue;
      }
      if (/^(linbflap|linbailero)_l1011$/i.test(nl)) {
        pushL1011Ctrl(resolveL1011WingSub(Math.abs(mc.x), true), 'slat', -1);
        continue;
      }
      if (/^(rinbflap|rinbailero)_l1011$/i.test(nl)) {
        pushL1011Ctrl(resolveL1011WingSub(Math.abs(mc.x), false), 'slat', 1);
        continue;
      }
      if (/^(linbspoile|mlandgrhol)_l1011$/i.test(nl)) {
        pushL1011Ctrl(resolveL1011WingSub(Math.abs(mc.x), true), 'aileron', -1);
        continue;
      }
      if (/^(routbailer|rinbspoile)_l1011$/i.test(nl)) {
        pushL1011Ctrl(resolveL1011WingSub(Math.abs(mc.x), false), 'aileron', 1);
        continue;
      }
      if (/^(lmedspoile|loutbspoil|lwing)_l1011$/i.test(nl)) {
        pushL1011Ctrl(resolveL1011WingSub(Math.abs(mc.x), true), 'spoiler', -1);
        continue;
      }
      if (/^(rmedspoile|routbspoil|rinbslat)_l1011$/i.test(nl)) {
        pushL1011Ctrl(resolveL1011WingSub(Math.abs(mc.x), false), 'spoiler', 1);
        continue;
      }

      // Split Breakable Wing & Fuselage Sub-Assemblies + Doors
      const tag = pm.forcedTag;
      if (tag?.startsWith('leftWing_s')) {
        const segIdx = tag.slice(-1);
        const label = segIdx === '2' ? 'Port Wingtip' : segIdx === '1' ? 'Port Outer Wing' : 'Port Inboard Wing';
        const thr = segIdx === '2' ? 0.34 : segIdx === '1' ? 0.48 : 0.65;
        getOrCreateSubPiece(tag, leftWingGroup, 'leftWing', label, thr).add(pm.mesh);
      } else if (tag?.startsWith('rightWing_s')) {
        const segIdx = tag.slice(-1);
        const label = segIdx === '2' ? 'Starboard Wingtip' : segIdx === '1' ? 'Starboard Outer Wing' : 'Starboard Inboard Wing';
        const thr = segIdx === '2' ? 0.34 : segIdx === '1' ? 0.48 : 0.65;
        getOrCreateSubPiece(tag, rightWingGroup, 'rightWing', label, thr).add(pm.mesh);
      } else if (tag === 'nose' || (pm.isInterior && mc.z < -17.0) || mc.z < -17.0) {
        noseGroup.add(pm.mesh);
      } else if (tag === 'fuse_fwd' || mc.z < -7.5) {
        getOrCreateSubPiece('fuse_fwd', fuselageGroup, 'fuselage', 'Forward Cabin Section', 0.56).add(pm.mesh);
      } else if (tag === 'tail') {
        tailGroup.add(pm.mesh);
      } else if (tag === 'aftFuselage' || mc.z > 14.0) {
        aftFuselageGroup.add(pm.mesh);
      } else if (tag === 'fuse_aftmid' || mc.z > 7.5) {
        getOrCreateSubPiece('fuse_aftmid', fuselageGroup, 'fuselage', 'Mid-Aft Cabin Section', 0.58).add(pm.mesh);
      } else {
        fuselageGroup.add(pm.mesh);
      }
      continue;
    }

    // 3. Closed Gear Doors vs Open Gear Doors across fleet
    if (spec.id === 'dc10' && variant?.id === 'dc10-10' && /^gearcdoor/i.test(nl)) {
      fuselageGroup.add(pm.mesh);
      continue;
    }
    const isClosedGearDoor =
      /doorclosed$/i.test(nl) ||
      (spec.id === 'b727' && /^(lmgdoor2|rmgdoor2|nmgdoor)/i.test(nl) && bb.max.y - bb.min.y < 0.3);
    if (isClosedGearDoor) {
      closedGearDoorMeshes.push(pm.mesh);
      fuselageGroup.add(pm.mesh);
      continue;
    }

    const isGearBayOrWell = /bay|well|trimwheel/i.test(nl);
    const isGearDoor =
      !isGearBayOrWell &&
      (/door|cover|trappe/i.test(nl) && /gear|lmg|rmg|nlg|mlg|nose|main|fl?andg/i.test(nl) ||
        (spec.id === 'concorde' && /bigdoor|maindoor|doorfront|sucd|ucd/i.test(nl)));
    if (isGearDoor) {
      if (spec.id === 'citation' && /gear\..*\.door/i.test(nl)) {
        // Keep Citation stowed doors flush closed when retracted
        closedGearDoorMeshes.push(pm.mesh);
      } else {
        openGearDoorMeshes.push(pm.mesh);
      }
      fuselageGroup.add(pm.mesh);
      continue;
    }

    // 4. Landing Gear & Wheel Classification (strict track guard so wings/engines never get misclassified)
    const isWheel =
      !isGearBayOrWell &&
      /(?:wheel|tire|tyre|whell|pneu|roue|lmgt|rmgt)/i.test(nl) &&
      Math.abs(mc.x) < maxGearAbsX;
    const isGear =
      !isGearBayOrWell &&
      (pm.forceZone === 'gear' ||
        /gear|wheel|tire|tyre|whell|strut|oleo|scissor|bogie|axle|nlg|mlg|wlg|blg|nosegear|maingear|pneu|roue|train|lmgt|rmgt|tyreln|tyrern|lgear|rgear|ngear|fgear/i.test(
          nl,
        )) &&
      Math.abs(mc.x) < maxGearAbsX;

    if (isGear || isWheel) {
      gearMeshes.push(pm.mesh);
      if (mc.z < -spec.flight.lengthM * 0.16 || /nose|front|nlg|ng|tyreln|tyrern/.test(nl)) {
        noseGearRaw.push({mesh: pm.mesh, isWheel, mc});
        nosePivotRef.set(0, Math.max(nosePivotRef.y, bb.max.y), mc.z);
      } else if (mc.x < -0.35 || /left|lmg|wlg|blg\.l/i.test(nl)) {
        leftGearRaw.push({mesh: pm.mesh, isWheel, mc});
        leftPivotRef.set(mc.x, Math.max(leftPivotRef.y, bb.max.y), mc.z);
      } else {
        rightGearRaw.push({mesh: pm.mesh, isWheel, mc});
        rightPivotRef.set(mc.x, Math.max(rightPivotRef.y, bb.max.y), mc.z);
      }
      continue;
    }

    // 5. Spinning Propellers & Turbofans (recentered to own axle!)
    const isC172Prop = spec.id === 'c172' && /prop|spinner|cone\.001/i.test(nl);
    if (isC172Prop) {
      pm.mesh.geometry.translate(-mc.x, -mc.y, -mc.z);
      pm.mesh.position.copy(mc);
      propGroups.push(pm.mesh);
      fuselageGroup.add(pm.mesh);
      continue;
    }
    if (/^fan|^blades|^turbofan|fanblade/i.test(nl)) {
      pm.mesh.geometry.translate(-mc.x, -mc.y, -mc.z);
      pm.mesh.position.copy(mc);
      fanMeshes.push(pm.mesh);
    }

    // 6. Rigid Breakable Sub-Assembly & Control Surface Routing
    const tag = pm.forcedTag;
    const ctrlSurface = detectControlSurface(nl, bb, mc, pm.isInterior, pm.isGlass);
    const placeInto = (targetGroup: THREE.Group) => {
      if (ctrlSurface) {
        pendingCtrlItems.push({
          mesh: pm.mesh,
          parent: targetGroup,
          ctrl: ctrlSurface,
          minX: bb.min.x,
          maxX: bb.max.x,
          minZ: bb.min.z,
          maxZ: bb.max.z,
        });
      } else {
        targetGroup.add(pm.mesh);
      }
    };

    if (tag?.startsWith('leftWing_s')) {
      const segIdx = tag.slice(-1);
      const label = segIdx === '2' ? 'Port Wingtip' : segIdx === '1' ? 'Port Outer Wing' : 'Port Inboard Wing';
      const thr = segIdx === '2' ? 0.34 : segIdx === '1' ? 0.48 : 0.65;
      placeInto(getOrCreateSubPiece(tag, leftWingGroup, 'leftWing', label, thr));
    } else if (tag?.startsWith('rightWing_s')) {
      const segIdx = tag.slice(-1);
      const label = segIdx === '2' ? 'Starboard Wingtip' : segIdx === '1' ? 'Starboard Outer Wing' : 'Starboard Inboard Wing';
      const thr = segIdx === '2' ? 0.34 : segIdx === '1' ? 0.48 : 0.65;
      placeInto(getOrCreateSubPiece(tag, rightWingGroup, 'rightWing', label, thr));
    } else if (tag === 'fuse_fwd') {
      placeInto(getOrCreateSubPiece('fuse_fwd', fuselageGroup, 'fuselage', 'Forward Cabin Section', 0.56));
    } else if (tag === 'fuse_aftmid') {
      placeInto(getOrCreateSubPiece('fuse_aftmid', fuselageGroup, 'fuselage', 'Mid-Aft Cabin Section', 0.58));
    } else if (tag === 'leftHStab') {
      placeInto(leftHStabGroup);
    } else if (tag === 'rightHStab') {
      placeInto(rightHStabGroup);
    } else if (tag === 'aftFuselage') {
      placeInto(aftFuselageGroup);
    } else if (tag === 'nose') {
      placeInto(noseGroup);
    } else if (tag?.startsWith('engine_')) {
      const pod = getOrCreateEnginePod(tag, `Engine ${tag.replace('engine_', '#').toUpperCase()}`);
      pod.add(pm.mesh);
    } else if (tag === 'tail') {
      placeInto(tailGroup);
    } else {
      const isEngine =
        pm.forceZone === 'engines' ||
        /eng|nacelle|turbofan|cf6|jt8|jt3|rb211|pylon|reverser|intake|nozzle|moteur/.test(nl);
      const isHStab =
        /hstab|horzstab|elev(?!wing|on)|tailplane|profondeur|helev/.test(nl) ||
        (spec.id === 'b707' && /^elevwing/i.test(nl)) ||
        (spec.id === 'caravelle' && nl === 'derive2');
      const isTail =
        pm.forceZone === 'tail' ||
        /rudder|vstab|tail|derive|fin\b/.test(nl) ||
        (mc.z > spec.flight.lengthM * 0.28 && mc.y > spec.flight.heightM * 0.35);
      const isNoseCone =
        !pm.isInterior &&
        (/nosecone|radome|nose_0|nose_1/.test(nl) || (mc.z < -spec.flight.lengthM * 0.41 && Math.abs(mc.x) < 1.3));
      const isLeftWing =
        !isEngine &&
        !isTail &&
        !isHStab &&
        ((ctrlSurface && ctrlSurface.side === -1) ||
          /leftwing|lwing|aileronl|ailerong|flapl|slatl/.test(nl) ||
          mc.x < -spec.flight.wingspanM * 0.16);
      const isRightWing =
        !isEngine &&
        !isTail &&
        !isHStab &&
        ((ctrlSurface && ctrlSurface.side === 1) ||
          /rightwing|rwing|aileronr|ailerond|flapr|slatr/.test(nl) ||
          mc.x > spec.flight.wingspanM * 0.16);

      if (isHStab && mc.x < -0.45) {
        placeInto(leftHStabGroup);
      } else if (isHStab && mc.x > 0.45) {
        placeInto(rightHStabGroup);
      } else if (isLeftWing) {
        placeInto(resolveWingParentByX(Math.abs(mc.x), true));
      } else if (isRightWing) {
        placeInto(resolveWingParentByX(Math.abs(mc.x), false));
      } else if (isEngine && !isTail) {
        // Cluster engines individually by X coordinate band!
        const band =
          spec.flight.engineCount >= 4
            ? mc.x < -spec.flight.wingspanM * 0.27
              ? 'pod_0'
              : mc.x < -0.9
                ? 'pod_1'
                : mc.x > spec.flight.wingspanM * 0.27
                  ? 'pod_3'
                  : mc.x > 0.9
                    ? 'pod_2'
                    : 'pod_c'
            : mc.x < -0.6
              ? 'pod_L'
              : mc.x > 0.6
                ? 'pod_R'
                : 'pod_C';
        const pod = getOrCreateEnginePod(band, `Engine Pod ${band.replace('pod_', '#')}`);
        pod.add(pm.mesh);
      } else if (isTail) {
        placeInto(tailGroup);
      } else if (isNoseCone) {
        placeInto(noseGroup);
      } else {
        placeInto(fuselageGroup);
      }
    }
  }

  // Cluster overlapping multi-material/upper-lower control surface meshes onto shared 3D swept hinges
  const ctrlClusters: PendingCtrlItem[][] = [];
  for (const item of pendingCtrlItems) {
    let matchedCluster: PendingCtrlItem[] | null = null;
    for (const cluster of ctrlClusters) {
      const ref = cluster[0];
      if (ref.ctrl.kind !== item.ctrl.kind || ref.ctrl.side !== item.ctrl.side || ref.parent !== item.parent) {
        continue;
      }
      if (item.ctrl.kind === 'rudder') {
        matchedCluster = cluster;
        break;
      }
      const overlapX = Math.min(ref.maxX, item.maxX) - Math.max(ref.minX, item.minX);
      const minSpanX = Math.max(0.08, Math.min(ref.maxX - ref.minX, item.maxX - item.minX));
      const zGap = Math.max(0, Math.max(ref.minZ, item.minZ) - Math.min(ref.maxZ, item.maxZ));
      if (overlapX / minSpanX > 0.55 && zGap < 0.75) {
        matchedCluster = cluster;
        break;
      }
    }
    if (matchedCluster) matchedCluster.push(item);
    else ctrlClusters.push([item]);
  }
  for (const cluster of ctrlClusters) {
    attachControlSurfaceCluster(cluster);
  }

  // Finalize gear hinge pivots & recenter every tire geometry onto its own axle so wheels spin cleanly in place!
  const attachGearItems = (
    group: THREE.Group,
    pivot: THREE.Vector3,
    items: Array<{mesh: THREE.Mesh; isWheel: boolean; mc: THREE.Vector3}>,
  ) => {
    group.position.copy(pivot);
    for (const item of items) {
      if (item.isWheel) {
        // Translate wheel geometry so (0,0,0) is its exact hub center, positioned inside gear group!
        item.mesh.geometry.translate(-item.mc.x, -item.mc.y, -item.mc.z);
        item.mesh.position.set(
          item.mc.x - pivot.x,
          item.mc.y - pivot.y,
          item.mc.z - pivot.z,
        );
        wheelMeshes.push(item.mesh);
      } else {
        item.mesh.geometry.translate(-pivot.x, -pivot.y, -pivot.z);
      }
      group.add(item.mesh);
    }
  };

  attachGearItems(noseGearGroup, nosePivotRef, noseGearRaw);
  attachGearItems(leftGearGroup, leftPivotRef, leftGearRaw);
  attachGearItems(rightGearGroup, rightPivotRef, rightGearRaw);

  // Add Missing Boeing 707 4x JT3D Engines + 4-Wheel Main Gear Bogies
  const tireMat = new THREE.MeshStandardMaterial({color: 0x181b20, roughness: 0.88, metalness: 0.08});
  const rimMat = new THREE.MeshStandardMaterial({color: 0xd0d7e2, roughness: 0.3, metalness: 0.85});
  const strutMat = new THREE.MeshStandardMaterial({color: 0xbac3cf, roughness: 0.35, metalness: 0.82});
  disposableMats.push(tireMat, rimMat, strutMat);

  if (spec.id === 'b707') {
    const cowlMat = new THREE.MeshStandardMaterial({color: 0xd6dde6, roughness: 0.28, metalness: 0.65});
    const intakeDarkMat = new THREE.MeshStandardMaterial({color: 0x111419, roughness: 0.75, metalness: 0.25});
    const bladeMat = new THREE.MeshStandardMaterial({color: 0x626c7a, roughness: 0.35, metalness: 0.85});
    disposableMats.push(cowlMat, intakeDarkMat, bladeMat);

    // Coordinates measured from b707/707.ac engineSupport pylon undersides in normalized aircraft space
    const pylonPods: Array<{key: string; label: string; pos: THREE.Vector3; rad: number; len: number}> = [
      {key: 'jt3d_1', label: '#1 Port Outer JT3D', pos: new THREE.Vector3(-14.81, 2.02, 0.25), rad: 0.72, len: 4.55},
      {key: 'jt3d_2', label: '#2 Port Inner JT3D', pos: new THREE.Vector3(-10.06, 1.56, -3.15), rad: 0.74, len: 4.7},
      {key: 'jt3d_3', label: '#3 Stbd Inner JT3D', pos: new THREE.Vector3(10.06, 1.56, -3.15), rad: 0.74, len: 4.7},
      {key: 'jt3d_4', label: '#4 Stbd Outer JT3D', pos: new THREE.Vector3(14.81, 2.02, 0.25), rad: 0.72, len: 4.55},
    ];
    for (const cfg of pylonPods) {
      const podParent = getOrCreateEnginePod(cfg.key, cfg.label);
      const {podGroup, fanPivot} = createProceduralJetEnginePod(
        cfg.pos,
        cfg.rad,
        cfg.len,
        cowlMat,
        rimMat,
        intakeDarkMat,
        rimMat,
        bladeMat,
        disposableGeos,
      );
      podParent.add(podGroup);
      fanMeshes.push(fanPivot);
    }

    // Missing 707 4-wheel main gear bogies (attached below LeftGearCompressor & RightGearCompressor at Y=0.40)
    const wheelRad707 = 0.46;
    const leftBogie = createProceduralMainGearBogie(
      -2.75 - leftGearGroup.position.x,
      wheelRad707 - leftGearGroup.position.y,
      -0.25 - leftGearGroup.position.z,
      0.85 - leftGearGroup.position.y,
      wheelRad707,
      0.34,
      0.42,
      1.12,
      tireMat,
      rimMat,
      strutMat,
      disposableGeos,
    );
    leftGearGroup.add(leftBogie.gearAttachGroup);
    wheelMeshes.push(...leftBogie.tires);

    const rightBogie = createProceduralMainGearBogie(
      2.75 - rightGearGroup.position.x,
      wheelRad707 - rightGearGroup.position.y,
      -0.25 - rightGearGroup.position.z,
      0.85 - rightGearGroup.position.y,
      wheelRad707,
      0.34,
      0.42,
      1.12,
      tireMat,
      rimMat,
      strutMat,
      disposableGeos,
    );
    rightGearGroup.add(rightBogie.gearAttachGroup);
    wheelMeshes.push(...rightBogie.tires);
  }

  // Add Missing Airbus A310 4-Wheel Main Gear Bogies (Gears.ac legs terminate at Y=0.72 while NoseWheel sits at Y=0.0)
  if (spec.id === 'a310') {
    const wheelRad310 = 0.54;
    const leftBogie310 = createProceduralMainGearBogie(
      -4.39 - leftGearGroup.position.x,
      wheelRad310 - leftGearGroup.position.y,
      -2.12 - leftGearGroup.position.z,
      1.15 - leftGearGroup.position.y,
      wheelRad310,
      0.38,
      0.46,
      1.26,
      tireMat,
      rimMat,
      strutMat,
      disposableGeos,
    );
    leftGearGroup.add(leftBogie310.gearAttachGroup);
    wheelMeshes.push(...leftBogie310.tires);

    const rightBogie310 = createProceduralMainGearBogie(
      4.39 - rightGearGroup.position.x,
      wheelRad310 - rightGearGroup.position.y,
      -2.12 - rightGearGroup.position.z,
      1.15 - rightGearGroup.position.y,
      wheelRad310,
      0.38,
      0.46,
      1.26,
      tireMat,
      rimMat,
      strutMat,
      disposableGeos,
    );
    rightGearGroup.add(rightBogie310.gearAttachGroup);
    wheelMeshes.push(...rightBogie310.tires);
  }

  // Measure true deployed tire/gear ground contact patches in airframe-local space
  airframeGroup.updateMatrixWorld(true);
  const wheelMeshSet = new Set<THREE.Object3D>(wheelMeshes);
  const gearContactBox = new THREE.Box3();
  const meshBoxTmp = new THREE.Box3();
  const computeGearContactPoint = (
    group: THREE.Group,
    fallbackX: number,
    fallbackZ: number,
    isNose: boolean,
  ): THREE.Vector3 => {
    gearContactBox.makeEmpty();
    group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh && wheelMeshSet.has(obj)) {
        meshBoxTmp.setFromObject(obj);
        if (!meshBoxTmp.isEmpty()) gearContactBox.union(meshBoxTmp);
      }
    });
    if (gearContactBox.isEmpty()) {
      gearContactBox.setFromObject(group);
    }
    if (!gearContactBox.isEmpty()) {
      const cx = (gearContactBox.min.x + gearContactBox.max.x) * 0.5;
      const cz = (gearContactBox.min.z + gearContactBox.max.z) * 0.5;
      const cy = gearContactBox.min.y < 0.25 ? Math.max(0, gearContactBox.min.y) : gearContactBox.min.y;
      return new THREE.Vector3(isNose ? 0 : cx, cy, cz);
    }
    return new THREE.Vector3(fallbackX, 0, fallbackZ);
  };
  const gearContactPoints = {
    nose: computeGearContactPoint(noseGearGroup, 0, -spec.flight.gearWheelbaseM * 0.62, true),
    left: computeGearContactPoint(leftGearGroup, -spec.flight.gearTrackM * 0.5, spec.flight.gearWheelbaseM * 0.38, false),
    right: computeGearContactPoint(rightGearGroup, spec.flight.gearTrackM * 0.5, spec.flight.gearWheelbaseM * 0.38, false),
  };

  // Add missing GE CF6-50 outer cowlings, chrome intake lips, bypass ducts, and swept pylons to DC-10 underwing engines
  if (spec.id === 'dc10') {
    const dc10CowlMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(1, 1, 1),
      roughness: 0.3,
      metalness: 0.35,
      envMapIntensity: 1.05,
    });
    const dc10LipMat = new THREE.MeshStandardMaterial({
      color: 0xdce2ea,
      roughness: 0.2,
      metalness: 0.88,
      side: THREE.DoubleSide,
      envMapIntensity: 1.25,
    });
    const dc10LinerMat = new THREE.MeshStandardMaterial({
      color: 0x1a2028,
      roughness: 0.82,
      metalness: 0.2,
      side: THREE.BackSide,
    });
    const dc10DuctMat = new THREE.MeshStandardMaterial({
      color: 0x262d37,
      roughness: 0.55,
      metalness: 0.62,
      side: THREE.DoubleSide,
    });
    const dc10PylonMat = new THREE.MeshStandardMaterial({
      color: 0xd4dae2,
      roughness: 0.36,
      metalness: 0.45,
      envMapIntensity: 1.0,
    });
    disposableMats.push(dc10CowlMat, dc10LipMat, dc10LinerMat, dc10DuctMat, dc10PylonMat);
    liveryMaterials.push(dc10CowlMat);
    void initialLiveryTexPromise.then((tex) => {
      if (tex) {
        dc10CowlMat.map = tex;
        dc10CowlMat.needsUpdate = true;
      }
    });

    const portPod = enginePodBucketMap.get('pod_L');
    if (portPod) {
      attachDc10UnderwingNacelle(
        portPod,
        true,
        lenScale,
        dc10CowlMat,
        dc10LipMat,
        dc10LinerMat,
        dc10DuctMat,
        dc10PylonMat,
        disposableGeos,
      );
    }
    const stbdPod = enginePodBucketMap.get('pod_R');
    if (stbdPod) {
      attachDc10UnderwingNacelle(
        stbdPod,
        false,
        lenScale,
        dc10CowlMat,
        dc10LipMat,
        dc10LinerMat,
        dc10DuctMat,
        dc10PylonMat,
        disposableGeos,
      );
    }
  }

  // Attach post-grounding variant-specific hardware (737-300 CFM56 pods, L-1011 #2 S-duct fan/nozzle, C172XP 3-blade prop, etc.)
  attachPostGroundVariantParts(
    spec,
    variant,
    {
      fuselageGroup,
      aftFuselageGroup,
      leftWingGroup,
      tailGroup,
      enginesGroup,
      noseGroup,
      propGroups,
      fanMeshes,
      enginePods,
      getOrCreateEnginePod,
    },
    disposableGeos,
    disposableMats,
  );

  // Sort enginePods port-to-starboard (1..N) and compute exact engine world-local centers for per-engine fires!
  const podBox = new THREE.Box3();
  const podCenter = new THREE.Vector3();
  const podWithX = enginePods.map((pod) => {
    pod.group.updateMatrixWorld(true);
    podBox.setFromObject(pod.group);
    if (!podBox.isEmpty()) podBox.getCenter(podCenter);
    else podCenter.set(0, spec.flight.heightM * 0.22, 0);
    return {pod, center: podCenter.clone()};
  });
  podWithX.sort((a, b) => a.center.x - b.center.x);
  enginePods.length = 0;
  podWithX.forEach((item, idx) => {
    item.pod.label = `Engine #${idx + 1}`;
    enginePods.push(item.pod);
  });

  const engineCenters: THREE.Vector3[] = [];
  if (podWithX.length >= spec.flight.engineCount) {
    for (let i = 0; i < spec.flight.engineCount; i++) {
      engineCenters.push(podWithX[i].center);
    }
  } else if (spec.id === 'dc10' && podWithX.length === 2) {
    engineCenters.push(podWithX[0].center);
    engineCenters.push(
      new THREE.Vector3(0, spec.flight.heightM * 0.54, spec.flight.lengthM * 0.36),
    );
    engineCenters.push(podWithX[1].center);
  } else {
    // Fallback / Prop aircraft (ATR42, C172, F-16, or center #2 engines)
    const count = spec.flight.engineCount;
    const h = spec.flight.heightM;
    const l = spec.flight.lengthM;
    const w = spec.flight.wingspanM;
    if (count === 1) {
      engineCenters.push(
        new THREE.Vector3(0, spec.id === 'c172' ? h * 0.35 : h * 0.25, spec.id === 'c172' ? -l * 0.42 : l * 0.4),
      );
    } else if (count === 2) {
      const ex = w * 0.17;
      engineCenters.push(new THREE.Vector3(-ex, h * 0.22, l * 0.02));
      engineCenters.push(new THREE.Vector3(ex, h * 0.22, l * 0.02));
    } else if (count === 3) {
      engineCenters.push(new THREE.Vector3(-w * 0.12, h * 0.3, l * 0.26));
      engineCenters.push(new THREE.Vector3(0, h * 0.48, l * 0.36));
      engineCenters.push(new THREE.Vector3(w * 0.12, h * 0.3, l * 0.26));
    } else {
      engineCenters.push(new THREE.Vector3(-w * 0.34, h * 0.22, l * 0.04));
      engineCenters.push(new THREE.Vector3(-w * 0.2, h * 0.2, -l * 0.06));
      engineCenters.push(new THREE.Vector3(w * 0.2, h * 0.2, -l * 0.06));
      engineCenters.push(new THREE.Vector3(w * 0.34, h * 0.22, l * 0.04));
    }
  }

  // Mount interactive 3D Cockpit Rig positioned right at pilot eye coordinate!
  const cockpitRig = createCockpitRig(spec);
  cockpitRig.group.position.set(
    spec.flight.cockpitOffset[0],
    spec.flight.cockpitOffset[1],
    spec.flight.cockpitOffset[2],
  );
  cockpitRig.group.visible = false;
  airframeGroup.add(cockpitRig.group);

  // Navigation strobes, anti-collision beacon, and landing spotlight scaled to aircraft
  const strobeMat = new THREE.MeshBasicMaterial({color: 0xffffff});
  const beaconMat = new THREE.MeshBasicMaterial({color: 0xff2222});
  disposableMats.push(strobeMat, beaconMat);

  const sGeo = new THREE.SphereGeometry(Math.max(0.08, spec.flight.wingspanM * 0.0045), 6, 6);
  disposableGeos.push(sGeo);
  const halfSpan = spec.flight.wingspanM * 0.48;
  const wingY = spec.flight.heightM * 0.28;

  const strobeL = new THREE.Mesh(sGeo, strobeMat);
  strobeL.position.set(-halfSpan, wingY, spec.flight.lengthM * 0.14);
  const strobeR = new THREE.Mesh(sGeo, strobeMat);
  strobeR.position.set(halfSpan, wingY, spec.flight.lengthM * 0.14);
  const beaconTop = new THREE.Mesh(sGeo, beaconMat);
  beaconTop.position.set(0, spec.flight.heightM * 0.42, -spec.flight.lengthM * 0.08);
  airframeGroup.add(strobeL, strobeR, beaconTop);

  const landingLightBeam = new THREE.SpotLight(0xfff4dc, 0, 260, Math.PI / 7, 0.55, 1.1);
  landingLightBeam.position.set(0, 1.4, -spec.flight.lengthM * 0.36);
  const lightTarget = new THREE.Object3D();
  lightTarget.position.set(0, -1.5, -spec.flight.lengthM * 0.36 - 85);
  airframeGroup.add(landingLightBeam, lightTarget);
  landingLightBeam.target = lightTarget;

  return {
    spec,
    variantId: variant?.id ?? spec.defaultVariantId,
    root,
    airframeGroup,
    fuselageGroup,
    aftFuselageGroup,
    leftWingGroup,
    rightWingGroup,
    tailGroup,
    leftHStabGroup,
    rightHStabGroup,
    enginesGroup,
    enginePods,
    engineCenters,
    subPieces,
    noseGroup,
    noseGearGroup,
    leftGearGroup,
    rightGearGroup,
    gearContactPoints,
    gearMeshes,
    openGearDoorMeshes,
    closedGearDoorMeshes,
    wheelMeshes,
    fanMeshes,
    propGroups,
    visorMeshes,
    controlSurfaces,
    cockpitRig,
    cockpitHiddenMeshes,
    strobeLights: [strobeL, strobeR],
    beaconLights: [beaconTop],
    landingLightBeam,
    liveryMaterials,
    groundClearanceY: 0,
    setLiveryTexture: async (textureUrl: string) => {
      const tex = await getTexPromise(textureUrl);
      if (!tex) return;
      for (const m of liveryMaterials) {
        m.map = tex;
        m.needsUpdate = true;
      }
    },
    dispose: () => {
      cockpitRig.dispose();
      disposableGeos.forEach((g) => g.dispose());
      disposableMats.forEach((m) => m.dispose());
      loadedTextures.forEach((t) => t.dispose());
    },
  };
}
