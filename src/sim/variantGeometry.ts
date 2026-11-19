import * as THREE from 'three';
import type {EnginePodEntry} from './ac3dLoader';
import {AircraftSpec, AircraftVariant} from './aircraftCatalog';

export interface PendingMeshItem {
  mesh: THREE.Mesh;
  name: string;
  forceZone?: string;
  isInterior: boolean;
  isGlass: boolean;
}

/**
 * Filters ONLY clean standalone AC3D sub-objects when switching variants
 * (never slicing, clamping, or deforming existing airframe meshes).
 */
export function shouldFilterMeshForVariant(
  spec: AircraftSpec,
  variant: AircraftVariant | undefined,
  meshName: string,
): boolean {
  const vid = (variant?.id ?? spec.defaultVariantId).toLowerCase();
  const nl = meshName.toLowerCase();

  // Classic 747-100 / 747-200B / 747SP omit 747-400's standalone winglet sub-objects
  if (spec.id === 'b747' && vid !== '747-400' && /winglet/.test(nl)) {
    return true;
  }

  // DC-10-10 removes the centerline main landing gear bogie & strut (doors stay flush closed)
  if (spec.id === 'dc10' && vid === 'dc10-10' && /^gearc(compress|scissor|strut|wheels)/i.test(nl)) {
    return true;
  }

  // Boeing 737-300 swaps JT8D cigar nacelles & blades for high-bypass CFM56-3 forward pods
  if (
    spec.id === 'b737' &&
    vid === '737-300' &&
    /^(moteurs|boutsmoteurs|reverse|supportsmoteurs|heliced1|heliced2|heliceg1|heliceg2)/i.test(nl)
  ) {
    return true;
  }

  // Cessna 172XP swaps 2-blade fixed prop & spinner for 3-blade constant-speed prop
  if (spec.id === 'c172' && vid === 'c172xp' && /^(propeller(\.fast)?|cone\.001)$/i.test(nl)) {
    return true;
  }

  return false;
}

/**
 * Pre-grounding rig adjustments that preserve 100% intact, uncut AC3D meshes
 * (currently levels L-1011 main gear bogies to match nose gear ground contact at Y=0).
 */
export function applyPreGroundVariantGeometry(
  spec: AircraftSpec,
  _variant: AircraftVariant | undefined,
  pendingMeshes: PendingMeshItem[],
  _propGroups: THREE.Object3D[],
) {
  if (spec.id === 'l1011') {
    // Level L-1011 main gear bogies (-3.67 -> -3.97) to match nose gear at Y=0
    for (const pm of pendingMeshes) {
      if (/^(loutbailer_l1011|rgeararm_l1011)$/i.test(pm.name)) {
        pm.mesh.geometry.translate(0, -0.3, 0);
        pm.mesh.geometry.computeBoundingBox();
      }
    }
  }
}

/**
 * Attaches clean post-grounding variant-specific hardware without cutting or distorting AC3D polygons
 * (L-1011 #2 S-duct fan/nozzle, 737-300 CFM56-3 pods + dorsal fin, 727-100 oval #2 intake,
 * 727-200F JT8D-217 pods, DC-10-40 JT9D #2 intake collar, 757-300 tail skid, C172XP 3-blade prop,
 * F-16C Block 30 MCID intake/tail spine/F110 nozzle).
 */
