import * as THREE from 'three';
import type {ControlSurfaceEntry, EnginePodEntry, LoadedAircraftRig, SubPieceEntry} from './ac3dLoader';
import {AircraftSpec, AircraftVariant} from './aircraftCatalog';
import {createCockpitRig} from './cockpitRig';
import {StructuralZoneHealth} from './types';

interface Dc9VariantConfig {
  isMd80Series: boolean;
  isMd90: boolean;
  hasNoseStrakes: boolean;
  hasBeaverTailcone: boolean;
  hasSlats: boolean;
  hasWingRootPlug: boolean;
  lengthM: number;
  wingspanM: number;
  heightM: number;
  gearWheelbaseM: number;
  gearTrackM: number;
  engineRadiusM: number;
  engineLengthM: number;
  engineOffsetZFromTailTip: number;
}

function getDc9VariantConfig(spec: AircraftSpec, variant?: AircraftVariant): Dc9VariantConfig {
  const vid = (variant?.id ?? spec.defaultVariantId).toLowerCase();
  const isMd80Series = spec.id === 'md80' || vid.startsWith('md');
  const isMd90 = vid.startsWith('md90');
  const isMd87 = vid === 'md87';
  const isDc910 = vid === 'dc9-10';
  const isDc950 = vid === 'dc9-50';

  return {
    isMd80Series,
    isMd90,
    hasNoseStrakes: isMd80Series || isDc950,
    hasBeaverTailcone: isMd80Series,
    hasSlats: !isDc910,
    hasWingRootPlug: isMd80Series,
    lengthM: spec.flight.lengthM,
    wingspanM: spec.flight.wingspanM,
    heightM: isMd87 ? 9.3 : spec.flight.heightM,
    gearWheelbaseM: spec.flight.gearWheelbaseM,
    gearTrackM: spec.flight.gearTrackM,
    engineRadiusM: isMd90 ? 0.94 : isMd80Series ? 0.74 : 0.62,
    engineLengthM: isMd90 ? 4.68 : isMd80Series ? 4.92 : 3.92,
    engineOffsetZFromTailTip: isMd90 ? 7.6 : isMd80Series ? 7.2 : 5.9,
  };
}

function hermite(y0: number, y1: number, m0: number, m1: number, x0: number, x1: number, x: number): number {
  const dx = Math.max(1e-5, x1 - x0);
  const t = THREE.MathUtils.clamp((x - x0) / dx, 0, 1);
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * y0 +
    (t3 - 2 * t2 + t) * dx * m0 +
    (-2 * t3 + 3 * t2) * y1 +
    (t3 - t2) * dx * m1
  );
}

interface FuselageSectionSample {
  s: number;
  z: number;
  rx: number;
  yTop: number;
  yBot: number;
  yMid: number;
  beaverFlat: number; // 0 = circular/double-bubble, 1 = flat horizontal chisel beaver tailcone
}

/**
 * Exact Douglas DC-9 / MD-80 blueprint longitudinal cross-section evaluator.
 * - Outer fuselage width: 3.343 m (131.6 in -> rx0 = 1.6715 m)
 * - Outer height: 3.61 m (double-bubble: ryTop = 1.76 m, ryBot = 1.85 m)
 * - Centerline Y = 2.72 m (0.87 m belly ground clearance per APM)
 * - Drooped nose tip at yRel = -0.46 m (s = 0), radome bulkhead at s = 1.48 m,
 *   flat raked windshield sill knuckle at s = 1.56 m -> header s = 2.48 m (~40.4 deg rake).
 */
function evaluateDc9Section(s: number, totalLength: number, cfg: Dc9VariantConfig): FuselageSectionSample {
  const zTip = -totalLength * 0.5;
  const rx0 = 1.6715;
  const ryTop0 = 1.76;
  const ryBot0 = 1.85;
  const yTip = -0.46;

  const tailTransitionLen = cfg.hasBeaverTailcone ? 10.6 : 9.4;
  const sTailStart = totalLength - tailTransitionLen;

  let rx = rx0;
  let yTop = ryTop0;
  let yBot = -ryBot0;
  let yMid = 0;
  let beaverFlat = 0;

  if (s <= 1.56) {
    // Radome (STA 0 .. STA 61): smooth tangent parabolic nose cap drooping low below centerline
    const u = THREE.MathUtils.clamp(s / 1.56, 0, 1);
    rx = 0.84 * Math.pow(u, 0.56);
    yTop = yTip + 0.55 * Math.pow(u, 0.62); // -0.46 -> +0.09
    yBot = yTip - 0.86 * Math.pow(u, 0.54); // -0.46 -> -1.32
    yMid = yTip - 0.12 * Math.pow(u, 0.72); // -0.46 -> -0.58
  } else if (s < 6.6) {
    // Cockpit Windshield, Eyebrow Brow, & Forward Cabin Transition (STA 61 .. STA 260)
    rx = hermite(0.84, rx0, 0.3, 0.0, 1.56, 6.2, s);
    yBot = hermite(-1.32, -ryBot0, -0.28, 0.0, 1.56, 5.4, s);
    yMid = hermite(-0.58, 0.0, 0.15, 0.0, 1.56, 5.8, s);

    if (s <= 2.48) {
      // Flat raked windshield face (~40.4 deg)
      const t = (s - 1.56) / (2.48 - 1.56);
      yTop = THREE.MathUtils.lerp(0.09, 0.84, t);
    } else if (s <= 3.05) {
      // Upper eyebrow roof curve easing smoothly from windshield header toward crown
      yTop = hermite(0.84, 1.24, 0.78, 0.3, 2.48, 3.05, s);
    } else {
      yTop = hermite(1.24, ryTop0, 0.25, 0.0, 3.05, 6.5, s);
    }
  } else if (s <= sTailStart) {
    // Constant-section double-bubble passenger cabin
    rx = rx0;
    yTop = ryTop0;
    yBot = -ryBot0;
    yMid = 0;
  } else {
    // Aft Fuselage Taper & Tailcone (Conical DC-9 vs Flat Screwdriver/Beaver Tailcone MD-80/90)
    const tTail = THREE.MathUtils.clamp((s - sTailStart) / tailTransitionLen, 0, 1);
    const upsweep = hermite(0.0, 1.0, 0.0, 0.28, 0, 1, tTail);
    const widthTaper = Math.pow(1 - tTail, 0.72);

    if (cfg.hasBeaverTailcone) {
      const beaverT = THREE.MathUtils.smoothstep(tTail, 0.42, 0.96);
      beaverFlat = beaverT;
      rx = Math.max(0.02, rx0 * Math.pow(1 - tTail, 0.58) * (1 - 0.16 * beaverT) + 0.02 * (1 - tTail));
      const coneCenterY = THREE.MathUtils.lerp(0.0, 0.72, upsweep);
      const halfH = Math.max(0.035, 1.78 * Math.pow(1 - tTail, 0.92) * (1 - 0.55 * beaverT));
      yMid = coneCenterY;
      yTop = coneCenterY + halfH * 0.92;
      yBot = coneCenterY - halfH * 1.02;
    } else {
      rx = Math.max(0.015, rx0 * widthTaper);
      const coneCenterY = THREE.MathUtils.lerp(0.0, 0.68, upsweep);
      const halfH = Math.max(0.015, 1.8 * widthTaper);
      yMid = coneCenterY;
      yTop = coneCenterY + halfH * 0.96;
      yBot = coneCenterY - halfH * 1.02;
    }
  }

  return {
    s,
    z: zTip + s,
    rx,
    yTop,
    yBot,
    yMid,
    beaverFlat,
  };
}

/**
 * Evaluate base outer hull point at longitudinal distance s and cross-section angle phi
 * (phi = 0 top crown, PI/2 starboard cheek, PI bottom keel, 3PI/2 port cheek).
 */
function sampleBaseHullPoint(
  sec: FuselageSectionSample,
  phi: number,
  yCenter: number,
): THREE.Vector3 {
  const c = Math.cos(phi);
  const sn = Math.sin(phi);
  const hTop = Math.max(0.008, sec.yTop - sec.yMid);
  const hBot = Math.max(0.008, sec.yMid - sec.yBot);
  const ry = c >= 0 ? hTop : hBot;

  let xNorm = sn;
  let yNorm = c;

  if (sec.beaverFlat > 0.01) {
    const flatPow = THREE.MathUtils.lerp(2.0, 3.8, sec.beaverFlat);
    const rSuper = Math.pow(Math.pow(Math.abs(sn), flatPow) + Math.pow(Math.abs(c), 1.55), 1 / flatPow);
    if (rSuper > 1e-4) {
      xNorm = sn / Math.max(0.75, rSuper);
      yNorm = c / Math.max(0.75, rSuper);
    }
  } else {
    const bubble = c < 0 ? 1 + 0.032 * Math.sin(Math.min(Math.PI, Math.abs(c) * Math.PI)) * (sec.rx / 1.6715) : 1;
    xNorm = sn * bubble;
  }

  return new THREE.Vector3(sec.rx * xNorm, yCenter + sec.yMid + ry * yNorm, sec.z);
}

interface WindshieldFacet {
  p0: THREE.Vector3; // bottom-inner
  p1: THREE.Vector3; // bottom-outer
  p2: THREE.Vector3; // top-outer
  p3: THREE.Vector3; // top-inner
  normal: THREE.Vector3;
}

/**
 * Derive the 6-pane flight-deck windshield + 2 eyebrow windows directly from exact mold-line
 * surface coordinates so every frame and pane seats seamlessly onto the Douglas nose loft!
 */
