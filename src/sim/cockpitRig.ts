import * as THREE from 'three';
import {AircraftSpec} from './aircraftCatalog';
import {ControlInput, FlightTelemetry} from './types';

export interface CockpitRig {
  group: THREE.Group;
  update: (telemetry: FlightTelemetry, input: ControlInput, dt: number) => void;
  dispose: () => void;
}

export function createCockpitRig(spec: AircraftSpec): CockpitRig {
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];

  const isFighter = spec.id === 'f16';
  const isConcorde = spec.id === 'concorde';
  const isLightGA = spec.id === 'c172';
  const isBizJet = spec.id === 'citation';
  const isTurboprop = spec.id === 'atr42';

  // Width scale tailored to aircraft cockpit cross-section
  const widthScale = isFighter ? 0.42 : isLightGA ? 0.56 : isBizJet ? 0.72 : isTurboprop ? 0.92 : isConcorde ? 0.94 : 1.15;
  const W = 1.68 * widthScale;

  // Center aircraft around pilot eye (camera sits at cockpitOffset)
  // For multi-crew airliners, pilot camera sits slightly centered or offset above glareshield
  // Let's keep cockpit rig symmetrically centered around pilot eye X = 0 for clean visibility & framing.
  const darkMat = new THREE.MeshStandardMaterial({
    color: isFighter ? 0x161a20 : 0x222730,
    roughness: 0.78,
    metalness: 0.18,
  });
  const coamingMat = new THREE.MeshStandardMaterial({
    color: 0x12151b,
    roughness: 0.92,
    metalness: 0.08,
  });
  const consoleMat = new THREE.MeshStandardMaterial({
    color: 0x2d333d,
    roughness: 0.68,
    metalness: 0.25,
  });
  const metalMat = new THREE.MeshStandardMaterial({
    color: 0x9aa4b2,
    roughness: 0.35,
    metalness: 0.8,
  });
  const gripMat = new THREE.MeshStandardMaterial({
    color: 0x111317,
    roughness: 0.85,
    metalness: 0.12,
  });
  const knobWhiteMat = new THREE.MeshStandardMaterial({
    color: 0xe6ebf2,
    roughness: 0.4,
    metalness: 0.1,
  });
  const knobRedMat = new THREE.MeshStandardMaterial({
    color: 0xd93025,
    roughness: 0.45,
    metalness: 0.15,
  });
  mats.push(darkMat, coamingMat, consoleMat, metalMat, gripMat, knobWhiteMat, knobRedMat);

  // 1. Live 512x256 Avionics & Steam/EFIS Instrument Panel CanvasTexture
  const panelCanvas = document.createElement('canvas');
  panelCanvas.width = 512;
  panelCanvas.height = 256;
  const ctx = panelCanvas.getContext('2d')!;
  const panelTex = new THREE.CanvasTexture(panelCanvas);
  panelTex.colorSpace = THREE.SRGBColorSpace;
  panelTex.anisotropy = 4;

  const panelMat = new THREE.MeshBasicMaterial({
    map: panelTex,
  });
  mats.push(panelMat);

  // 2. Sculpted Glareshield Coaming & Main Instrument Board (placed -0.68m forward, -0.26m below eye)
  const boardGeo = new THREE.BoxGeometry(W, 0.36, 0.06);
  geos.push(boardGeo);
  const board = new THREE.Mesh(boardGeo, darkMat);
  board.position.set(0, -0.34, -0.66);
  board.rotation.x = -0.14;
  group.add(board);

  const screenGeo = new THREE.PlaneGeometry(W * 0.92, 0.31);
  geos.push(screenGeo);
  const screenMesh = new THREE.Mesh(screenGeo, panelMat);
  screenMesh.position.set(0, -0.335, -0.625);
  screenMesh.rotation.x = -0.14;
  group.add(screenMesh);

  // Top Glareshield Lip (stops sun glare, carries autopilot MCP bar)
  const glareGeo = new THREE.BoxGeometry(W + 0.08, 0.045, 0.24);
  geos.push(glareGeo);
  const glare = new THREE.Mesh(glareGeo, coamingMat);
  glare.position.set(0, -0.15, -0.64);
  group.add(glare);

  // Side Coaming Wings
  const sideGeo = new THREE.BoxGeometry(0.14, 0.42, 0.72);
  geos.push(sideGeo);
  const leftSide = new THREE.Mesh(sideGeo, consoleMat);
  leftSide.position.set(-W * 0.54, -0.34, -0.38);
  const rightSide = new THREE.Mesh(sideGeo, consoleMat);
  rightSide.position.set(W * 0.54, -0.34, -0.38);
  group.add(leftSide, rightSide);

  // Lower Deck Floor Apron (prevents seeing gaps downward past pedals)
  const floorGeo = new THREE.BoxGeometry(W * 1.15, 0.05, 0.95);
  geos.push(floorGeo);
  const floor = new THREE.Mesh(floorGeo, coamingMat);
  floor.position.set(0, -0.78, -0.35);
  group.add(floor);

  // 3. Windshield Frame Mullions & Overhead Eyebrow (high & thin so forward horizon is wide open)
  if (!isFighter) {
    const pillarGeo = new THREE.BoxGeometry(0.036, 0.62, 0.042);
    geos.push(pillarGeo);

    const centerPost = new THREE.Mesh(pillarGeo, coamingMat);
    centerPost.position.set(0, 0.08, -0.74);
    centerPost.rotation.x = 0.44;
    group.add(centerPost);

    const leftPost = new THREE.Mesh(pillarGeo, coamingMat);
    leftPost.position.set(-W * 0.48, 0.07, -0.63);
    leftPost.rotation.set(0.42, 0, -0.14);
    group.add(leftPost);

    const rightPost = new THREE.Mesh(pillarGeo, coamingMat);
    rightPost.position.set(W * 0.48, 0.07, -0.63);
    rightPost.rotation.set(0.42, 0, 0.14);
    group.add(rightPost);

    const eyebrowGeo = new THREE.BoxGeometry(W * 1.04, 0.08, 0.34);
    geos.push(eyebrowGeo);
    const eyebrow = new THREE.Mesh(eyebrowGeo, consoleMat);
    eyebrow.position.set(0, 0.36, -0.45);
    eyebrow.rotation.x = 0.25;
    group.add(eyebrow);
  } else {
    // F-16 Bubble Canopy Arch Frame + Glowing Collimated HUD Glass
    const archGeo = new THREE.TorusGeometry(0.37, 0.02, 8, 20, Math.PI);
    geos.push(archGeo);
    const arch = new THREE.Mesh(archGeo, coamingMat);
    arch.position.set(0, 0.03, -0.58);
    arch.rotation.x = 0.25;
    group.add(arch);
  }

  // Optional F-16 HUD Combiner Glass + Live Canvas HUD
  let hudCanvas: HTMLCanvasElement | null = null;
  let hudCtx: CanvasRenderingContext2D | null = null;
  let hudTex: THREE.CanvasTexture | null = null;
  if (isFighter) {
    hudCanvas = document.createElement('canvas');
    hudCanvas.width = 256;
    hudCanvas.height = 256;
    hudCtx = hudCanvas.getContext('2d')!;
    hudTex = new THREE.CanvasTexture(hudCanvas);
    hudTex.colorSpace = THREE.SRGBColorSpace;
    const hudMat = new THREE.MeshBasicMaterial({
      map: hudTex,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    mats.push(hudMat);
    const hudGeo = new THREE.PlaneGeometry(0.24, 0.24);
    geos.push(hudGeo);
    const hudGlass = new THREE.Mesh(hudGeo, hudMat);
    hudGlass.position.set(0, -0.02, -0.58);
    hudGlass.rotation.x = -0.18;
    group.add(hudGlass);
  }

  // 4. Animated Flight Control Yoke / Sidestick
  const yokePivot = new THREE.Group();
  yokePivot.position.set(0, -0.58, -0.44);
  group.add(yokePivot);

  const yokeWheelGroup = new THREE.Group();
  if (isFighter) {
    // Right-hand F-16 HOTAS sidestick
    yokePivot.position.set(0.25, -0.52, -0.34);
    const stickShaftGeo = new THREE.CylinderGeometry(0.016, 0.022, 0.19, 10);
    const stickGripGeo = new THREE.CylinderGeometry(0.021, 0.019, 0.11, 10);
    geos.push(stickShaftGeo, stickGripGeo);
    const shaft = new THREE.Mesh(stickShaftGeo, metalMat);
    shaft.position.y = 0.09;
    const grip = new THREE.Mesh(stickGripGeo, gripMat);
    grip.position.y = 0.18;
    grip.rotation.x = 0.12;
    yokeWheelGroup.add(shaft, grip);
    yokePivot.add(yokeWheelGroup);
  } else {
    // Classic Boeing / Airbus / Concorde / Cessna control column + ram-horn yoke
    const colGeo = new THREE.CylinderGeometry(0.022, 0.028, 0.34, 10);
    geos.push(colGeo);
    const col = new THREE.Mesh(colGeo, gripMat);
    col.position.y = 0.14;
    yokePivot.add(col);

    yokeWheelGroup.position.set(0, 0.28, 0.02);
    yokePivot.add(yokeWheelGroup);

    const hubGeo = new THREE.BoxGeometry(0.11, 0.065, 0.04);
    const armGeo = new THREE.BoxGeometry(0.26, 0.028, 0.024);
    const hornGeo = new THREE.CylinderGeometry(0.015, 0.017, 0.14, 10);
    geos.push(hubGeo, armGeo, hornGeo);

    const hub = new THREE.Mesh(hubGeo, gripMat);
    const crossbar = new THREE.Mesh(armGeo, gripMat);
    crossbar.position.y = -0.01;
    const leftHorn = new THREE.Mesh(hornGeo, gripMat);
    leftHorn.position.set(-0.125, 0.05, 0.01);
    leftHorn.rotation.z = 0.12;
    const rightHorn = new THREE.Mesh(hornGeo, gripMat);
    rightHorn.position.set(0.125, 0.05, 0.01);
    rightHorn.rotation.z = -0.12;
    yokeWheelGroup.add(hub, crossbar, leftHorn, rightHorn);
  }

  // 5. Center Throttle Pedestal & Multi-Engine Thrust Levers
  const pedGeo = new THREE.BoxGeometry(isFighter ? 0.14 : 0.24, 0.22, 0.42);
  geos.push(pedGeo);
  const pedestal = new THREE.Mesh(pedGeo, consoleMat);
  pedestal.position.set(isFighter ? -0.26 : W * 0.24, -0.52, -0.44);
  group.add(pedestal);

  const leverCount = Math.min(4, Math.max(1, spec.flight.engineCount));
  const throttlePivots: THREE.Group[] = [];
  const leverStemGeo = new THREE.CylinderGeometry(0.008, 0.01, 0.13, 8);
  const leverKnobGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.036, 10);
  leverKnobGeo.rotateZ(Math.PI / 2);
  geos.push(leverStemGeo, leverKnobGeo);

  for (let i = 0; i < leverCount; i++) {
    const lp = new THREE.Group();
    const spread = leverCount === 1 ? 0 : (i - (leverCount - 1) / 2) * 0.042;
    lp.position.set(spread, 0.1, -0.02);
    const stem = new THREE.Mesh(leverStemGeo, metalMat);
    stem.position.y = 0.065;
    const knob = new THREE.Mesh(leverKnobGeo, isLightGA ? knobRedMat : i === 0 && leverCount > 1 ? knobWhiteMat : gripMat);
    knob.position.y = 0.13;
    lp.add(stem, knob);
    pedestal.add(lp);
    throttlePivots.push(lp);
  }

  let drawAccum = 0;
  let smoothPitch = 0;
  let smoothRoll = 0;

  const drawPanel = (t: FlightTelemetry, inp: ControlInput) => {
    const elecOff = t.emergencies.electricalFailure;
    ctx.fillStyle = elecOff ? '#07090d' : '#11161f';
    ctx.fillRect(0, 0, 512, 256);

    // Subtle recessed instrument plate border
    ctx.strokeStyle = elecOff ? '#1e2430' : '#334155';
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, 504, 248);

    // --- LEFT SECTION: AIRSPEED & MACH ---
    ctx.fillStyle = elecOff ? '#05070a' : '#090d14';
    ctx.fillRect(16, 20, 118, 212);
    ctx.strokeStyle = elecOff ? '#1e2430' : '#475569';
    ctx.lineWidth = 2;
    ctx.strokeRect(16, 20, 118, 212);

    if (elecOff) {
      ctx.fillStyle = '#7f1d1d';
      ctx.font = 'bold 13px monospace';
      ctx.fillText('ELEC BUS', 28, 108);
      ctx.fillText('OFF', 28, 128);
    } else {
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 13px monospace';
      ctx.fillText('IAS KTS', 26, 42);
      ctx.fillStyle = t.stallWarning ? '#ef4444' : '#38bdf8';
      ctx.font = 'bold 34px monospace';
      ctx.fillText(String(t.iasKnots).padStart(3, '0'), 26, 82);

      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`MACH ${t.mach.toFixed(2)}`, 26, 112);
      ctx.fillText(`AOA  ${t.aoaDeg.toFixed(1)}°`, 26, 134);
      ctx.fillText(`G    ${t.gForce.toFixed(1)}G`, 26, 156);

      ctx.fillStyle = t.emergencies.hydraulicFailure ? '#f59e0b' : t.flapsDeg > 0 ? '#22c55e' : '#64748b';
      ctx.fillText(t.emergencies.hydraulicFailure ? 'HYD FAIL' : t.hasFlaps ? `FLAP ${t.flapsDeg}°` : 'DELTA', 26, 188);
      ctx.fillStyle = t.spoilersDeployed ? '#f59e0b' : '#475569';
      ctx.fillText(t.spoilersDeployed ? 'SPD BRK' : 'BRK RET', 26, 212);
    }

    // --- CENTER SECTION: LIVE ATTITUDE INDICATOR (ADI) + HEADING ---
    // Mechanical standby ADI remains dimly visible on battery backup even during electrical failure
    const adiX = 228;
    const adiY = 108;
    const adiR = 76;
    ctx.save();
    ctx.beginPath();
    ctx.arc(adiX, adiY, adiR, 0, Math.PI * 2);
    ctx.clip();

    ctx.translate(adiX, adiY);
    ctx.rotate(-THREE.MathUtils.degToRad(t.rollDeg));
    const pitchPx = THREE.MathUtils.clamp(t.pitchDeg, -35, 35) * 2.2;

    ctx.fillStyle = elecOff ? '#13375e' : '#1e76c9';
    ctx.fillRect(-130, -140 + pitchPx, 260, 140);
    ctx.fillStyle = elecOff ? '#452b17' : '#7a4b24';
    ctx.fillRect(-130, pitchPx, 260, 140);

    ctx.strokeStyle = elecOff ? '#94a3b8' : '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-120, pitchPx);
    ctx.lineTo(120, pitchPx);
    ctx.stroke();

    ctx.lineWidth = 1.5;
    for (const deg of [-20, -10, 10, 20]) {
      const py = pitchPx - deg * 2.2;
      ctx.beginPath();
      ctx.moveTo(-26, py);
      ctx.lineTo(26, py);
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = elecOff ? '#334155' : '#64748b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(adiX, adiY, adiR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = elecOff ? '#ca8a04' : '#facc15';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(adiX - 28, adiY);
    ctx.lineTo(adiX - 8, adiY);
    ctx.lineTo(adiX, adiY + 7);
    ctx.lineTo(adiX + 8, adiY);
    ctx.lineTo(adiX + 28, adiY);
    ctx.stroke();

    // Compass Heading Box under ADI
    ctx.fillStyle = elecOff ? '#05070a' : '#090d14';
    ctx.fillRect(156, 196, 144, 36);
    ctx.strokeStyle = elecOff ? '#1e2430' : '#475569';
    ctx.lineWidth = 2;
    ctx.strokeRect(156, 196, 144, 36);
    ctx.fillStyle = elecOff ? '#475569' : '#e2e8f0';
    ctx.font = 'bold 20px monospace';
    ctx.fillText(elecOff ? 'HDG ---°' : `HDG ${String(t.headingDeg).padStart(3, '0')}°`, 176, 221);

    // --- RIGHT SECTION: ALTITUDE, VSI, ENGINE N1, GEAR ---
    ctx.fillStyle = elecOff ? '#05070a' : '#090d14';
    ctx.fillRect(318, 20, 178, 212);
    ctx.strokeStyle = elecOff ? '#1e2430' : '#475569';
    ctx.lineWidth = 2;
    ctx.strokeRect(318, 20, 178, 212);

    if (elecOff) {
      ctx.fillStyle = '#991b1b';
      ctx.font = 'bold 14px monospace';
      ctx.fillText('NO AC/DC POWER', 332, 92);
      ctx.fillStyle = '#64748b';
      ctx.font = 'bold 12px monospace';
      ctx.fillText('STBY ADI ONLY', 336, 122);
    } else {
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 13px monospace';
      ctx.fillText('ALT FT', 328, 42);
      ctx.fillStyle = t.emergencies.pressurizationFailure ? '#f59e0b' : '#4ade80';
      ctx.font = 'bold 28px monospace';
      ctx.fillText(String(t.altitudeFtMSL).padStart(5, ' '), 328, 74);

      ctx.fillStyle = t.verticalSpeedFpm < -1200 ? '#f87171' : '#cbd5e1';
      ctx.font = 'bold 14px monospace';
      const vsSign = t.verticalSpeedFpm >= 0 ? '+' : '';
      ctx.fillText(`V/S ${vsSign}${t.verticalSpeedFpm}`, 328, 102);

      // Engine N1% Bar
      const anyFire = t.emergencies.engineFires.some(Boolean);
      ctx.fillStyle = anyFire ? '#f87171' : '#94a3b8';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`N1 ${t.n1Percent}%${anyFire ? ' FIRE!' : t.afterburnerActive ? ' A/B' : t.reverseActive ? ' REV' : ''}`, 328, 134);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(328, 142, 152, 14);
      ctx.fillStyle = anyFire ? '#ef4444' : t.afterburnerActive ? '#f97316' : t.reverseActive ? '#facc15' : '#22c55e';
      ctx.fillRect(328, 142, Math.min(152, (t.n1Percent / 105) * 152), 14);

      // 3 Individual Landing Gear Lights (Nose, Left Main, Right Main)
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 12px monospace';
      ctx.fillText('GEAR', 328, 180);
      const gearStates = [
        t.emergencies.noseGearFailure || t.gearCollapsed,
        t.emergencies.leftGearFailure || t.gearCollapsed,
        t.emergencies.rightGearFailure || t.gearCollapsed,
      ];
      for (let g = 0; g < 3; g++) {
        ctx.fillStyle = gearStates[g] ? '#ef4444' : t.gearDown ? '#22c55e' : '#334155';
        ctx.beginPath();
        ctx.arc(386 + g * 24, 176, 7, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Master Warning / Emergency Annunciator Banner
    if (t.crashed || t.gpwsWarning || t.stallWarning || t.activeWarnings.length > 0) {
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(328, 196, 154, 26);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px monospace';
      const bannerLabel = t.crashed
        ? 'STRUCT FAIL'
        : t.gpwsWarning
          ? 'PULL UP!'
          : t.stallWarning
            ? 'STALL WARN'
            : t.activeWarnings[0].slice(0, 15);
      ctx.fillText(bannerLabel, 336, 214);
    } else {
      ctx.fillStyle = inp.brakes ? '#f59e0b' : '#22c55e';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(inp.brakes ? 'BRAKES ON' : `AIRFRAME ${t.integrityPercent}%`, 328, 214);
    }

    panelTex.needsUpdate = true;

    // Optional F-16 HUD Canvas redraw
    if (hudCtx && hudTex && hudCanvas) {
      hudCtx.clearRect(0, 0, 256, 256);
      if (!elecOff) {
        hudCtx.strokeStyle = '#39ff7a';
        hudCtx.fillStyle = '#39ff7a';
        hudCtx.lineWidth = 2;

        hudCtx.beginPath();
        hudCtx.arc(128, 128, 10, 0, Math.PI * 2);
        hudCtx.moveTo(118, 128);
        hudCtx.lineTo(104, 128);
        hudCtx.moveTo(138, 128);
        hudCtx.lineTo(152, 128);
        hudCtx.moveTo(128, 118);
        hudCtx.lineTo(128, 108);
        hudCtx.stroke();

        hudCtx.save();
        hudCtx.translate(128, 128);
        hudCtx.rotate(-THREE.MathUtils.degToRad(t.rollDeg));
        const hp = THREE.MathUtils.clamp(t.pitchDeg, -30, 30) * 2.5;
        hudCtx.beginPath();
        hudCtx.moveTo(-64, hp);
        hudCtx.lineTo(-22, hp);
        hudCtx.moveTo(22, hp);
        hudCtx.lineTo(64, hp);
        hudCtx.stroke();
        hudCtx.restore();

        hudCtx.font = 'bold 18px monospace';
        hudCtx.fillText(String(t.iasKnots), 14, 132);
        hudCtx.fillText(String(t.altitudeFtMSL), 192, 132);
        hudCtx.font = 'bold 14px monospace';
        hudCtx.fillText(`M${t.mach.toFixed(2)}`, 14, 210);
        hudCtx.fillText(`${t.gForce.toFixed(1)}G`, 14, 232);
        hudCtx.fillText(`${String(t.headingDeg).padStart(3, '0')}°`, 112, 34);

        if (t.activeWarnings.length > 0) {
          hudCtx.fillStyle = '#ff5c5c';
          hudCtx.font = 'bold 13px monospace';
          hudCtx.fillText(`WARN: ${t.activeWarnings[0]}`, 60, 236);
        }
      }
      hudTex.needsUpdate = true;
    }
  };

  return {
    group,
    update: (telemetry: FlightTelemetry, input: ControlInput, dt: number) => {
      // Smooth control yoke / sidestick animation
      smoothPitch = THREE.MathUtils.lerp(smoothPitch, input.pitch, Math.min(1, dt * 12));
      smoothRoll = THREE.MathUtils.lerp(smoothRoll, input.roll, Math.min(1, dt * 12));

      if (isFighter) {
        yokeWheelGroup.rotation.x = smoothPitch * 0.22;
        yokeWheelGroup.rotation.z = -smoothRoll * 0.24;
      } else {
        yokePivot.rotation.x = smoothPitch * 0.24;
        yokeWheelGroup.rotation.z = -smoothRoll * 0.65;
      }

      const targetLeverTilt = 0.45 - input.throttle * 0.9;
      for (let i = 0; i < throttlePivots.length; i++) {
        throttlePivots[i].rotation.x = THREE.MathUtils.lerp(
          throttlePivots[i].rotation.x,
          telemetry.reverseActive ? 0.65 : targetLeverTilt,
          Math.min(1, dt * 10),
        );
      }

      // Redraw live CanvasTexture avionics at ~18 Hz
      drawAccum += dt;
      if (drawAccum >= 0.055) {
        drawAccum = 0;
        drawPanel(telemetry, input);
      }
    },
    dispose: () => {
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      panelTex.dispose();
      hudTex?.dispose();
    },
  };
}