export function attachPostGroundVariantParts(
  spec: AircraftSpec,
  variant: AircraftVariant | undefined,
  groups: {
    fuselageGroup: THREE.Group;
    aftFuselageGroup: THREE.Group;
    leftWingGroup: THREE.Group;
    tailGroup: THREE.Group;
    enginesGroup: THREE.Group;
    noseGroup: THREE.Group;
    propGroups: THREE.Object3D[];
    fanMeshes: THREE.Object3D[];
    enginePods: EnginePodEntry[];
    getOrCreateEnginePod: (key: string, label: string) => THREE.Group;
  },
  disposableGeos: THREE.BufferGeometry[],
  disposableMats: THREE.Material[],
) {
  const vid = (variant?.id ?? spec.defaultVariantId).toLowerCase();

  const cowlMat = new THREE.MeshStandardMaterial({color: 0xe6ebf2, roughness: 0.3, metalness: 0.35});
  const chromeMat = new THREE.MeshStandardMaterial({color: 0xe2e8f0, roughness: 0.16, metalness: 0.9, side: THREE.DoubleSide});
  const darkMat = new THREE.MeshStandardMaterial({color: 0x161a20, roughness: 0.78, metalness: 0.35, side: THREE.DoubleSide});
  const bladeMat = new THREE.MeshStandardMaterial({color: 0x5c6674, roughness: 0.3, metalness: 0.85});
  disposableMats.push(cowlMat, chromeMat, darkMat, bladeMat);

  const tmpBox = new THREE.Box3();
  const tmpCenter = new THREE.Vector3();

  // L-1011 #2 S-Duct Intake Fan & Core Exhaust Nozzle Liner
  if (spec.id === 'l1011') {
    const podC = groups.getOrCreateEnginePod('pod_C', '#2 Center S-Duct RB211');
    podC.updateMatrixWorld(true);
    tmpBox.setFromObject(podC);
    if (!tmpBox.isEmpty()) {
      tmpBox.getCenter(tmpCenter);
    } else {
      tmpCenter.set(0, 6.47, 23.9);
    }

    const fanGeo = new THREE.ConeGeometry(0.32, 0.44, 14);
    fanGeo.rotateX(-Math.PI / 2);
    const bladeGeo = new THREE.BoxGeometry(0.11, 0.72, 0.03);
    const shroudGeo = new THREE.CylinderGeometry(0.95, 0.92, 0.95, 20, 1, true);
    shroudGeo.rotateX(Math.PI / 2);
    const coreNozzleGeo = new THREE.ConeGeometry(0.54, 1.35, 16);
    coreNozzleGeo.rotateX(Math.PI / 2);
    disposableGeos.push(fanGeo, bladeGeo, shroudGeo, coreNozzleGeo);

    const shroud = new THREE.Mesh(shroudGeo, darkMat);
    shroud.position.set(0, tmpCenter.y, tmpCenter.z - 0.15);
    const coreCone = new THREE.Mesh(coreNozzleGeo, darkMat);
    coreCone.position.set(0, tmpCenter.y, tmpCenter.z + 0.55);
    podC.add(shroud, coreCone);

    const inPivot = new THREE.Group();
    inPivot.position.set(0, tmpCenter.y + 1.65, tmpCenter.z - 8.1);
    const hub = new THREE.Mesh(fanGeo, chromeMat);
    inPivot.add(hub);
    for (let b = 0; b < 14; b++) {
      const blade = new THREE.Mesh(bladeGeo, bladeMat);
      const ang = (b / 14) * Math.PI * 2;
      blade.position.set(Math.sin(ang) * 0.46, Math.cos(ang) * 0.46, 0.1);
      blade.rotation.z = -ang;
      blade.rotation.y = 0.28;
      inPivot.add(blade);
    }
    podC.add(inPivot);
    groups.fanMeshes.push(inPivot);
  }

  // Boeing 737-300: CFM56-3 High-Bypass Flat-Bottom ("Hamster Pouch") Forward Pods + Dorsal Fin Fillet
  if (spec.id === 'b737' && vid === '737-300') {
    groups.leftWingGroup.updateMatrixWorld(true);
    const wingBox = new THREE.Box3().setFromObject(groups.leftWingGroup);
    groups.tailGroup.updateMatrixWorld(true);
    const tailBox = new THREE.Box3().setFromObject(groups.tailGroup);

    const podZ = wingBox.isEmpty() ? -2.2 : wingBox.min.z + 1.25;
    const podY = wingBox.isEmpty() ? 1.42 : wingBox.min.y + 0.35;

    for (const side of [-1, 1] as const) {
      const key = side === -1 ? 'cfm56_L' : 'cfm56_R';
      const pod = groups.getOrCreateEnginePod(key, side === -1 ? 'Engine #1 CFM56-3' : 'Engine #2 CFM56-3');
      const cx = side * 4.95;

      const pylonGeo = new THREE.BoxGeometry(0.32, 0.78, 2.3);
      disposableGeos.push(pylonGeo);
      const pylon = new THREE.Mesh(pylonGeo, cowlMat);
      pylon.position.set(cx, podY + 0.68, podZ + 0.95);
      pylon.castShadow = true;
      pod.add(pylon);

      const cowlGeo = new THREE.CylinderGeometry(0.86, 0.78, 2.75, 24);
      cowlGeo.rotateX(Math.PI / 2);
      const cPos = cowlGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < cPos.count; i++) {
        const py = cPos.getY(i);
        if (py < -0.52) {
          cPos.setY(i, -0.52 + (py + 0.52) * 0.35);
          cPos.setX(i, cPos.getX(i) * 1.07);
        }
      }
      cowlGeo.computeVertexNormals();
      disposableGeos.push(cowlGeo);
      const cowl = new THREE.Mesh(cowlGeo, cowlMat);
      cowl.position.set(cx, podY, podZ);
      cowl.castShadow = true;
      pod.add(cowl);

      const lipGeo = new THREE.TorusGeometry(0.79, 0.085, 10, 24);
      const lPos = lipGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < lPos.count; i++) {
        const py = lPos.getY(i);
        if (py < -0.5) {
          lPos.setY(i, -0.5 + (py + 0.5) * 0.35);
          lPos.setX(i, lPos.getX(i) * 1.07);
        }
      }
      lipGeo.computeVertexNormals();
      disposableGeos.push(lipGeo);
      const lip = new THREE.Mesh(lipGeo, chromeMat);
      lip.position.set(cx, podY, podZ - 1.38);
      pod.add(lip);

      const throatGeo = new THREE.CylinderGeometry(0.7, 0.64, 0.9, 18);
      throatGeo.rotateX(Math.PI / 2);
      const exGeo = new THREE.ConeGeometry(0.46, 0.95, 16);
      exGeo.rotateX(Math.PI / 2);
      disposableGeos.push(throatGeo, exGeo);
      const throat = new THREE.Mesh(throatGeo, darkMat);
      throat.position.set(cx, podY, podZ - 0.85);
      const nozzle = new THREE.Mesh(exGeo, darkMat);
      nozzle.position.set(cx, podY, podZ + 1.65);
      pod.add(throat, nozzle);

      const fanPivot = new THREE.Group();
      fanPivot.position.set(cx, podY, podZ - 1.05);
      const hubGeo = new THREE.ConeGeometry(0.2, 0.3, 12);
      hubGeo.rotateX(-Math.PI / 2);
      const bGeo = new THREE.BoxGeometry(0.08, 0.48, 0.025);
      disposableGeos.push(hubGeo, bGeo);
      const hub = new THREE.Mesh(hubGeo, chromeMat);
      fanPivot.add(hub);
      for (let b = 0; b < 18; b++) {
        const blade = new THREE.Mesh(bGeo, bladeMat);
        const ang = (b / 18) * Math.PI * 2;
        blade.position.set(Math.sin(ang) * 0.38, Math.cos(ang) * 0.38, 0);
        blade.rotation.z = -ang;
        blade.rotation.y = 0.35;
        fanPivot.add(blade);
      }
      pod.add(fanPivot);
      groups.fanMeshes.push(fanPivot);
    }

    if (!tailBox.isEmpty()) {
      const dShape = new THREE.Shape();
      dShape.moveTo(0, 0);
      dShape.lineTo(3.4, 0);
      dShape.lineTo(3.4, 1.35);
      dShape.lineTo(0.3, 0.08);
      dShape.closePath();
      const dGeo = new THREE.ExtrudeGeometry(dShape, {depth: 0.16, bevelEnabled: false});
      dGeo.translate(0, 0, -0.08);
      dGeo.rotateY(-Math.PI / 2);
      dGeo.computeVertexNormals();
      disposableGeos.push(dGeo);
      const dMesh = new THREE.Mesh(dGeo, cowlMat);
      dMesh.position.set(0, tailBox.min.y + 0.15, tailBox.min.z - 0.8);
      dMesh.castShadow = true;
      groups.tailGroup.add(dMesh);
    }
  }

  // Boeing 727-100: Signature wider oval #2 S-duct intake shroud
  if (spec.id === 'b727' && vid === '727-100') {
    groups.tailGroup.updateMatrixWorld(true);
    const tBox = new THREE.Box3().setFromObject(groups.tailGroup);
    const lipGeo = new THREE.TorusGeometry(0.68, 0.14, 10, 22);
    lipGeo.scale(1.18, 0.84, 1.2);
    disposableGeos.push(lipGeo);
    const ovalLip = new THREE.Mesh(lipGeo, chromeMat);
    ovalLip.position.set(0, tBox.isEmpty() ? 4.35 : tBox.min.y + 0.45, tBox.isEmpty() ? 6.8 : tBox.min.z - 0.15);
    groups.aftFuselageGroup.add(ovalLip);
  }

  // Boeing 727-200F Super 27: Enlarged JT8D-217 outer nacelles
  if (spec.id === 'b727' && vid === '727-200f') {
    groups.enginesGroup.updateMatrixWorld(true);
    const eBox = new THREE.Box3().setFromObject(groups.enginesGroup);
    if (!eBox.isEmpty()) {
      eBox.getCenter(tmpCenter);
      for (const side of [-1, 1] as const) {
        const sleeveGeo = new THREE.CylinderGeometry(0.66, 0.74, 2.3, 20, 1, true);
        sleeveGeo.rotateX(Math.PI / 2);
        disposableGeos.push(sleeveGeo);
        const sleeve = new THREE.Mesh(sleeveGeo, cowlMat);
        sleeve.position.set(side * 2.52, tmpCenter.y, tmpCenter.z);
        groups.enginesGroup.add(sleeve);
      }
    }
  }

  // DC-10-40: Signature bulged JT9D-59A #2 tail intake lip collar
  if (spec.id === 'dc10' && vid === 'dc10-40') {
    groups.tailGroup.updateMatrixWorld(true);
    const tBox = new THREE.Box3().setFromObject(groups.tailGroup);
    if (!tBox.isEmpty()) {
      const collarGeo = new THREE.TorusGeometry(1.42, 0.24, 12, 24);
      collarGeo.scale(1.08, 1.15, 1.35);
      disposableGeos.push(collarGeo);
      const collar = new THREE.Mesh(collarGeo, chromeMat);
      collar.position.set(0, tBox.min.y + 3.05, tBox.min.z + 2.65);
      groups.tailGroup.add(collar);
    }
  }

  // Boeing 757-300: Retractable aft ventral tail skid bumper
  if (spec.id === 'b757' && vid === '757-300') {
    groups.aftFuselageGroup.updateMatrixWorld(true);
    const aftBox = new THREE.Box3().setFromObject(groups.aftFuselageGroup);
    if (!aftBox.isEmpty()) {
      const skidGeo = new THREE.BoxGeometry(0.24, 0.28, 1.15);
      disposableGeos.push(skidGeo);
      const skid = new THREE.Mesh(skidGeo, darkMat);
      skid.position.set(0, aftBox.min.y + 0.12, aftBox.max.z - 5.2);
      groups.aftFuselageGroup.add(skid);
    }
  }

  // Cessna 172XP: 3-Blade Constant-Speed Propeller + Extended Cowling Spinner
  if (spec.id === 'c172' && vid === 'c172xp') {
    groups.noseGroup.updateMatrixWorld(true);
    const nBox = new THREE.Box3().setFromObject(groups.noseGroup);
    const propY = nBox.isEmpty() ? 1.29 : (nBox.min.y + nBox.max.y) * 0.5;
    const propZ = nBox.isEmpty() ? -3.9 : nBox.min.z - 0.06;

    const propPivot = new THREE.Group();
    propPivot.position.set(0, propY, propZ);
    const spinGeo = new THREE.ConeGeometry(0.18, 0.42, 14);
    spinGeo.rotateX(-Math.PI / 2);
    const bladeGeo = new THREE.BoxGeometry(0.11, 0.86, 0.025);
    disposableGeos.push(spinGeo, bladeGeo);
    const spinner = new THREE.Mesh(spinGeo, chromeMat);
    propPivot.add(spinner);
    for (let b = 0; b < 3; b++) {
      const blade = new THREE.Mesh(bladeGeo, darkMat);
      const ang = (b / 3) * Math.PI * 2;
      blade.position.set(Math.sin(ang) * 0.46, Math.cos(ang) * 0.46, 0.04);
      blade.rotation.z = -ang;
      blade.rotation.y = 0.22;
      propPivot.add(blade);
    }
    groups.fuselageGroup.add(propPivot);
    groups.propGroups.push(propPivot);
  }

  // F-16C Block 30: MCID Big-Mouth Intake Lip, Extended Dorsal Tail-Base Parabrake Spine & Wider F110 Nozzle
  if (spec.id === 'f16' && vid === 'f16c-blk30') {
    groups.tailGroup.updateMatrixWorld(true);
    const tBox = new THREE.Box3().setFromObject(groups.tailGroup);
    groups.fuselageGroup.updateMatrixWorld(true);
    const fBox = new THREE.Box3().setFromObject(groups.fuselageGroup);

    const mcidGeo = new THREE.CylinderGeometry(0.5, 0.48, 1.15, 16, 1, true, -Math.PI * 0.45, Math.PI * 0.9);
    mcidGeo.rotateZ(Math.PI / 2);
    mcidGeo.rotateY(Math.PI / 2);
    const spineGeo = new THREE.BoxGeometry(0.42, 0.42, 2.85);
    const nozGeo = new THREE.CylinderGeometry(0.62, 0.56, 1.05, 18, 1, true);
    nozGeo.rotateX(Math.PI / 2);
    disposableGeos.push(mcidGeo, spineGeo, nozGeo);

    const intakeScoop = new THREE.Mesh(mcidGeo, cowlMat);
    intakeScoop.position.set(0, fBox.isEmpty() ? 1.15 : fBox.min.y + 0.72, -3.45);
    groups.fuselageGroup.add(intakeScoop);

    const tailSpine = new THREE.Mesh(spineGeo, cowlMat);
    tailSpine.position.set(0, tBox.isEmpty() ? 2.6 : tBox.min.y + 0.15, tBox.isEmpty() ? 4.4 : tBox.max.z - 1.3);
    const f110Nozzle = new THREE.Mesh(nozGeo, darkMat);
    f110Nozzle.position.set(0, 1.94, fBox.isEmpty() ? 6.2 : fBox.max.z + 0.15);
    groups.tailGroup.add(tailSpine, f110Nozzle);
  }
}