function buildCockpitFacets(totalLength: number, yCenter: number, cfg: Dc9VariantConfig): {
  rightFacets: WindshieldFacet[];
  eyebrowRight: WindshieldFacet;
} {
  const hullPt = (s: number, phiDeg: number) => {
    const sec = evaluateDc9Section(s, totalLength, cfg);
    return sampleBaseHullPoint(sec, THREE.MathUtils.degToRad(phiDeg), yCenter);
  };

  const makeFacet = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3): WindshieldFacet => {
    const e1 = new THREE.Vector3().subVectors(p1, p0);
    const e2 = new THREE.Vector3().subVectors(p3, p0);
    const n = new THREE.Vector3().crossVectors(e1, e2).normalize();
    // Outward normal always points toward starboard (+X), up (+Y), and slightly forward (-Z)
    if (n.x * (p0.x + p1.x + p2.x) + n.y * 1.2 + n.z * -0.4 < 0) n.negate();
    return {p0, p1, p2, p3, normal: n};
  };

  // Front Windshield Pane (sharp Douglas V-planform + ~40 deg elevation rake)
  const f0 = hullPt(1.62, 5);
  const f1 = hullPt(1.92, 34);
  const f2 = hullPt(2.62, 27);
  const f3 = hullPt(2.42, 4);

  // Quarter Forward-Side Pane
  const q0 = f1.clone();
  const q1 = hullPt(2.48, 60);
  const q2 = hullPt(3.04, 48);
  const q3 = f2.clone();

  // Aft Sliding Direct-Vision Side Pane (classic stepped-up rear sill!)
  const a0 = q1.clone();
  const a1 = hullPt(3.48, 64);
  const a2 = hullPt(3.48, 44);
  const a3 = q2.clone();

  // Signature Douglas Overhead Eyebrow Window
  const e0 = hullPt(2.55, 10);
  const e1 = hullPt(2.78, 30);
  const e2 = hullPt(3.02, 26);
  const e3 = hullPt(2.84, 8);

  return {
    rightFacets: [makeFacet(f0, f1, f2, f3), makeFacet(q0, q1, q2, q3), makeFacet(a0, a1, a2, a3)],
    eyebrowRight: makeFacet(e0, e1, e2, e3),
  };
}

/**
 * Applies cockpit window recess indentation smoothly onto the nose loft vertices
 * so the flat glass panes sit recessed inside crisp window cheeks without Z-fighting.
 */
function sampleFuselageRingPoint(
  sec: FuselageSectionSample,
  phi: number,
  yCenter: number,
  cfg: Dc9VariantConfig,
): THREE.Vector3 {
  const p = sampleBaseHullPoint(sec, phi, yCenter);
  const phiDeg = THREE.MathUtils.radToDeg(phi);
  const absPhiDeg = phiDeg > 180 ? 360 - phiDeg : phiDeg;

  if (sec.s > 1.6 && sec.s < 3.5 && absPhiDeg > 4 && absPhiDeg < 66) {
    const wS = THREE.MathUtils.smoothstep(sec.s, 1.6, 1.76) * (1 - THREE.MathUtils.smoothstep(sec.s, 3.35, 3.5));
    const wPhi = THREE.MathUtils.smoothstep(absPhiDeg, 4, 12) * (1 - THREE.MathUtils.smoothstep(absPhiDeg, 56, 66));
    const w = wS * wPhi;
    if (w > 0.001) {
      const yRel = p.y - yCenter;
      const radialLen = Math.max(0.1, Math.hypot(p.x, yRel - sec.yMid));
      const recess = 0.024 * w;
      p.x -= (p.x / radialLen) * recess;
      p.y -= ((yRel - sec.yMid) / radialLen) * recess;
    }
  }
  return p;
}

/**
 * Builds a complete, seamlessly normal-smoothed fuselage loft across nose, forward cabin, center cabin,
 * mid-aft cabin, and aft fuselage, then slices cleanly along exact bulkhead stations so break-apart
 * sections show ZERO seams when intact and detach cleanly on crash!
 */
function buildUnifiedFuselageSections(
  cfg: Dc9VariantConfig,
  yCenter: number,
  liveryMat: THREE.Material,
  disposableGeos: THREE.BufferGeometry[],
): {
  noseMesh: THREE.Mesh;
  fwdMesh: THREE.Mesh;
  centerMesh: THREE.Mesh;
  aftMidMesh: THREE.Mesh;
  aftMesh: THREE.Mesh;
} {
  const L = cfg.lengthM;

  const sList: number[] = [
    0.0, 0.04, 0.1, 0.2, 0.34, 0.52, 0.74, 0.98, 1.24, 1.48, 1.56, 1.72, 1.92, 2.15, 2.38, 2.52,
    2.74, 2.98, 3.24, 3.5, 3.85,
  ];
  const sCutNose = 4.25;
  sList.push(sCutNose);

  const sCutFwd = Math.max(8.2, L * 0.34);
  const sCutAftMid = Math.max(sCutFwd + 4.5, L * 0.65);
  const sCutAft = Math.min(Math.max(sCutAftMid + 3.0, L * 0.78), L - 5.0);

  const addRange = (a: number, b: number, steps: number) => {
    for (let i = 1; i <= steps; i++) {
      sList.push(THREE.MathUtils.lerp(a, b, i / steps));
    }
  };
  addRange(sCutNose, 6.6, 4);
  addRange(6.6, sCutFwd, 4);
  addRange(sCutFwd, sCutAftMid, 5);
  addRange(sCutAftMid, sCutAft, 3);

  const sTailStart = L - (cfg.hasBeaverTailcone ? 10.6 : 9.4);
  if (sTailStart > sCutAft + 0.4) {
    addRange(sCutAft, sTailStart, 2);
    addRange(sTailStart, L - 0.4, 11);
  } else {
    addRange(sCutAft, L - 0.4, 12);
  }
  sList.push(L - 0.16, L - 0.04, L);

  sList.sort((a, b) => a - b);
  for (let i = sList.length - 1; i > 0; i--) {
    if (Math.abs(sList[i] - sList[i - 1]) < 1e-4) {
      sList.splice(i, 1);
    }
  }

  const RING_SEGS = 48;
  const ringVerts: THREE.Vector3[][] = [];
  const ringUvs: Array<Array<[number, number]>> = [];
  const ringNormals: THREE.Vector3[][] = [];

  for (let ri = 0; ri < sList.length; ri++) {
    const s = sList[ri];
    const sec = evaluateDc9Section(s, L, cfg);
    const verts: THREE.Vector3[] = [];
    const uvs: Array<[number, number]> = [];
    const norms: THREE.Vector3[] = [];
    const u = THREE.MathUtils.clamp(s / L, 0, 1);

    for (let j = 0; j <= RING_SEGS; j++) {
      const phi = (j / RING_SEGS) * Math.PI * 2;
      const p = sampleFuselageRingPoint(sec, phi, yCenter, cfg);
      verts.push(p);

      const yRel = p.y - yCenter;
      const vNorm = THREE.MathUtils.clamp((yRel + 1.85) / (1.76 + 1.85), 0, 1);
      const v = 0.54 + vNorm * 0.42;
      uvs.push([u, v]);
      norms.push(new THREE.Vector3());
    }
    ringVerts.push(verts);
    ringUvs.push(uvs);
    ringNormals.push(norms);
  }

  // Accumulate area-weighted OUTWARD smooth normals matching (a, c, d) and (a, d, b) CCW winding
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const fn = new THREE.Vector3();

  for (let ri = 0; ri < sList.length - 1; ri++) {
    for (let j = 0; j < RING_SEGS; j++) {
      const a = ringVerts[ri][j];
      const b = ringVerts[ri][j + 1];
      const c = ringVerts[ri + 1][j];
      const d = ringVerts[ri + 1][j + 1];

      // Tri 1: (a, c, d) -> (c - a) x (d - a) points OUTWARD
      e1.subVectors(c, a);
      e2.subVectors(d, a);
      fn.crossVectors(e1, e2);
      ringNormals[ri][j].add(fn);
      ringNormals[ri + 1][j].add(fn);
      ringNormals[ri + 1][j + 1].add(fn);

      // Tri 2: (a, d, b) -> (d - a) x (b - a) points OUTWARD
      e1.subVectors(d, a);
      e2.subVectors(b, a);
      fn.crossVectors(e1, e2);
      ringNormals[ri][j].add(fn);
      ringNormals[ri + 1][j + 1].add(fn);
      ringNormals[ri][j + 1].add(fn);
    }
  }

  for (let ri = 0; ri < sList.length; ri++) {
    const nSeam = new THREE.Vector3().addVectors(ringNormals[ri][0], ringNormals[ri][RING_SEGS]);
    if (nSeam.lengthSq() > 1e-10) nSeam.normalize();
    else nSeam.set(0, 1, 0);
    ringNormals[ri][0].copy(nSeam);
    ringNormals[ri][RING_SEGS].copy(nSeam);
    for (let j = 1; j < RING_SEGS; j++) {
      if (ri === 0) ringNormals[ri][j].set(0, 0, -1);
      else if (ri === sList.length - 1) ringNormals[ri][j].set(0, 0, 1);
      else if (ringNormals[ri][j].lengthSq() > 1e-10) ringNormals[ri][j].normalize();
      else ringNormals[ri][j].set(0, 1, 0);
    }
    if (ri === 0) {
      ringNormals[ri][0].set(0, 0, -1);
      ringNormals[ri][RING_SEGS].set(0, 0, -1);
    }
    if (ri === sList.length - 1) {
      ringNormals[ri][0].set(0, 0, 1);
      ringNormals[ri][RING_SEGS].set(0, 0, 1);
    }
  }

  const buildSliceMesh = (name: string, sMin: number, sMax: number): THREE.Mesh => {
    const pos: number[] = [];
    const norm: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];

    let startRi = 0;
    let endRi = sList.length - 1;
    let bestStartDiff = Infinity;
    let bestEndDiff = Infinity;
    for (let ri = 0; ri < sList.length; ri++) {
      const ds = Math.abs(sList[ri] - sMin);
      if (ds < bestStartDiff) {
        bestStartDiff = ds;
        startRi = ri;
      }
      const de = Math.abs(sList[ri] - sMax);
      if (de < bestEndDiff) {
        bestEndDiff = de;
        endRi = ri;
      }
    }

    for (let ri = startRi; ri <= endRi; ri++) {
      for (let j = 0; j <= RING_SEGS; j++) {
        const p = ringVerts[ri][j];
        const n = ringNormals[ri][j];
        const t = ringUvs[ri][j];
        pos.push(p.x, p.y, p.z);
        norm.push(n.x, n.y, n.z);
        uv.push(t[0], t[1]);
      }
    }

    const rowStride = RING_SEGS + 1;
    const rows = endRi - startRi;
    for (let r = 0; r < rows; r++) {
      for (let j = 0; j < RING_SEGS; j++) {
        const a = r * rowStride + j;
        const b = a + 1;
        const c = (r + 1) * rowStride + j;
        const d = c + 1;
        idx.push(a, c, d, a, d, b);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(norm), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
    geo.setIndex(idx);
    geo.computeBoundingBox();
    disposableGeos.push(geo);

    const mesh = new THREE.Mesh(geo, liveryMat);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  return {
    noseMesh: buildSliceMesh('DC9_NoseSection', 0.0, sCutNose),
    fwdMesh: buildSliceMesh('DC9_ForwardCabin', sCutNose, sCutFwd),
    centerMesh: buildSliceMesh('DC9_CenterCabin', sCutFwd, sCutAftMid),
    aftMidMesh: buildSliceMesh('DC9_AftMidCabin', sCutAftMid, sCutAft),
    aftMesh: buildSliceMesh('DC9_AftTailcone', sCutAft, L),
  };
}

/**
 * Helper to create a swept airfoil wing/stabilizer panel geometry with NACA-like camber & clean outward winding.
 */
function createAirfoilSpanMesh(
  stations: Array<{
    x: number;
    y: number;
    zLE: number;
    chord: number;
    thicknessRatio: number;
    camber: number;
  }>,
  isVertical: boolean,
  mat: THREE.Material,
  uvRegion: [number, number, number, number],
  disposableGeos: THREE.BufferGeometry[],
  name: string,
): THREE.Mesh {
  const PROFILE_PTS = 22;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];

  const loopCoords: Array<[number, number]> = [];
  for (let i = 0; i <= PROFILE_PTS; i++) {
    const t = i / PROFILE_PTS;
    const xc = 0.5 * (1 - Math.cos(t * Math.PI));
    const yt =
      5 *
      (0.2969 * Math.sqrt(xc) -
        0.126 * xc -
        0.3516 * xc * xc +
        0.2843 * xc * xc * xc -
        0.1036 * Math.pow(xc, 4));
    loopCoords.push([xc, yt]);
  }
  for (let i = PROFILE_PTS - 1; i >= 1; i--) {
    const t = i / PROFILE_PTS;
    const xc = 0.5 * (1 - Math.cos(t * Math.PI));
    const yt =
      5 *
      (0.2969 * Math.sqrt(xc) -
        0.126 * xc -
        0.3516 * xc * xc +
        0.2843 * xc * xc * xc -
        0.1036 * Math.pow(xc, 4));
    loopCoords.push([xc, -yt]);
  }

  const ringCount = loopCoords.length;
  const [u0, v0, u1, v1] = uvRegion;

  for (let si = 0; si < stations.length; si++) {
    const st = stations[si];
    const spanFrac = stations.length > 1 ? si / (stations.length - 1) : 0;
    for (let pi = 0; pi < ringCount; pi++) {
      const [xc, thickY] = loopCoords[pi];
      const camberOff = Math.sin(xc * Math.PI) * st.camber * st.chord;
      const th = thickY * st.thicknessRatio * st.chord + camberOff;
      if (isVertical) {
        pos.push(st.x + th, st.y, st.zLE + xc * st.chord);
      } else {
        pos.push(st.x, st.y + th, st.zLE + xc * st.chord);
      }
      const u = THREE.MathUtils.lerp(u0, u1, xc);
      const v = THREE.MathUtils.lerp(v0, v1, spanFrac);
      uv.push(u, v);
    }
  }

  // Outward CCW winding:
  // - Vertical fin (stations go +Y): (a, c, d, a, d, b) gives +X on starboard (+th) and -X on port (-th)
  // - Port horizontal wing (stations go -X): (a, c, d, a, d, b) gives +Y on top and -Y on bottom
  // - Starboard horizontal wing (stations go +X): (a, b, d, a, d, c) gives +Y on top and -Y on bottom
  const useACD = isVertical || (stations.length >= 2 && stations[stations.length - 1].x < stations[0].x);

  for (let si = 0; si < stations.length - 1; si++) {
    for (let pi = 0; pi < ringCount; pi++) {
      const nextPi = (pi + 1) % ringCount;
      const a = si * ringCount + pi;
      const b = si * ringCount + nextPi;
      const c = (si + 1) * ringCount + pi;
      const d = (si + 1) * ringCount + nextPi;
      if (useACD) {
        idx.push(a, c, d, a, d, b);
      } else {
        idx.push(a, b, d, a, d, c);
      }
    }
  }

  const addCap = (si: number, reverse: boolean) => {
    const st = stations[si];
    const centerIdx = pos.length / 3;
    pos.push(st.x, st.y, st.zLE + st.chord * 0.42);
    uv.push((u0 + u1) * 0.5, si === 0 ? v0 : v1);
    for (let pi = 0; pi < ringCount; pi++) {
      const nextPi = (pi + 1) % ringCount;
      const a = si * ringCount + pi;
      const b = si * ringCount + nextPi;
      if (reverse) idx.push(centerIdx, b, a);
      else idx.push(centerIdx, a, b);
    }
  };
  addCap(0, !useACD);
  addCap(stations.length - 1, useACD);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  disposableGeos.push(geo);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Helper to create a swept airfoil control surface wrapped in its exact 3D hinge pivot!
 */
function addControlSurfacePanel(
  parent: THREE.Group,
  kind: ControlSurfaceEntry['kind'],
  side: -1 | 0 | 1,
  pStart: THREE.Vector3,
  pEnd: THREE.Vector3,
  chordStart: number,
  chordEnd: number,
  thicknessRatio: number,
  isVertical: boolean,
  isLeadingEdge: boolean,
  mat: THREE.Material,
  disposableGeos: THREE.BufferGeometry[],
  controlSurfaces: ControlSurfaceEntry[],
  name: string,
) {
  const hingePos = new THREE.Vector3().addVectors(pStart, pEnd).multiplyScalar(0.5);
  const hingeAxis = new THREE.Vector3().subVectors(pEnd, pStart);
  if (hingeAxis.lengthSq() > 1e-6) hingeAxis.normalize();
  else hingeAxis.set(isVertical ? 0 : 1, isVertical ? 1 : 0, 0);

  if (isVertical) {
    if (hingeAxis.y < 0) hingeAxis.negate();
  } else {
    if (hingeAxis.x < 0) hingeAxis.negate();
  }

  const s0 = pStart.clone().sub(hingePos);
  const s1 = pEnd.clone().sub(hingePos);

  const stations = [
    {
      x: s0.x,
      y: s0.y,
      zLE: isLeadingEdge ? s0.z - chordStart * 0.88 : s0.z - chordStart * 0.14,
      chord: chordStart * 1.14,
      thicknessRatio,
      camber: 0.012,
    },
    {
      x: s1.x,
      y: s1.y,
      zLE: isLeadingEdge ? s1.z - chordEnd * 0.88 : s1.z - chordEnd * 0.14,
      chord: chordEnd * 1.14,
      thicknessRatio,
      camber: 0.012,
    },
  ];

  const pivot = new THREE.Group();
  pivot.position.copy(hingePos);
  const mesh = createAirfoilSpanMesh(stations, isVertical, mat, [0.05, 0.05, 0.4, 0.4], disposableGeos, name);
  pivot.add(mesh);
  parent.add(pivot);

  controlSurfaces.push({
    kind,
    side,
    pivot,
    basePos: hingePos.clone(),
    hingeAxis,
    chordM: (chordStart + chordEnd) * 0.5,
  });
}

function createQuadMesh(
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  p3: THREE.Vector3,
  mat: THREE.Material,
  disposableGeos: THREE.BufferGeometry[],
  name: string,
  offsetAlongNormal: number,
  outwardNormal: THREE.Vector3,
): THREE.Mesh {
  const n = outwardNormal.clone().normalize();
  const off = n.clone().multiplyScalar(offsetAlongNormal);

  const a = p0.clone().add(off);
  const b = p1.clone().add(off);
  const c = p2.clone().add(off);
  const d = p3.clone().add(off);

  // Ensure front-facing CCW winding matches outward normal n
  const triN = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
  const indices = triN.dot(n) >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];

  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z]);
  const norm = new Float32Array([n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z]);
  const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(indices);
  geo.computeBoundingBox();
  disposableGeos.push(geo);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  return mesh;
}

