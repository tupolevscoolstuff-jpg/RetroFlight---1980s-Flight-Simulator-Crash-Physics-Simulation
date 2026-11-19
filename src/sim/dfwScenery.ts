import * as THREE from 'three';

export interface RunwayDef {
  id: string;
  labelNorth: string;
  labelSouth: string;
  centerX: number;
  centerZ: number;
  length: number;
  width: number;
  headingDeg: number; // Heading when flying from North/Start end toward South/End (e.g. 175 deg)
}

export interface ObstacleBox {
  name: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface DfwAirportData {
  group: THREE.Group;
  runways: RunwayDef[];
  obstacles: ObstacleBox[];
  fallbackGround: THREE.Mesh;
  isPointOnRunway: (x: number, z: number) => {onRunway: boolean; runwayName: string};
  getGroundElevation: (x: number, z: number) => number;
  updateLights: (timeSec: number, isDusk: boolean) => void;
  setWetness: (wetFactor: number) => void;
  dispose: () => void;
}

// Geo-referenced KDFW runways relative to 32.8968°N, -97.0380°W (True North/South ~180°)
export const DFW_RUNWAYS: RunwayDef[] = [
  {id: '17C/35C', labelNorth: '17C', labelSouth: '35C', centerX: 1075, centerZ: 0, length: 4085, width: 46, headingDeg: 180},
  {id: '17R/35L', labelNorth: '17R', labelSouth: '35L', centerX: 673, centerZ: -20, length: 4085, width: 46, headingDeg: 180},
  {id: '17L/35R', labelNorth: '17L', labelSouth: '35R', centerX: 2520, centerZ: -140, length: 2743, width: 46, headingDeg: 180},
  {id: '18L/36R', labelNorth: '18L', labelSouth: '36R', centerX: -1186, centerZ: 60, length: 4084, width: 61, headingDeg: 180},
  {id: '18R/36L', labelNorth: '18R', labelSouth: '36L', centerX: -1578, centerZ: 120, length: 4084, width: 61, headingDeg: 180},
  {id: '13R/31L', labelNorth: '13R', labelSouth: '31L', centerX: -2250, centerZ: -1450, length: 2835, width: 46, headingDeg: 138},
  {id: '13L/31R', labelNorth: '13L', labelSouth: '31R', centerX: 2150, centerZ: 1550, length: 2743, width: 46, headingDeg: 138},
];

function createRunwayTexture(labelNorth: string, labelSouth: string, maxAniso: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 2048;
  const ctx = canvas.getContext('2d')!;

  // Base concrete/asphalt surface with slab grid
  ctx.fillStyle = '#333840';
  ctx.fillRect(0, 0, 512, 2048);

  // Subtle weathered concrete slabs
  for (let y = 0; y < 2048; y += 32) {
    const shade = 48 + ((y * 7) % 9);
    ctx.fillStyle = `rgb(${shade}, ${shade + 4}, ${shade + 9})`;
    ctx.fillRect(8, y, 496, 30);
    ctx.fillStyle = 'rgba(20, 24, 28, 0.35)';
    ctx.fillRect(8, y + 30, 496, 2);
  }

  // Runway shoulders
  ctx.fillStyle = '#252930';
  ctx.fillRect(0, 0, 26, 2048);
  ctx.fillRect(486, 0, 26, 2048);

  // Edge lines
  ctx.fillStyle = '#e8ecf0';
  ctx.fillRect(30, 12, 8, 2024);
  ctx.fillRect(474, 12, 8, 2024);

  // Heavy rubber touchdown marks near both ends
  const drawSkids = (yCenter: number) => {
    const grad = ctx.createLinearGradient(0, yCenter - 170, 0, yCenter + 170);
    grad.addColorStop(0, 'rgba(15,15,17,0)');
    grad.addColorStop(0.25, 'rgba(15,15,17,0.58)');
    grad.addColorStop(0.75, 'rgba(15,15,17,0.52)');
    grad.addColorStop(1, 'rgba(15,15,17,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(140, yCenter - 170, 232, 340);
  };
  drawSkids(260);
  drawSkids(1788);

  // Threshold piano keys
  ctx.fillStyle = '#f1f5f9';
  for (let i = 0; i < 8; i++) {
    const x = 58 + i * 52;
    if (Math.abs(x + 14 - 256) < 20) continue;
    ctx.fillRect(x, 28, 24, 92);
    ctx.fillRect(x, 1928, 24, 92);
  }

  // Aiming point bars (1000ft markers)
  ctx.fillRect(110, 310, 44, 110);
  ctx.fillRect(358, 310, 44, 110);
  ctx.fillRect(110, 1628, 44, 110);
  ctx.fillRect(358, 1628, 44, 110);

  // Touchdown zone bars
  for (const offset of [470, 560, 1488, 1398]) {
    ctx.fillRect(135, offset, 18, 48);
    ctx.fillRect(162, offset, 18, 48);
    ctx.fillRect(332, offset, 18, 48);
    ctx.fillRect(359, offset, 18, 48);
  }

  // Centerline dashes
  ctx.fillStyle = '#f1f5f9';
  for (let y = 290; y < 1750; y += 92) {
    ctx.fillRect(249, y, 14, 52);
  }

  // Runway numbers (North threshold = top of UV, South threshold = bottom rotated 180)
  ctx.save();
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 84px "Barlow Condensed", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(labelNorth, 256, 200);
  ctx.translate(256, 1848);
  ctx.rotate(Math.PI);
  ctx.fillText(labelSouth, 0, 0);
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

function createFallbackGroundTexture(maxAniso: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#47553f';
  ctx.fillRect(0, 0, 1024, 1024);

  // North Texas prairie / urban grid patches
  for (let i = 0; i < 650; i++) {
    const x = (Math.sin(i * 19.3) * 0.5 + 0.5) * 1024;
    const y = (Math.cos(i * 37.7) * 0.5 + 0.5) * 1024;
    const w = 18 + (i % 55);
    const h = 18 + ((i * 3) % 55);
    ctx.fillStyle = i % 3 === 0 ? 'rgba(92,102,78,0.35)' : i % 3 === 1 ? 'rgba(62,74,56,0.35)' : 'rgba(110,108,92,0.22)';
    ctx.fillRect(x, y, w, h);
  }

  // Faint highway grid lines
  ctx.strokeStyle = 'rgba(130, 134, 128, 0.25)';
  ctx.lineWidth = 2;
  for (let g = 0; g <= 1024; g += 128) {
    ctx.beginPath();
    ctx.moveTo(g, 0);
    ctx.lineTo(g, 1024);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, g);
    ctx.lineTo(1024, g);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(40, 40);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

export function createDfwAirport(renderer: THREE.WebGLRenderer, cesiumActive: boolean): DfwAirportData {
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const group = new THREE.Group();
  const obstacles: ObstacleBox[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  // Fallback North Texas ground plane (visible only when Cesium globe is unavailable)
  const groundTex = createFallbackGroundTexture(maxAniso);
  textures.push(groundTex);
  const groundGeo = new THREE.PlaneGeometry(52000, 52000);
  groundGeo.rotateX(-Math.PI / 2);
  geometries.push(groundGeo);
  const groundMat = new THREE.MeshStandardMaterial({
    map: groundTex,
    roughness: 0.95,
    metalness: 0.0,
  });
  materials.push(groundMat);
  const fallbackGround = new THREE.Mesh(groundGeo, groundMat);
  fallbackGround.position.y = -0.15;
  fallbackGround.receiveShadow = true;
  fallbackGround.visible = !cesiumActive;
  group.add(fallbackGround);

  // Fallback Concrete Apron & Taxiways (hidden when real Cesium Esri satellite imagery is active)
  const apronMat = new THREE.MeshStandardMaterial({
    color: 0x5c6169,
    roughness: 0.88,
    metalness: 0.05,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  materials.push(apronMat);

  if (!cesiumActive) {
    const centralApronGeo = new THREE.PlaneGeometry(1480, 3600);
    centralApronGeo.rotateX(-Math.PI / 2);
    geometries.push(centralApronGeo);
    const centralApron = new THREE.Mesh(centralApronGeo, apronMat);
    centralApron.position.set(0, 0.02, 0);
    centralApron.receiveShadow = true;
    group.add(centralApron);

    const parkwayMat = new THREE.MeshStandardMaterial({
      color: 0x25282e,
      roughness: 0.82,
      metalness: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    materials.push(parkwayMat);
    const parkwayGeo = new THREE.PlaneGeometry(42, 6500);
    parkwayGeo.rotateX(-Math.PI / 2);
    geometries.push(parkwayGeo);
    const parkway = new THREE.Mesh(parkwayGeo, parkwayMat);
    parkway.position.set(0, 0.04, 0);
    group.add(parkway);

    const taxiMat = new THREE.MeshStandardMaterial({
      color: 0x454a52,
      roughness: 0.85,
      metalness: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    materials.push(taxiMat);

    for (const xPos of [-980, -720, 560, 880, 1280]) {
      const twGeo = new THREE.PlaneGeometry(28, 4150);
      twGeo.rotateX(-Math.PI / 2);
      geometries.push(twGeo);
      const tw = new THREE.Mesh(twGeo, taxiMat);
      tw.position.set(xPos, 0.03, 0);
      tw.receiveShadow = true;
      group.add(tw);
    }

    for (const zBridge of [-1650, -620, 620, 1650]) {
      const bridgeGeo = new THREE.PlaneGeometry(3100, 34);
      bridgeGeo.rotateX(-Math.PI / 2);
      geometries.push(bridgeGeo);
      const bridge = new THREE.Mesh(bridgeGeo, taxiMat);
      bridge.position.set(0, 0.035, zBridge);
      bridge.receiveShadow = true;
      group.add(bridge);
    }
  }

  // Build all 7 KDFW Runways
  const runwayMaterials: THREE.MeshStandardMaterial[] = [];
  for (const rwy of DFW_RUNWAYS) {
    const tex = createRunwayTexture(rwy.labelNorth, rwy.labelSouth, maxAniso);
    textures.push(tex);
    const rwyGeo = new THREE.PlaneGeometry(rwy.width, rwy.length);
    rwyGeo.rotateX(-Math.PI / 2);
    geometries.push(rwyGeo);
    const rwyMat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.78,
      metalness: 0.08,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    materials.push(rwyMat);
    runwayMaterials.push(rwyMat);

    const mesh = new THREE.Mesh(rwyGeo, rwyMat);
    mesh.position.set(rwy.centerX, 0.06, rwy.centerZ);
    mesh.rotation.y = THREE.MathUtils.degToRad(180 - rwy.headingDeg);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Runway Edge & Approach Lights (InstancedMesh for 60fps performance)
  const lightBulbGeo = new THREE.SphereGeometry(0.45, 6, 6);
  geometries.push(lightBulbGeo);
  const edgeLightMat = new THREE.MeshBasicMaterial({color: 0xfffae0});
  const greenThreshMat = new THREE.MeshBasicMaterial({color: 0x22ff66});
  const redEndMat = new THREE.MeshBasicMaterial({color: 0xff2b2b});
  const blueTaxiMat = new THREE.MeshBasicMaterial({color: 0x2a8cff});
  materials.push(edgeLightMat, greenThreshMat, redEndMat, blueTaxiMat);

  // Runway 17C/35C edge lights + ALSF-2 approach lights
  const rwy17c = DFW_RUNWAYS[0];
  const yaw17c = THREE.MathUtils.degToRad(180 - rwy17c.headingDeg);
  const cosY = Math.cos(yaw17c);
  const sinY = Math.sin(yaw17c);

  const edgePositions: THREE.Vector3[] = [];
  for (let zLocal = -rwy17c.length * 0.5; zLocal <= rwy17c.length * 0.5; zLocal += 75) {
    for (const side of [-1, 1]) {
      const xLocal = side * (rwy17c.width * 0.5 + 1.5);
      const wx = rwy17c.centerX + xLocal * cosY + zLocal * sinY;
      const wz = rwy17c.centerZ - xLocal * sinY + zLocal * cosY;
      edgePositions.push(new THREE.Vector3(wx, 0.45, wz));
    }
  }
  const edgeInst = new THREE.InstancedMesh(lightBulbGeo, edgeLightMat, edgePositions.length);
  const dummy = new THREE.Object3D();
  edgePositions.forEach((p, idx) => {
    dummy.position.copy(p);
    dummy.updateMatrix();
    edgeInst.setMatrixAt(idx, dummy.matrix);
  });
  edgeInst.computeBoundingSphere();
  group.add(edgeInst);

  // ALSF-2 Approach Lights north of Runway 17C
  const approachGroup = new THREE.Group();
  const pylonGeo = new THREE.CylinderGeometry(0.18, 0.25, 3.2, 6);
  const pylonMat = new THREE.MeshStandardMaterial({color: 0xb0b8c2, roughness: 0.6, metalness: 0.5});
  geometries.push(pylonGeo);
  materials.push(pylonMat);

  const strobeMeshes: THREE.Mesh[] = [];
  for (let i = 1; i <= 16; i++) {
    const zLocal = -rwy17c.length * 0.5 - i * 45;
    const wx = rwy17c.centerX + zLocal * sinY;
    const wz = rwy17c.centerZ + zLocal * cosY;
    const bulb = new THREE.Mesh(lightBulbGeo, i <= 4 ? redEndMat : edgeLightMat);
    bulb.position.set(wx, 1.8, wz);
    approachGroup.add(bulb);
    if (i > 4) strobeMeshes.push(bulb);
  }
  group.add(approachGroup);

  // PAPI 4-light Glideslope Indicator left of 17C touchdown zone
  const papiMatRed = new THREE.MeshBasicMaterial({color: 0xff3322});
  const papiMatWhite = new THREE.MeshBasicMaterial({color: 0xffffff});
  materials.push(papiMatRed, papiMatWhite);
  for (let p = 0; p < 4; p++) {
    const zLocal = -rwy17c.length * 0.5 + 340;
    const xLocal = -rwy17c.width * 0.5 - 12 - p * 4.5;
    const wx = rwy17c.centerX + xLocal * cosY + zLocal * sinY;
    const wz = rwy17c.centerZ - xLocal * sinY + zLocal * cosY;
    const papiBox = new THREE.Mesh(lightBulbGeo, p < 2 ? papiMatWhite : papiMatRed);
    papiBox.scale.set(1.8, 1.8, 1.8);
    papiBox.position.set(wx, 1.1, wz);
    group.add(papiBox);
  }

  // Iconic DFW Semicircular Terminals (A, B, C, D, E)
  const termConcreteMat = new THREE.MeshStandardMaterial({
    color: 0xd4cbbd, // Texas limestone concrete
    roughness: 0.78,
    metalness: 0.08,
  });
  const termGlassMat = new THREE.MeshStandardMaterial({
    color: 0x26435e,
    roughness: 0.18,
    metalness: 0.75,
  });
  const termRoofMat = new THREE.MeshStandardMaterial({
    color: 0x626b75,
    roughness: 0.72,
    metalness: 0.25,
  });
  materials.push(termConcreteMat, termGlassMat, termRoofMat);

  function addSemicircularTerminal(name: string, cx: number, cz: number, side: 1 | -1) {
    // side: +1 opens East (Terminals A, C, E); -1 opens West (Terminals B, D)
    const radius = 245;
    const segments = 9;
    const startAngle = side === 1 ? -Math.PI * 0.42 : Math.PI * 0.58;
    const endAngle = side === 1 ? Math.PI * 0.42 : Math.PI * 1.42;

    for (let i = 0; i < segments; i++) {
      const a0 = startAngle + (i / segments) * (endAngle - startAngle);
      const a1 = startAngle + ((i + 1) / segments) * (endAngle - startAngle);
      const am = (a0 + a1) * 0.5;
      const segLen = radius * Math.abs(a1 - a0) * 1.04;
      const segW = 46;
      const segH = 19;

      const px = cx + Math.cos(am) * radius;
      const pz = cz + Math.sin(am) * radius;

      const segGroup = new THREE.Group();
      segGroup.position.set(px, 0, pz);
      segGroup.rotation.y = -am + Math.PI / 2;

      const bodyGeo = new THREE.BoxGeometry(segLen, segH, segW);
      geometries.push(bodyGeo);
      const body = new THREE.Mesh(bodyGeo, termConcreteMat);
      body.position.y = segH * 0.5;
      body.castShadow = true;
      body.receiveShadow = true;
      segGroup.add(body);

      const glassGeo = new THREE.BoxGeometry(segLen * 0.96, segH * 0.45, segW + 0.8);
      geometries.push(glassGeo);
      const glass = new THREE.Mesh(glassGeo, termGlassMat);
      glass.position.y = segH * 0.62;
      segGroup.add(glass);

      const roofGeo = new THREE.BoxGeometry(segLen * 1.02, 2.2, segW * 1.04);
      geometries.push(roofGeo);
      const roof = new THREE.Mesh(roofGeo, termRoofMat);
      roof.position.y = segH + 1.1;
      segGroup.add(roof);

      // Jetbridges extending outward to the apron
      if (i % 2 === 0) {
        const jbGeo = new THREE.BoxGeometry(5, 4.2, 26);
        geometries.push(jbGeo);
        const jb = new THREE.Mesh(jbGeo, termRoofMat);
        jb.position.set(0, 6.2, side === 1 ? -segW * 0.5 - 12 : segW * 0.5 + 12);
        segGroup.add(jb);
      }

      group.add(segGroup);

      // Register approximate collision box
      const halfSpan = Math.max(Math.abs(Math.cos(am)) * segW, Math.abs(Math.sin(am)) * segLen) * 0.55 + 14;
      const halfDepth = Math.max(Math.abs(Math.sin(am)) * segW, Math.abs(Math.cos(am)) * segLen) * 0.55 + 14;
      obstacles.push({
        name,
        minX: px - halfSpan,
        maxX: px + halfSpan,
        minY: 0,
        maxY: segH + 2,
        minZ: pz - halfDepth,
        maxZ: pz + halfDepth,
      });
    }
  }

  // East Terminals: A (North), C (Center), E (South)
  addSemicircularTerminal('Terminal A', 180, -1080, 1);
  addSemicircularTerminal('Terminal C', 180, -80, 1);
  addSemicircularTerminal('Terminal E', 180, 960, 1);

  // West Terminals: B (North), D (South)
  addSemicircularTerminal('Terminal B', -180, -780, -1);
  addSemicircularTerminal('Terminal D', -180, 360, -1);

  // Central FAA Air Traffic Control Tower (DFW landmark)
  const towerGroup = new THREE.Group();
  towerGroup.position.set(25, 0, -240);
  const shaftGeo = new THREE.CylinderGeometry(5.5, 8.2, 82, 12);
  const cabBaseGeo = new THREE.CylinderGeometry(11.5, 6.5, 7, 12);
  const cabGlassGeo = new THREE.CylinderGeometry(13.2, 11.2, 8.5, 12);
  const cabRoofGeo = new THREE.CylinderGeometry(14.0, 13.4, 3.2, 12);
  const beaconGeo = new THREE.SphereGeometry(1.1, 8, 8);
  geometries.push(shaftGeo, cabBaseGeo, cabGlassGeo, cabRoofGeo, beaconGeo);

  const shaft = new THREE.Mesh(shaftGeo, termConcreteMat);
  shaft.position.y = 41;
  shaft.castShadow = true;
  towerGroup.add(shaft);

  const cabBase = new THREE.Mesh(cabBaseGeo, termConcreteMat);
  cabBase.position.y = 85.5;
  towerGroup.add(cabBase);

  const cabGlass = new THREE.Mesh(cabGlassGeo, termGlassMat);
  cabGlass.position.y = 93.0;
  towerGroup.add(cabGlass);

  const cabRoof = new THREE.Mesh(cabRoofGeo, termRoofMat);
  cabRoof.position.y = 98.5;
  towerGroup.add(cabRoof);

  const towerBeacon = new THREE.Mesh(beaconGeo, redEndMat);
  towerBeacon.position.y = 101.2;
  towerGroup.add(towerBeacon);
  group.add(towerGroup);

  obstacles.push({
    name: 'FAA Control Tower',
    minX: 11,
    maxX: 39,
    minY: 0,
    maxY: 102,
    minZ: -254,
    maxZ: -226,
  });

  // Delta Maintenance Hangars (South-East cargo/maintenance ramp)
  const hangarMat = new THREE.MeshStandardMaterial({
    color: 0xc8cdd4,
    roughness: 0.6,
    metalness: 0.3,
  });
  materials.push(hangarMat);
  for (let h = 0; h < 3; h++) {
    const hx = 620;
    const hz = 1480 + h * 155;
    const hGeo = new THREE.BoxGeometry(115, 28, 92);
    geometries.push(hGeo);
    const hangar = new THREE.Mesh(hGeo, hangarMat);
    hangar.position.set(hx, 14, hz);
    hangar.castShadow = true;
    hangar.receiveShadow = true;
    group.add(hangar);
    obstacles.push({
      name: `Maintenance Hangar ${h + 1}`,
      minX: hx - 57.5,
      maxX: hx + 57.5,
      minY: 0,
      maxY: 28,
      minZ: hz - 46,
      maxZ: hz + 46,
    });
  }

  function isPointOnRunway(x: number, z: number): {onRunway: boolean; runwayName: string} {
    for (const rwy of DFW_RUNWAYS) {
      const yaw = THREE.MathUtils.degToRad(180 - rwy.headingDeg);
      const dx = x - rwy.centerX;
      const dz = z - rwy.centerZ;
      const cos = Math.cos(-yaw);
      const sin = Math.sin(-yaw);
      const localX = dx * cos + dz * sin;
      const localZ = -dx * sin + dz * cos;
      if (Math.abs(localX) <= rwy.width * 0.5 + 8 && Math.abs(localZ) <= rwy.length * 0.5 + 25) {
        return {onRunway: true, runwayName: rwy.id};
      }
    }
    // Check central concrete apron
    if (Math.abs(x) <= 740 && Math.abs(z) <= 1800) {
      return {onRunway: true, runwayName: 'DFW Apron'};
    }
    return {onRunway: false, runwayName: 'Off-Runway Terrain'};
  }

  function getGroundElevation(_x: number, _z: number): number {
    return 0;
  }

  function updateLights(timeSec: number, isDusk: boolean) {
    // Sequential ALSF-2 rabbit strobe chase toward Runway 17C
    const activeIdx = Math.floor((timeSec * 14) % Math.max(strobeMeshes.length, 1));
    for (let i = 0; i < strobeMeshes.length; i++) {
      const s = i === activeIdx ? 2.1 : isDusk ? 1.15 : 0.85;
      strobeMeshes[i].scale.setScalar(s);
    }
    // Tower anti-collision beacon flash
    const beaconFlash = Math.sin(timeSec * 4.5) > 0.35;
    towerBeacon.scale.setScalar(beaconFlash ? 1.8 : 0.7);
  }

  function setWetness(wetFactor: number) {
    const w = Math.max(0, Math.min(1, wetFactor));
    const roughness = 0.78 - w * 0.56;
    const metalness = 0.08 + w * 0.28;
    for (let i = 0; i < runwayMaterials.length; i++) {
      runwayMaterials[i].roughness = roughness;
      runwayMaterials[i].metalness = metalness;
    }
  }

  function dispose() {
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    textures.forEach((t) => t.dispose());
  }

  return {
    group,
    runways: DFW_RUNWAYS,
    obstacles,
    fallbackGround,
    isPointOnRunway,
    getGroundElevation,
    updateLights,
    setWetness,
    dispose,
  };
}