function addFrameStrut(
  parent: THREE.Group,
  a: THREE.Vector3,
  b: THREE.Vector3,
  radius: number,
  mat: THREE.Material,
  disposableGeos: THREE.BufferGeometry[],
) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len < 1e-4) return;
  const geo = new THREE.BoxGeometry(radius * 2, radius * 1.4, len + radius * 1.2);
  disposableGeos.push(geo);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.lookAt(b);
  parent.add(mesh);
}

/**
 * Procedural 2048x1024 Airline Livery Atlas Texture for DC-9 / MD-80 / MD-90 family:
 * - Upper Band v in [0.54, 0.96]: Fuselage (u = 0 nose tip -> u = 1 tail tip)
 * - Lower-Left (u in [0.02, 0.46], v in [0.04, 0.46]): Vertical Stabilizer Fin
 * - Lower-Right (u in [0.50, 0.98], v in [0.04, 0.46]): Engine Nacelle Cowling
 */
function createDc9LiveryTexture(
  liveryId: string,
  totalLength: number,
  cfg: Dc9VariantConfig,
  maxAniso: number,
): THREE.CanvasTexture {
  const W = 2048;
  const H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  const fTopY = 41;
  const fBotY = 471;
  const fHeight = fBotY - fTopY;
  const yForRel = (yRel: number) => {
    const vNorm = THREE.MathUtils.clamp((yRel + 1.85) / (1.76 + 1.85), 0, 1);
    const v = 0.54 + vNorm * 0.42;
    return (1 - v) * H;
  };
  const xForS = (s: number) => THREE.MathUtils.clamp(s / totalLength, 0, 1) * W;

  const isBareMetal = liveryId === 'aal' || liveryId === 'eal';
  const isDelta = liveryId === 'dal80';
  const isTwa = liveryId === 'twa';
  const isNwa = liveryId === 'nwa';
  const isSas = liveryId === 'sas';
  const isSwr = liveryId === 'swr';
  const isAsa = liveryId === 'asa';
  const isOzk = liveryId === 'ozk';

  if (isBareMetal) {
    const metalGrad = ctx.createLinearGradient(0, fTopY, 0, fBotY);
    metalGrad.addColorStop(0.0, '#eef2f7');
    metalGrad.addColorStop(0.32, '#d5dde7');
    metalGrad.addColorStop(0.55, '#9ea8b6');
    metalGrad.addColorStop(0.75, '#cbd4df');
    metalGrad.addColorStop(1.0, '#788291');
    ctx.fillStyle = metalGrad;
    ctx.fillRect(0, fTopY - 25, W, fHeight + 50);
  } else {
    ctx.fillStyle = '#f5f7fa';
    ctx.fillRect(0, fTopY - 25, W, fHeight + 50);

    const bellyGrad = ctx.createLinearGradient(0, yForRel(-0.35), 0, fBotY);
    bellyGrad.addColorStop(0, isNwa || isTwa ? '#c5cdd8' : isSas ? '#d2d8e0' : '#aeb8c6');
    bellyGrad.addColorStop(0.4, '#8d98a8');
    bellyGrad.addColorStop(1, '#667080');
    ctx.fillStyle = bellyGrad;
    ctx.fillRect(0, yForRel(-0.35), W, fBotY - yForRel(-0.35) + 25);
  }

  const yWinTop = yForRel(0.56);
  const yWinCenter = yForRel(0.34);
  const yWinBot = yForRel(0.14);

  if (liveryId === 'aal') {
    ctx.fillStyle = '#cc172c';
    ctx.fillRect(xForS(0.6), yWinTop - 10, W, 11);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(xForS(0.6), yWinTop + 1, W, 8);
    ctx.fillStyle = '#0f3c88';
    ctx.fillRect(xForS(0.6), yWinBot + 2, W, 12);
  } else if (isDelta) {
    ctx.fillStyle = '#0d2248';
    ctx.fillRect(xForS(1.35), yWinTop - 4, W, yWinBot - yWinTop + 10);
    ctx.fillStyle = '#c8102e';
    ctx.fillRect(xForS(1.42), yWinBot + 6, W, 6);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(xForS(1.42), yWinBot + 4, W, 2);
  } else if (liveryId === 'eal') {
    ctx.fillStyle = '#0c2340';
    ctx.fillRect(xForS(1.5), yWinBot - 6, W, 12);
    ctx.fillStyle = '#008fd5';
    ctx.fillRect(xForS(1.5), yWinBot + 7, W, 9);
  } else if (isTwa) {
    ctx.fillStyle = '#c8102e';
    ctx.fillRect(xForS(1.45), yWinTop - 6, W, 10);
    ctx.fillRect(xForS(1.45), yWinBot + 4, W, 8);
  } else if (isNwa) {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(xForS(1.45), yWinTop - 4, W, yWinBot - yWinTop + 8);
    ctx.fillStyle = '#c8102e';
    ctx.fillRect(xForS(1.45), yWinBot + 5, W, 6);
  } else if (isOzk) {
    ctx.fillStyle = '#15803d';
    ctx.fillRect(xForS(1.45), yWinTop - 2, W, yWinBot - yWinTop + 6);
    ctx.fillStyle = '#4ade80';
    ctx.fillRect(xForS(1.45), yWinBot + 5, W, 5);
  } else if (isSas) {
    ctx.fillStyle = '#0f2d5e';
    ctx.fillRect(xForS(2.0), yWinBot + 2, W, 12);
    ctx.fillStyle = '#2563eb';
    ctx.fillRect(xForS(2.0), yWinBot - 6, W, 6);
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(xForS(2.0), yWinBot + 15, W, 4);
  } else if (isAsa) {
    ctx.fillStyle = '#0b2545';
    ctx.fillRect(xForS(1.45), yWinTop - 3, W, yWinBot - yWinTop + 9);
    ctx.fillStyle = '#0d9488';
    ctx.fillRect(xForS(1.45), yWinBot + 7, W, 7);
  } else if (isSwr) {
    ctx.fillStyle = '#451a12';
    ctx.fillRect(xForS(1.45), yWinTop - 4, W, 6);
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(xForS(1.45), yWinBot + 2, W, 10);
  }

  // Radome finish & metallic collar ring at s = 1.48 m
  const xRadomeEnd = xForS(1.48);
  if (cfg.isMd80Series || isDelta || isTwa || isNwa) {
    ctx.fillStyle = '#14181f';
    ctx.fillRect(0, fTopY - 25, xRadomeEnd, fHeight + 50);
    ctx.fillStyle = '#dce3ec';
    ctx.fillRect(xRadomeEnd - 4, fTopY - 25, 5, fHeight + 50);
  } else {
    ctx.fillStyle = 'rgba(30, 41, 59, 0.55)';
    ctx.fillRect(xRadomeEnd - 2, fTopY - 25, 3, fHeight + 50);
  }

  // Anti-glare matte strip directly ahead of windshield
  ctx.fillStyle = '#1a1f28';
  ctx.fillRect(xForS(1.25), fTopY - 12, xForS(1.85) - xForS(1.25), yForRel(0.16) - fTopY + 12);

  // Cabin Windows + L1 Entry Door + Overwing Exits
  const sCabinStart = 6.75;
  const sCabinEnd = totalLength - cfg.engineOffsetZFromTailTip - 2.35;
  const winPitch = 0.53;
  const winW = Math.max(8, (0.24 / totalLength) * W);
  const winH = 14;

  const doorX = xForS(4.9);
  const doorW = Math.max(20, (0.86 / totalLength) * W);
  const doorTopY = yForRel(0.95);
  const doorBotY = yForRel(-0.68);
  ctx.strokeStyle = 'rgba(30, 41, 59, 0.72)';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(doorX, doorTopY, doorW, doorBotY - doorTopY);
  ctx.fillStyle = '#152236';
  ctx.fillRect(doorX + doorW * 0.32, yWinCenter - 6, doorW * 0.36, 13);

  for (let s = sCabinStart; s <= sCabinEnd; s += winPitch) {
    const wx = xForS(s);
    const sWingMid = totalLength * 0.53;
    if (Math.abs(s - sWingMid) < 0.52) {
      ctx.strokeStyle = 'rgba(20, 30, 45, 0.65)';
      ctx.lineWidth = 2;
      ctx.strokeRect(wx - 2, yWinTop - 8, winW + 4, yWinBot - yWinTop + 18);
    }

    ctx.fillStyle = '#aeb8c6';
    ctx.fillRect(wx - 1.5, yWinCenter - winH * 0.5 - 1.5, winW + 3, winH + 3);
    const wGrad = ctx.createLinearGradient(0, yWinCenter - winH * 0.5, 0, yWinCenter + winH * 0.5);
    wGrad.addColorStop(0, '#3a5878');
    wGrad.addColorStop(0.42, '#142030');
    wGrad.addColorStop(1, '#090e17');
    ctx.fillStyle = wGrad;
    ctx.fillRect(wx, yWinCenter - winH * 0.5, winW, winH);
  }

  // Airline Titles Forward Above Window Belt
  const titleX = xForS(6.5);
  const titleY = yWinTop - 16;
  ctx.font = 'bold 28px "Inter", "Arial", sans-serif';
  if (isDelta) {
    ctx.fillStyle = '#0d2248';
    ctx.fillText('DELTA', titleX, titleY);
  } else if (liveryId === 'aal') {
    ctx.fillStyle = '#0f3c88';
    ctx.fillText('American', titleX, titleY);
  } else if (liveryId === 'eal') {
    ctx.fillStyle = '#0c2340';
    ctx.fillText('EASTERN', titleX, titleY);
  } else if (isTwa) {
    ctx.fillStyle = '#c8102e';
    ctx.fillText('TWA', titleX, titleY);
  } else if (isNwa) {
    ctx.fillStyle = '#b91c1c';
    ctx.fillText('NORTHWEST ORIENT', titleX, titleY);
  } else if (isSas) {
    ctx.fillStyle = '#0f2d5e';
    ctx.fillText('SCANDINAVIAN', titleX, titleY);
  } else if (isAsa) {
    ctx.fillStyle = '#0b2545';
    ctx.fillText('Alaska', titleX, titleY);
  } else if (isSwr) {
    ctx.fillStyle = '#b91c1c';
    ctx.fillText('SWISSAIR', titleX, titleY);
  } else if (isOzk) {
    ctx.fillStyle = '#15803d';
    ctx.fillText('OZARK', titleX, titleY);
  }

  ctx.strokeStyle = 'rgba(71, 85, 105, 0.14)';
  ctx.lineWidth = 1;
  for (let s = 4.0; s < totalLength - 3.0; s += 2.2) {
    const px = xForS(s);
    ctx.beginPath();
    ctx.moveTo(px, fTopY);
    ctx.lineTo(px, fBotY);
    ctx.stroke();
  }

  // Vertical Stabilizer Fin Atlas
  const tX0 = 41;
  const tY0 = 553;
  const tW = 900;
  const tH = 430;
  ctx.fillStyle = isBareMetal ? '#d8e0ea' : '#f4f6f9';
  ctx.fillRect(tX0, tY0, tW, tH);

  if (isDelta) {
    ctx.fillStyle = '#0d2248';
    ctx.fillRect(tX0, tY0, tW, tH);
    ctx.fillStyle = '#c8102e';
    ctx.beginPath();
    ctx.moveTo(tX0 + tW * 0.25, tY0 + tH * 0.78);
    ctx.lineTo(tX0 + tW * 0.56, tY0 + tH * 0.16);
    ctx.lineTo(tX0 + tW * 0.84, tY0 + tH * 0.78);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(tX0 + tW * 0.34, tY0 + tH * 0.78);
    ctx.lineTo(tX0 + tW * 0.56, tY0 + tH * 0.32);
    ctx.lineTo(tX0 + tW * 0.76, tY0 + tH * 0.78);
    ctx.closePath();
    ctx.fill();
  } else if (liveryId === 'aal') {
    ctx.fillStyle = '#cc172c';
    ctx.fillRect(tX0, tY0 + tH * 0.28, tW, 44);
    ctx.fillStyle = '#0f3c88';
    ctx.fillRect(tX0, tY0 + tH * 0.42, tW, 44);
    ctx.fillStyle = '#0f3c88';
    ctx.font = 'bold 110px "Inter", "Arial", sans-serif';
    ctx.fillText('AA', tX0 + tW * 0.34, tY0 + tH * 0.8);
  } else if (liveryId === 'eal') {
    ctx.fillStyle = '#0c2340';
    ctx.fillRect(tX0, tY0 + tH * 0.35, tW, 56);
    ctx.fillStyle = '#008fd5';
    ctx.fillRect(tX0, tY0 + tH * 0.52, tW, 56);
  } else if (isTwa) {
    ctx.fillStyle = '#c8102e';
    ctx.fillRect(tX0, tY0, tW, tH);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 125px "Inter", "Arial", sans-serif';
    ctx.fillText('TWA', tX0 + tW * 0.25, tY0 + tH * 0.65);
  } else if (isNwa) {
    ctx.fillStyle = '#c8102e';
    ctx.fillRect(tX0, tY0, tW, tH);
  } else if (isSwr) {
    ctx.fillStyle = '#cc172c';
    ctx.fillRect(tX0, tY0, tW, tH);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(tX0 + tW * 0.43, tY0 + tH * 0.24, tW * 0.14, tH * 0.52);
    ctx.fillRect(tX0 + tW * 0.32, tY0 + tH * 0.42, tW * 0.36, tH * 0.16);
  } else if (isSas) {
    ctx.fillStyle = '#0f2d5e';
    ctx.fillRect(tX0, tY0, tW, tH);
    ctx.fillStyle = '#2563eb';
    ctx.fillRect(tX0, tY0 + tH * 0.65, tW, 38);
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(tX0, tY0 + tH * 0.76, tW, 24);
  } else if (isAsa) {
    ctx.fillStyle = '#0b2545';
    ctx.fillRect(tX0, tY0, tW, tH);
    ctx.fillStyle = '#0d9488';
    ctx.fillRect(tX0, tY0 + tH * 0.72, tW, 45);
  } else if (isOzk) {
    ctx.fillStyle = '#15803d';
    ctx.fillRect(tX0, tY0, tW, tH);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(tX0, tY0 + tH * 0.44, tW, 34);
  }

  // Engine Nacelle Atlas
  const eX0 = 1024;
  const eY0 = 553;
  const eW = 980;
  const eH = 430;
  ctx.fillStyle = isBareMetal ? '#d7dfe9' : '#f2f5f9';
  ctx.fillRect(eX0, eY0, eW, eH);

  ctx.fillStyle = isDelta
    ? '#0d2248'
    : liveryId === 'aal' || isTwa || isNwa || isSwr
      ? '#c8102e'
      : isSas
        ? '#0f2d5e'
        : isAsa
          ? '#0b2545'
          : isOzk
            ? '#15803d'
            : '#008fd5';
  ctx.fillRect(eX0, eY0 + eH * 0.44, eW, 42);
  if (isDelta) {
    ctx.fillStyle = '#c8102e';
    ctx.fillRect(eX0, eY0 + eH * 0.55, eW, 18);
  } else if (liveryId === 'aal') {
    ctx.fillStyle = '#0f3c88';
    ctx.fillRect(eX0, eY0 + eH * 0.56, eW, 34);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(4, maxAniso);
  tex.needsUpdate = true;
  return tex;
}

export async function buildDc9FamilyRig(
  spec: AircraftSpec,
  initialLiveryId: string,
  renderer: THREE.WebGLRenderer,
  variant?: AircraftVariant,
): Promise<LoadedAircraftRig> {
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const cfg = getDc9VariantConfig(spec, variant);

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
  const subPieces: SubPieceEntry[] = [];
  const enginePods: EnginePodEntry[] = [];

  const disposableGeos: THREE.BufferGeometry[] = [];
  const disposableMats: THREE.Material[] = [];
  const loadedTextures: THREE.Texture[] = [];

  const L = cfg.lengthM;
  const zTip = -L * 0.5;
  const yCenter = 2.72; // 0.87 m belly clearance + 1.85 m lower radius

  const liveryTexCache = new Map<string, THREE.CanvasTexture>();
  const getOrCreateLiveryTex = (livId: string) => {
    let t = liveryTexCache.get(livId);
    if (!t) {
      t = createDc9LiveryTexture(livId, L, cfg, maxAniso);
      liveryTexCache.set(livId, t);
      loadedTextures.push(t);
    }
    return t;
  };

  const chosenLivery = spec.liveries.find((l) => l.id === initialLiveryId) ?? spec.liveries[0];
  const initTex = getOrCreateLiveryTex(chosenLivery.id);
  const isBareMetalInit = chosenLivery.id === 'aal' || chosenLivery.id === 'eal';

  const liveryMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: initTex,
    roughness: isBareMetalInit ? 0.24 : 0.34,
    metalness: isBareMetalInit ? 0.72 : 0.22,
    envMapIntensity: isBareMetalInit ? 1.35 : 1.05,
  });
  const wingSkinMat = new THREE.MeshStandardMaterial({
    color: 0xd8dfe8,
    roughness: 0.42,
    metalness: 0.28,
    envMapIntensity: 1.0,
  });
  const controlSurfaceMat = new THREE.MeshStandardMaterial({
    color: 0xcbd4e0,
    roughness: 0.46,
    metalness: 0.3,
  });
  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.16,
    metalness: 0.92,
    side: THREE.DoubleSide,
    envMapIntensity: 1.35,
  });
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x202630,
    roughness: 0.55,
    metalness: 0.45,
  });
  const cockpitGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0x162638,
    roughness: 0.06,
    metalness: 0.18,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.85,
  });
  const exhaustDarkMat = new THREE.MeshStandardMaterial({
    color: 0x1a1e24,
    roughness: 0.72,
    metalness: 0.45,
    side: THREE.DoubleSide,
  });
  const tireMat = new THREE.MeshStandardMaterial({color: 0x181b20, roughness: 0.88, metalness: 0.08});
  const rimMat = new THREE.MeshStandardMaterial({color: 0xd0d7e2, roughness: 0.3, metalness: 0.85});
  const strutMat = new THREE.MeshStandardMaterial({color: 0xbac3cf, roughness: 0.35, metalness: 0.82});
  const bladeMat = new THREE.MeshStandardMaterial({color: 0x626c7a, roughness: 0.32, metalness: 0.86});

  disposableMats.push(
    liveryMat,
    wingSkinMat,
    controlSurfaceMat,
    chromeMat,
    frameMat,
    cockpitGlassMat,
    exhaustDarkMat,
    tireMat,
    rimMat,
    strutMat,
    bladeMat,
  );

  // 1. Unified Smooth Blueprint-Accurate Nose, Cabin, & Tailcone Fuselage Loft
  const {noseMesh, fwdMesh, centerMesh, aftMidMesh, aftMesh} = buildUnifiedFuselageSections(
    cfg,
    yCenter,
    liveryMat,
    disposableGeos,
  );

  noseGroup.add(noseMesh);
  cockpitHiddenMeshes.push(noseMesh);

  const fuseFwdGroup = new THREE.Group();
  fuseFwdGroup.add(fwdMesh);
  fuselageGroup.add(fuseFwdGroup);
  subPieces.push({
    key: 'fuse_fwd',
    group: fuseFwdGroup,
    zone: 'fuselage',
    label: 'Forward Cabin Section',
    fractureThreshold: 0.56,
  });

  fuselageGroup.add(centerMesh);

  const fuseAftMidGroup = new THREE.Group();
  fuseAftMidGroup.add(aftMidMesh);
  fuselageGroup.add(fuseAftMidGroup);
  subPieces.push({
    key: 'fuse_aftmid',
    group: fuseAftMidGroup,
    zone: 'fuselage',
    label: 'Mid-Aft Cabin Section',
    fractureThreshold: 0.58,
  });

  aftFuselageGroup.add(aftMesh);

  // 2. Sculpted 6-Pane Flight Deck Windshield, Eyebrow Windows, Mullions, Wipers, Pitots & Strakes
  const cockpitExteriorGroup = new THREE.Group();
  noseGroup.add(cockpitExteriorGroup);
  cockpitHiddenMeshes.push(cockpitExteriorGroup);

  const {rightFacets, eyebrowRight} = buildCockpitFacets(L, yCenter, cfg);

  const buildMirroredPaneAndFrame = (facet: WindshieldFacet, inset: number, frameRadius: number, idx: number) => {
    for (const side of [-1, 1] as const) {
      const p0 = facet.p0.clone();
      const p1 = facet.p1.clone();
      const p2 = facet.p2.clone();
      const p3 = facet.p3.clone();
      const n = facet.normal.clone();
      if (side === -1) {
        p0.x = -p0.x;
        p1.x = -p1.x;
        p2.x = -p2.x;
        p3.x = -p3.x;
        n.x = -n.x;
      }

      const glass = createQuadMesh(p0, p1, p2, p3, cockpitGlassMat, disposableGeos, `DC9_Glass_${idx}_${side}`, inset, n);
      cockpitExteriorGroup.add(glass);

      const frameOff = n.clone().multiplyScalar(inset + 0.008);
      const q0 = p0.clone().add(frameOff);
      const q1 = p1.clone().add(frameOff);
      const q2 = p2.clone().add(frameOff);
      const q3 = p3.clone().add(frameOff);
      addFrameStrut(cockpitExteriorGroup, q0, q1, frameRadius, frameMat, disposableGeos);
      addFrameStrut(cockpitExteriorGroup, q1, q2, frameRadius, frameMat, disposableGeos);
      addFrameStrut(cockpitExteriorGroup, q2, q3, frameRadius, frameMat, disposableGeos);
      addFrameStrut(cockpitExteriorGroup, q3, q0, frameRadius, frameMat, disposableGeos);
    }
  };

  rightFacets.forEach((f, idx) => buildMirroredPaneAndFrame(f, -0.004, 0.022, idx));
  buildMirroredPaneAndFrame(eyebrowRight, -0.003, 0.016, 9);

  // Center V-Windshield Mullion Post joining left & right front windshields cleanly
  const f0 = rightFacets[0].p0;
  const f3 = rightFacets[0].p3;
  const centerBridgeStart = new THREE.Vector3(0, f0.y, f0.z);
  const centerBridgeEnd = new THREE.Vector3(0, f3.y, f3.z);
  addFrameStrut(cockpitExteriorGroup, centerBridgeStart, centerBridgeEnd, 0.042, frameMat, disposableGeos);

  // Twin Windshield Wipers resting flush along the lower front windshield panes
  const frontFacet = rightFacets[0];
  for (const side of [-1, 1] as const) {
    const wStart = new THREE.Vector3().lerpVectors(frontFacet.p0, frontFacet.p1, 0.34);
    const wEnd = new THREE.Vector3().lerpVectors(frontFacet.p3, frontFacet.p2, 0.28);
    wStart.x *= side;
    wEnd.x *= side;
    const nW = frontFacet.normal.clone();
    nW.x *= side;
    const wMid = new THREE.Vector3().lerpVectors(wStart, wEnd, 0.5).addScaledVector(nW, 0.012);
    const wEndLift = new THREE.Vector3().lerpVectors(wStart, wEnd, 0.92).addScaledVector(nW, 0.012);
    addFrameStrut(cockpitExteriorGroup, wMid, wEndLift, 0.011, frameMat, disposableGeos);
  }

  // Forward Pitot Tubes & AoA Vanes mounted directly onto evaluated nose cheek skin
  for (const side of [-1, 1] as const) {
    const pUp = sampleBaseHullPoint(evaluateDc9Section(1.24, L, cfg), THREE.MathUtils.degToRad(side * 96), yCenter);
    const pitotGeo = new THREE.CylinderGeometry(0.008, 0.012, 0.24, 6);
    pitotGeo.rotateX(Math.PI / 2);
    disposableGeos.push(pitotGeo);
    const pitot = new THREE.Mesh(pitotGeo, chromeMat);
    pitot.position.set(pUp.x + side * 0.03, pUp.y, pUp.z);
    noseGroup.add(pitot);

    const pLo = sampleBaseHullPoint(evaluateDc9Section(1.48, L, cfg), THREE.MathUtils.degToRad(side * 112), yCenter);
    const pitotLower = new THREE.Mesh(pitotGeo, chromeMat);
    pitotLower.position.set(pLo.x + side * 0.03, pLo.y, pLo.z);
    noseGroup.add(pitotLower);
  }

  // Aerodynamic Nose Chine Strakes (signature on DC-9-50 & all MD-80 / MD-90 airframes)
  if (cfg.hasNoseStrakes) {
    const strakeShape = new THREE.Shape();
    strakeShape.moveTo(0, 0);
    strakeShape.lineTo(0.88, 0);
    strakeShape.lineTo(0.8, 0.11);
    strakeShape.lineTo(0.12, 0.07);
    strakeShape.closePath();

    const strakeGeo = new THREE.ExtrudeGeometry(strakeShape, {depth: 0.024, bevelEnabled: false});
    strakeGeo.translate(0, 0, -0.012);
    strakeGeo.rotateY(-Math.PI / 2);
    strakeGeo.rotateZ(Math.PI / 2);
    strakeGeo.computeVertexNormals();
    disposableGeos.push(strakeGeo);

    for (const side of [-1, 1] as const) {
      const pStrake = sampleBaseHullPoint(
        evaluateDc9Section(1.42, L, cfg),
        THREE.MathUtils.degToRad(side * 104),
        yCenter,
      );
      const strake = new THREE.Mesh(strakeGeo, frameMat);
      strake.position.set(pStrake.x - side * 0.015, pStrake.y, pStrake.z);
      strake.rotation.z = side * THREE.MathUtils.degToRad(-12);
      strake.rotation.y = side * THREE.MathUtils.degToRad(14);
      strake.castShadow = true;
      noseGroup.add(strake);
    }
  }

  // APU Exhaust Shroud at extreme Tailcone Tip
  const apuGeo = new THREE.CylinderGeometry(0.13, 0.16, 0.42, 12);
  apuGeo.rotateX(Math.PI / 2);
  disposableGeos.push(apuGeo);
  const apuPipe = new THREE.Mesh(apuGeo, exhaustDarkMat);
  apuPipe.position.set(0, yCenter + (cfg.hasBeaverTailcone ? 0.7 : 0.65), zTip + L - 0.12);
  aftFuselageGroup.add(apuPipe);

  // 3. Swept Low-Wing Assembly + Karman Belly Fairing + Slats + Flaps + Ailerons + Spoilers
  const halfSpan = cfg.wingspanM * 0.5;
  const wingSweepRad = THREE.MathUtils.degToRad(24.0);
  const dihedralRad = THREE.MathUtils.degToRad(3.0);
  const zWingQuarterRoot = L * 0.02;
  const rootY = 1.66;

  const xRoot = 1.52;
  const xKink = cfg.isMd80Series ? 4.85 : 4.25;
  const xTip = halfSpan;
  const rootChord = cfg.isMd80Series ? 5.95 : 5.05;
  const kinkChord = cfg.isMd80Series ? 4.15 : 3.55;
  const tipChord = cfg.isMd80Series ? 1.38 : 1.15;

  const wingZAtX = (ax: number) => {
    const qcZ = zWingQuarterRoot + (ax - xRoot) * Math.tan(wingSweepRad);
    let chord = rootChord;
    if (ax <= xKink) {
      chord = THREE.MathUtils.lerp(rootChord, kinkChord, (ax - xRoot) / Math.max(0.1, xKink - xRoot));
    } else {
      chord = THREE.MathUtils.lerp(kinkChord, tipChord, (ax - xKink) / Math.max(0.1, xTip - xKink));
    }
    const rootPlug = cfg.hasWingRootPlug ? Math.max(0, 1 - (ax - xRoot) / 3.4) * 0.48 : 0;
    const zLE = qcZ - 0.25 * chord - rootPlug;
    const y = rootY + (ax - xRoot) * Math.tan(dihedralRad);
    return {zLE, chord: chord + rootPlug, y};
  };

  const fairingGeo = new THREE.BoxGeometry(3.46, 0.85, rootChord * 1.15);
  disposableGeos.push(fairingGeo);
  const fairing = new THREE.Mesh(fairingGeo, wingSkinMat);
  const rootSpec = wingZAtX(xRoot);
  fairing.position.set(0, 1.38, rootSpec.zLE + rootSpec.chord * 0.5);
  fuselageGroup.add(fairing);

  const wingRootX = Math.max(1.5, cfg.wingspanM * 0.13);
  const wingSpanAvail = Math.max(2, halfSpan - wingRootX);
  const xSeg1 = wingRootX + wingSpanAvail * 0.34;
  const xSeg2 = wingRootX + wingSpanAvail * 0.68;

  for (const side of [-1, 1] as const) {
    const wingParent = side === -1 ? leftWingGroup : rightWingGroup;
    const prefix = side === -1 ? 'leftWing' : 'rightWing';
    const zone = side === -1 ? 'leftWing' : 'rightWing';
    const labelBase = side === -1 ? 'Port' : 'Starboard';

    const s0Group = new THREE.Group();
    const s1Group = new THREE.Group();
    const s2Group = new THREE.Group();
    wingParent.add(s0Group, s1Group, s2Group);

    subPieces.push(
      {key: `${prefix}_s0`, group: s0Group, zone, label: `${labelBase} Inboard Wing`, fractureThreshold: 0.65},
      {key: `${prefix}_s1`, group: s1Group, zone, label: `${labelBase} Outer Wing`, fractureThreshold: 0.48},
      {key: `${prefix}_s2`, group: s2Group, zone, label: `${labelBase} Wingtip`, fractureThreshold: 0.34},
    );

    const buildWingSeg = (target: THREE.Group, xA: number, xB: number, segName: string) => {
      const steps = 4;
      const stations = [];
      for (let i = 0; i <= steps; i++) {
        const ax = THREE.MathUtils.lerp(xA, xB, i / steps);
        const w = wingZAtX(ax);
        const thRatio = THREE.MathUtils.lerp(0.125, 0.092, (ax - xRoot) / Math.max(1, xTip - xRoot));
        stations.push({
          x: side * ax,
          y: w.y,
          zLE: w.zLE,
          chord: w.chord,
          thicknessRatio: thRatio,
          camber: 0.018,
        });
      }
      target.add(createAirfoilSpanMesh(stations, false, wingSkinMat, [0.05, 0.05, 0.4, 0.4], disposableGeos, segName));
    };

    buildWingSeg(s0Group, xRoot, xSeg1, `${prefix}_Wing_S0`);
    buildWingSeg(s1Group, xSeg1, xSeg2, `${prefix}_Wing_S1`);
    buildWingSeg(s2Group, xSeg2, xTip, `${prefix}_Wing_S2`);

    for (const trackFrac of [0.22, 0.42, 0.6]) {
      const tx = THREE.MathUtils.lerp(xRoot, xTip, trackFrac);
      const tw = wingZAtX(tx);
      const canoeGeo = new THREE.ConeGeometry(0.11, tw.chord * 0.48, 8);
      canoeGeo.rotateX(Math.PI / 2);
      disposableGeos.push(canoeGeo);
      const canoe = new THREE.Mesh(canoeGeo, wingSkinMat);
      canoe.position.set(side * tx, tw.y - 0.14, tw.zLE + tw.chord * 0.85);
      (tx < xSeg1 ? s0Group : tx < xSeg2 ? s1Group : s2Group).add(canoe);
    }

    const wIn0 = wingZAtX(xRoot + 0.18);
    const wIn1 = wingZAtX(xSeg1 - 0.12);
    const wMid0 = wingZAtX(xSeg1 + 0.1);
    const wMid1 = wingZAtX(xSeg2 - 0.15);
    const wOut0 = wingZAtX(xSeg2 + 0.12);
    const wOut1 = wingZAtX(xTip - 0.55);

    addControlSurfacePanel(
      s0Group,
      'flap',
      side,
      new THREE.Vector3(side * (xRoot + 0.18), wIn0.y - 0.02, wIn0.zLE + wIn0.chord * 0.78),
      new THREE.Vector3(side * (xSeg1 - 0.12), wIn1.y - 0.02, wIn1.zLE + wIn1.chord * 0.78),
      wIn0.chord * 0.25,
      wIn1.chord * 0.25,
      0.09,
      false,
      false,
      controlSurfaceMat,
      disposableGeos,
      controlSurfaces,
      `${prefix}_FlapIn`,
    );

    addControlSurfacePanel(
      s1Group,
      'flap',
      side,
      new THREE.Vector3(side * (xSeg1 + 0.1), wMid0.y - 0.02, wMid0.zLE + wMid0.chord * 0.78),
      new THREE.Vector3(side * (xSeg2 - 0.15), wMid1.y - 0.02, wMid1.zLE + wMid1.chord * 0.78),
      wMid0.chord * 0.24,
      wMid1.chord * 0.24,
      0.09,
      false,
      false,
      controlSurfaceMat,
      disposableGeos,
      controlSurfaces,
      `${prefix}_FlapOut`,
    );

    addControlSurfacePanel(
      s0Group,
      'spoiler',
      side,
      new THREE.Vector3(side * (xRoot + 0.35), wIn0.y + wIn0.chord * 0.06, wIn0.zLE + wIn0.chord * 0.62),
      new THREE.Vector3(side * (xSeg1 - 0.2), wIn1.y + wIn1.chord * 0.06, wIn1.zLE + wIn1.chord * 0.62),
      wIn0.chord * 0.14,
      wIn1.chord * 0.14,
      0.04,
      false,
      false,
      controlSurfaceMat,
      disposableGeos,
      controlSurfaces,
      `${prefix}_SpoilerIn`,
    );

    addControlSurfacePanel(
      s1Group,
      'spoiler',
      side,
      new THREE.Vector3(side * (xSeg1 + 0.2), wMid0.y + wMid0.chord * 0.06, wMid0.zLE + wMid0.chord * 0.62),
      new THREE.Vector3(side * (xSeg2 - 0.25), wMid1.y + wMid1.chord * 0.06, wMid1.zLE + wMid1.chord * 0.62),
      wMid0.chord * 0.14,
      wMid1.chord * 0.14,
      0.04,
      false,
      false,
      controlSurfaceMat,
      disposableGeos,
      controlSurfaces,
      `${prefix}_SpoilerOut`,
    );

    addControlSurfacePanel(
      s2Group,
      'aileron',
      side,
      new THREE.Vector3(side * (xSeg2 + 0.12), wOut0.y, wOut0.zLE + wOut0.chord * 0.79),
      new THREE.Vector3(side * (xTip - 0.55), wOut1.y, wOut1.zLE + wOut1.chord * 0.79),
      wOut0.chord * 0.23,
      wOut1.chord * 0.23,
      0.09,
      false,
      false,
      controlSurfaceMat,
      disposableGeos,
      controlSurfaces,
      `${prefix}_Aileron`,
    );

    if (cfg.hasSlats) {
      addControlSurfacePanel(
        s1Group,
        'slat',
        side,
        new THREE.Vector3(side * (xSeg1 + 0.05), wMid0.y, wMid0.zLE + wMid0.chord * 0.08),
        new THREE.Vector3(side * (xSeg2 - 0.05), wMid1.y, wMid1.zLE + wMid1.chord * 0.08),
        wMid0.chord * 0.12,
        wMid1.chord * 0.12,
        0.14,
        false,
        true,
        chromeMat,
        disposableGeos,
        controlSurfaces,
        `${prefix}_SlatMid`,
      );
      addControlSurfacePanel(
        s2Group,
        'slat',
        side,
        new THREE.Vector3(side * (xSeg2 + 0.05), wOut0.y, wOut0.zLE + wOut0.chord * 0.08),
        new THREE.Vector3(side * (xTip - 0.45), wOut1.y, wOut1.zLE + wOut1.chord * 0.08),
        wOut0.chord * 0.12,
        wOut1.chord * 0.12,
        0.14,
        false,
        true,
        chromeMat,
        disposableGeos,
        controlSurfaces,
        `${prefix}_SlatOut`,
      );
    }
  }

  // 4. Swept T-Tail Vertical Stabilizer, Dorsal Fillet, Bullet Fairing, Rudder & Horizontal Stabilizers + Elevators
  const vBaseY = yCenter + 1.35;
  const vTopY = cfg.heightM - 0.32;
  const vBaseZLE = zTip + L - (cfg.hasBeaverTailcone ? 9.1 : 7.8);
  const vTopZLE = vBaseZLE + (vTopY - vBaseY) * Math.tan(THREE.MathUtils.degToRad(39));
  const vBaseChord = cfg.isMd80Series ? 4.45 : 3.95;
  const vTopChord = cfg.isMd80Series ? 2.85 : 2.55;

  const vStations = [
    {x: 0, y: vBaseY, zLE: vBaseZLE, chord: vBaseChord, thicknessRatio: 0.1, camber: 0},
    {x: 0, y: vTopY, zLE: vTopZLE, chord: vTopChord, thicknessRatio: 0.095, camber: 0},
  ];
  tailGroup.add(
    createAirfoilSpanMesh(vStations, true, liveryMat, [0.02, 0.04, 0.46, 0.46], disposableGeos, 'DC9_VerticalFin'),
  );

  const dorsalShape = new THREE.Shape();
  dorsalShape.moveTo(0, 0);
  dorsalShape.lineTo(3.6, 0);
  dorsalShape.lineTo(3.6, 1.15);
  dorsalShape.lineTo(0.25, 0.04);
  dorsalShape.closePath();
  const dorsalGeo = new THREE.ExtrudeGeometry(dorsalShape, {depth: 0.16, bevelEnabled: false});
  dorsalGeo.translate(0, 0, -0.08);
  dorsalGeo.rotateY(-Math.PI / 2);
  dorsalGeo.computeVertexNormals();
  disposableGeos.push(dorsalGeo);
  const dorsalFin = new THREE.Mesh(dorsalGeo, liveryMat);
  dorsalFin.position.set(0, yCenter + 1.36, vBaseZLE - 3.3);
  dorsalFin.castShadow = true;
  tailGroup.add(dorsalFin);

  const bulletGeo = new THREE.ConeGeometry(0.32, 3.6, 14);
  bulletGeo.rotateX(Math.PI / 2);
  disposableGeos.push(bulletGeo);
  const bullet = new THREE.Mesh(bulletGeo, wingSkinMat);
  bullet.position.set(0, vTopY + 0.02, vTopZLE + vTopChord * 0.48);
  bullet.scale.set(0.85, 0.85, 1.15);
  tailGroup.add(bullet);

  addControlSurfacePanel(
    tailGroup,
    'rudder',
    0,
    new THREE.Vector3(0, vBaseY + 0.22, vBaseZLE + vBaseChord * 0.78),
    new THREE.Vector3(0, vTopY - 0.12, vTopZLE + vTopChord * 0.78),
    vBaseChord * 0.25,
    vTopChord * 0.25,
    0.09,
    true,
    false,
    controlSurfaceMat,
    disposableGeos,
    controlSurfaces,
    'DC9_Rudder',
  );

  const hHalfSpan = cfg.isMd80Series ? 6.12 : 5.64;
  const hSweepRad = THREE.MathUtils.degToRad(31.5);
  const hAnhedralRad = THREE.MathUtils.degToRad(-2.5);
  const hRootChord = cfg.isMd80Series ? 2.75 : 2.45;
  const hTipChord = cfg.isMd80Series ? 1.15 : 1.02;
  const hRootZLE = vTopZLE + 0.18;

  for (const side of [-1, 1] as const) {
    const hGroup = side === -1 ? leftHStabGroup : rightHStabGroup;
    const hTipZLE = hRootZLE + hHalfSpan * Math.tan(hSweepRad);
    const hTipY = vTopY + hHalfSpan * Math.tan(hAnhedralRad);
    hGroup.add(
      createAirfoilSpanMesh(
        [
          {x: side * 0.18, y: vTopY, zLE: hRootZLE, chord: hRootChord, thicknessRatio: 0.095, camber: -0.008},
          {x: side * hHalfSpan, y: hTipY, zLE: hTipZLE, chord: hTipChord, thicknessRatio: 0.085, camber: -0.008},
        ],
        false,
        wingSkinMat,
        [0.05, 0.05, 0.4, 0.4],
        disposableGeos,
        `DC9_HStab_${side}`,
      ),
    );

    addControlSurfacePanel(
      hGroup,
      'elevator',
      side,
      new THREE.Vector3(side * 0.35, vTopY, hRootZLE + hRootChord * 0.76),
      new THREE.Vector3(side * (hHalfSpan - 0.22), hTipY, hTipZLE + hTipChord * 0.76),
      hRootChord * 0.26,
      hTipChord * 0.26,
      0.085,
      false,
      false,
      controlSurfaceMat,
      disposableGeos,
      controlSurfaces,
      `DC9_Elevator_${side}`,
    );
  }

  // 5. Rear Fuselage-Mounted JT8D / JT8D-217 / IAE V2500 Engine Pods + Pylons + Spinning Fans
  const engZ = zTip + L - cfg.engineOffsetZFromTailTip;
  const engY = yCenter + 0.46;
  const engX = 1.65 + cfg.engineRadiusM * 1.18;

  for (const side of [-1, 1] as const) {
    const podGroup = new THREE.Group();
    enginesGroup.add(podGroup);
    enginePods.push({
      group: podGroup,
      label: side === -1 ? 'Engine #1 (Port Rear)' : 'Engine #2 (Starboard Rear)',
    });

    const r = cfg.engineRadiusM;
    const eLen = cfg.engineLengthM;
    const cx = side * engX;

    const pylonW = Math.max(0.45, Math.abs(cx) - 1.25);
    const pylonGeo = new THREE.BoxGeometry(pylonW, 0.26, eLen * 0.56);
    disposableGeos.push(pylonGeo);
    const pylon = new THREE.Mesh(pylonGeo, wingSkinMat);
    pylon.position.set(side * (1.25 + pylonW * 0.5), engY - 0.04, engZ + eLen * 0.06);
    pylon.rotation.z = side * THREE.MathUtils.degToRad(5);
    pylon.castShadow = true;
    podGroup.add(pylon);

    const pts = cfg.isMd90
      ? [
          new THREE.Vector2(r * 0.78, -eLen * 0.48),
          new THREE.Vector2(r * 0.96, -eLen * 0.34),
          new THREE.Vector2(r, -eLen * 0.05),
          new THREE.Vector2(r * 0.95, eLen * 0.26),
          new THREE.Vector2(r * 0.78, eLen * 0.44),
        ]
      : [
          new THREE.Vector2(r * 0.76, -eLen * 0.5),
          new THREE.Vector2(r * 0.95, -eLen * 0.38),
          new THREE.Vector2(r, -eLen * 0.1),
          new THREE.Vector2(r * 0.96, eLen * 0.28),
          new THREE.Vector2(r * 0.84, eLen * 0.48),
        ];
    const cowlGeo = new THREE.LatheGeometry(pts, 28);
    cowlGeo.rotateX(Math.PI / 2);
    cowlGeo.computeVertexNormals();

    const pAttr = cowlGeo.attributes.position as THREE.BufferAttribute;
    const uAttr = cowlGeo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pAttr.count; i++) {
      const vx = pAttr.getX(i);
      const vy = pAttr.getY(i);
      const vz = pAttr.getZ(i);
      const tZ = THREE.MathUtils.clamp((vz + eLen * 0.5) / eLen, 0, 1);
      const vr = Math.max(0.01, Math.hypot(vx, vy));
      const yN = THREE.MathUtils.clamp((vy / vr + 1) * 0.5, 0, 1);
      uAttr.setXY(i, 0.5 + tZ * 0.47, 0.04 + yN * 0.42);
    }
    uAttr.needsUpdate = true;
    disposableGeos.push(cowlGeo);

    const cowl = new THREE.Mesh(cowlGeo, liveryMat);
    cowl.position.set(cx, engY, engZ);
    cowl.rotation.x = THREE.MathUtils.degToRad(2.2);
    cowl.castShadow = true;
    cowl.receiveShadow = true;
    podGroup.add(cowl);

    const lipGeo = new THREE.TorusGeometry(r * 0.79, r * 0.09, 10, 26);
    disposableGeos.push(lipGeo);
    const lip = new THREE.Mesh(lipGeo, chromeMat);
    lip.position.set(cx, engY + 0.04, engZ - eLen * 0.47);
    podGroup.add(lip);

    const throatGeo = new THREE.CylinderGeometry(r * 0.74, r * 0.72, eLen * 0.34, 20);
    throatGeo.rotateX(Math.PI / 2);
    disposableGeos.push(throatGeo);
    const throat = new THREE.Mesh(throatGeo, exhaustDarkMat);
    throat.position.set(cx, engY, engZ - eLen * 0.28);
    podGroup.add(throat);

    const nozzleGeo = new THREE.ConeGeometry(r * (cfg.isMd90 ? 0.52 : 0.68), eLen * 0.32, 18);
    nozzleGeo.rotateX(Math.PI / 2);
    disposableGeos.push(nozzleGeo);
    const nozzle = new THREE.Mesh(nozzleGeo, exhaustDarkMat);
    nozzle.position.set(cx, engY - 0.02, engZ + eLen * 0.49);
    podGroup.add(nozzle);

    const fanPivot = new THREE.Group();
    fanPivot.position.set(cx, engY + 0.02, engZ - eLen * 0.34);
    const hubGeo = new THREE.ConeGeometry(r * 0.22, r * 0.32, 12);
    hubGeo.rotateX(-Math.PI / 2);
    const bGeo = new THREE.BoxGeometry(r * 0.08, r * 0.5, 0.025);
    disposableGeos.push(hubGeo, bGeo);
    const hub = new THREE.Mesh(hubGeo, rimMat);
    hub.position.z = -r * 0.1;
    fanPivot.add(hub);
    for (let b = 0; b < 16; b++) {
      const blade = new THREE.Mesh(bGeo, bladeMat);
      const ang = (b / 16) * Math.PI * 2;
      blade.position.set(Math.sin(ang) * r * 0.42, Math.cos(ang) * r * 0.42, 0);
      blade.rotation.z = -ang;
      blade.rotation.y = 0.3;
      fanPivot.add(blade);
    }
    podGroup.add(fanPivot);
    fanMeshes.push(fanPivot);
  }

  // 6. Retractable Dual-Wheel Nose & Main Landing Gear + Open/Closed Gear Doors
  const zNoseGear = zTip + 2.38;
  const zMainGear = zNoseGear + cfg.gearWheelbaseM;
  const mainTrackHalf = cfg.gearTrackM * 0.5;

  const noseTireRad = 0.33;
  const nosePivotY = 1.25;
  noseGearGroup.position.set(0, nosePivotY, zNoseGear);

  const nStrutLen = nosePivotY - noseTireRad;
  const nStrutGeo = new THREE.CylinderGeometry(0.085, 0.075, nStrutLen, 12);
  const nBraceGeo = new THREE.CylinderGeometry(0.04, 0.04, nStrutLen * 0.85, 8);
  const nAxleGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.42, 10);
  nAxleGeo.rotateZ(Math.PI / 2);
  const nTireGeo = new THREE.CylinderGeometry(noseTireRad, noseTireRad, 0.16, 18);
  nTireGeo.rotateZ(Math.PI / 2);
  const nRimGeo = new THREE.CylinderGeometry(noseTireRad * 0.56, noseTireRad * 0.56, 0.17, 14);
  nRimGeo.rotateZ(Math.PI / 2);
  disposableGeos.push(nStrutGeo, nBraceGeo, nAxleGeo, nTireGeo, nRimGeo);

  const nStrut = new THREE.Mesh(nStrutGeo, strutMat);
  nStrut.position.set(0, -nStrutLen * 0.5, 0);
  nStrut.castShadow = true;
  const nBrace = new THREE.Mesh(nBraceGeo, strutMat);
  nBrace.position.set(0, -nStrutLen * 0.45, -0.24);
  nBrace.rotation.x = -0.45;
  const nAxle = new THREE.Mesh(nAxleGeo, strutMat);
  nAxle.position.set(0, -nStrutLen, 0);
  noseGearGroup.add(nStrut, nBrace, nAxle);
  gearMeshes.push(nStrut, nBrace, nAxle);

  for (const sSide of [-1, 1] as const) {
    const wGroup = new THREE.Group();
    wGroup.position.set(sSide * 0.16, -nStrutLen, 0);
    const tire = new THREE.Mesh(nTireGeo, tireMat);
    tire.castShadow = true;
    const rim = new THREE.Mesh(nRimGeo, rimMat);
    wGroup.add(tire, rim);
    noseGearGroup.add(wGroup);
    wheelMeshes.push(wGroup);
    gearMeshes.push(wGroup);
  }

  const mainTireRad = 0.5;
  const mainPivotY = 1.65;
  const mStrutLen = mainPivotY - mainTireRad;
  const mStrutGeo = new THREE.CylinderGeometry(0.11, 0.095, mStrutLen, 12);
  const mAxleGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.62, 10);
  mAxleGeo.rotateZ(Math.PI / 2);
  const mTireGeo = new THREE.CylinderGeometry(mainTireRad, mainTireRad, 0.25, 20);
  mTireGeo.rotateZ(Math.PI / 2);
  const mRimGeo = new THREE.CylinderGeometry(mainTireRad * 0.56, mainTireRad * 0.56, 0.26, 14);
  mRimGeo.rotateZ(Math.PI / 2);
  disposableGeos.push(mStrutGeo, mAxleGeo, mTireGeo, mRimGeo);

  for (const side of [-1, 1] as const) {
    const gGroup = side === -1 ? leftGearGroup : rightGearGroup;
    gGroup.position.set(side * mainTrackHalf, mainPivotY, zMainGear);

    const mStrut = new THREE.Mesh(mStrutGeo, strutMat);
    mStrut.position.set(0, -mStrutLen * 0.5, 0);
    mStrut.castShadow = true;
    const mAxle = new THREE.Mesh(mAxleGeo, strutMat);
    mAxle.position.set(0, -mStrutLen, 0);
    gGroup.add(mStrut, mAxle);
    gearMeshes.push(mStrut, mAxle);

    for (const wSide of [-1, 1] as const) {
      const wGroup = new THREE.Group();
      wGroup.position.set(wSide * 0.22, -mStrutLen, 0);
      const tire = new THREE.Mesh(mTireGeo, tireMat);
      tire.castShadow = true;
      const rim = new THREE.Mesh(mRimGeo, rimMat);
      wGroup.add(tire, rim);
      gGroup.add(wGroup);
      wheelMeshes.push(wGroup);
      gearMeshes.push(wGroup);
    }

    const doorGeo = new THREE.BoxGeometry(0.06, 0.62, 1.35);
    disposableGeos.push(doorGeo);
    const openDoor = new THREE.Mesh(doorGeo, wingSkinMat);
    openDoor.position.set(side * (mainTrackHalf + 0.35), 1.18, zMainGear);
    fuselageGroup.add(openDoor);
    openGearDoorMeshes.push(openDoor);

    const closedDoorGeo = new THREE.BoxGeometry(0.95, 0.05, 1.35);
    disposableGeos.push(closedDoorGeo);
    const closedDoor = new THREE.Mesh(closedDoorGeo, wingSkinMat);
    closedDoor.position.set(side * (mainTrackHalf * 0.55), 1.34, zMainGear);
    closedDoor.visible = false;
    fuselageGroup.add(closedDoor);
    closedGearDoorMeshes.push(closedDoor);
  }

  const nDoorGeo = new THREE.BoxGeometry(0.05, 0.44, 1.15);
  disposableGeos.push(nDoorGeo);
  for (const side of [-1, 1] as const) {
    const nOpenDoor = new THREE.Mesh(nDoorGeo, wingSkinMat);
    nOpenDoor.position.set(side * 0.36, 0.94, zNoseGear + 0.25);
    noseGroup.add(nOpenDoor);
    openGearDoorMeshes.push(nOpenDoor);
  }

  const gearContactPoints = {
    nose: new THREE.Vector3(0, 0, zNoseGear),
    left: new THREE.Vector3(-mainTrackHalf, 0, zMainGear),
    right: new THREE.Vector3(mainTrackHalf, 0, zMainGear),
  };

  const engineCenters: THREE.Vector3[] = [
    new THREE.Vector3(-engX, engY, engZ),
    new THREE.Vector3(engX, engY, engZ),
  ];

  // 7. Interactive 3D Cockpit Rig
  const cockpitRig = createCockpitRig(spec);
  cockpitRig.group.position.set(
    spec.flight.cockpitOffset[0],
    spec.flight.cockpitOffset[1],
    spec.flight.cockpitOffset[2],
  );
  cockpitRig.group.visible = false;
  airframeGroup.add(cockpitRig.group);

  // 8. Navigation Strobes, Anti-Collision Beacon & Landing Light
  const strobeMat = new THREE.MeshBasicMaterial({color: 0xffffff});
  const beaconMat = new THREE.MeshBasicMaterial({color: 0xff2222});
  disposableMats.push(strobeMat, beaconMat);

  const sGeo = new THREE.SphereGeometry(0.11, 6, 6);
  disposableGeos.push(sGeo);
  const tipWing = wingZAtX(xTip - 0.15);

  const strobeL = new THREE.Mesh(sGeo, strobeMat);
  strobeL.position.set(-(xTip - 0.15), tipWing.y, tipWing.zLE + tipWing.chord * 0.45);
  const strobeR = new THREE.Mesh(sGeo, strobeMat);
  strobeR.position.set(xTip - 0.15, tipWing.y, tipWing.zLE + tipWing.chord * 0.45);
  const beaconTop = new THREE.Mesh(sGeo, beaconMat);
  beaconTop.position.set(0, yCenter + 1.82, -L * 0.08);
  airframeGroup.add(strobeL, strobeR, beaconTop);

  const landingLightBeam = new THREE.SpotLight(0xfff4dc, 0, 260, Math.PI / 7, 0.55, 1.1);
  landingLightBeam.position.set(0, 1.1, zNoseGear - 0.35);
  const lightTarget = new THREE.Object3D();
  lightTarget.position.set(0, -1.5, zNoseGear - 85);
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
    liveryMaterials: [liveryMat],
    groundClearanceY: 0,
    setLiveryTexture: async (textureUrl: string) => {
      const livId = textureUrl.split('/').pop()?.replace(/^livery_|\.png$/g, '') ?? chosenLivery.id;
      const nextTex = getOrCreateLiveryTex(livId);
      const isMetal = livId === 'aal' || livId === 'eal';
      liveryMat.map = nextTex;
      liveryMat.roughness = isMetal ? 0.24 : 0.34;
      liveryMat.metalness = isMetal ? 0.72 : 0.22;
      liveryMat.envMapIntensity = isMetal ? 1.35 : 1.05;
      liveryMat.needsUpdate = true;
    },
    dispose: () => {
      cockpitRig.dispose();
      disposableGeos.forEach((g) => g.dispose());
      disposableMats.forEach((m) => m.dispose());
      loadedTextures.forEach((t) => t.dispose());
    },
  };
}
