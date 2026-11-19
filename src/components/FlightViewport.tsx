import React, {useEffect, useRef, useState} from 'react';
import * as THREE from 'three';
import {RoomEnvironment} from 'three/examples/jsm/environments/RoomEnvironment.js';
import {loadPreMadeAircraft, LoadedAircraftRig} from '../sim/ac3dLoader';
import {getAircraftById, resolveAircraftVariant} from '../sim/aircraftCatalog';
import {ProceduralFlightAudio} from '../sim/audioEngine';
import {createCesiumBridge} from '../sim/cesiumBridge';
import {createDfwAirport} from '../sim/dfwScenery';
import {FlightDynamicsEngine} from '../sim/flightDynamics';
import {SoftbodyCrashEngine} from '../sim/softbodyPhysics';
import {
  AircraftId,
  BreakablePartInfo,
  CameraMode,
  ControlInput,
  EmergencyState,
  FlightTelemetry,
  ScenarioId,
  TimeOfDay,
  WeatherMode,
  WindConfig,
} from '../sim/types';

export interface SimCommandBridge {
  loadScenario: (id: ScenarioId) => void;
  repairAircraft: () => void;
  triggerBirdStrike: () => void;
  selectAircraft: (
    aircraftId: AircraftId,
    variantId: string,
    liveryId: string,
    scenarioId: ScenarioId,
  ) => Promise<void>;
  selectLivery: (liveryId: string) => Promise<void>;
  detachPart: (key: string) => boolean;
  getBreakableParts: () => BreakablePartInfo[];
}

interface FlightViewportProps {
  inputRef: React.MutableRefObject<ControlInput>;
  emergenciesRef: React.MutableRefObject<EmergencyState>;
  windRef: React.MutableRefObject<WindConfig>;
  cameraMode: CameraMode;
  timeOfDay: TimeOfDay;
  weatherMode: WeatherMode;
  muted: boolean;
  breakMode: boolean;
  initialScenario: ScenarioId;
  initialAircraftId: AircraftId;
  initialVariantId: string;
  initialLiveryId: string;
  onTelemetry: (t: FlightTelemetry) => void;
  onHoveredPartChange?: (part: {key: string; label: string} | null) => void;
  onBreakablePartsChange?: (parts: BreakablePartInfo[]) => void;
  commandBridgeRef: React.MutableRefObject<SimCommandBridge | null>;
  audioRef: React.MutableRefObject<ProceduralFlightAudio | null>;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 60);
  grad.addColorStop(0, 'rgba(6, 8, 12, 0.72)');
  grad.addColorStop(0.55, 'rgba(6, 8, 12, 0.28)');
  grad.addColorStop(1, 'rgba(6, 8, 12, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const FlightViewport: React.FC<FlightViewportProps> = ({
  inputRef,
  emergenciesRef,
  windRef,
  cameraMode,
  timeOfDay,
  weatherMode,
  muted,
  breakMode,
  initialScenario,
  initialAircraftId,
  initialVariantId,
  initialLiveryId,
  onTelemetry,
  onHoveredPartChange,
  onBreakablePartsChange,
  commandBridgeRef,
  audioRef,
}) => {
  const cesiumContainerRef = useRef<HTMLDivElement | null>(null);
  const threeContainerRef = useRef<HTMLDivElement | null>(null);
  const [loadingLabel, setLoadingLabel] = useState<string | null>('Loading Boeing 727-200...');

  const cameraModeRef = useRef<CameraMode>(cameraMode);
  const timeOfDayRef = useRef<TimeOfDay>(timeOfDay);
  const weatherModeRef = useRef<WeatherMode>(weatherMode);
  const breakModeRef = useRef<boolean>(breakMode);
  const onTelemetryRef = useRef(onTelemetry);
  const onHoveredPartRef = useRef(onHoveredPartChange);
  const onBreakablePartsRef = useRef(onBreakablePartsChange);
  cameraModeRef.current = cameraMode;
  timeOfDayRef.current = timeOfDay;
  weatherModeRef.current = weatherMode;
  breakModeRef.current = breakMode;
  onTelemetryRef.current = onTelemetry;
  onHoveredPartRef.current = onHoveredPartChange;
  onBreakablePartsRef.current = onBreakablePartsChange;

  useEffect(() => {
    audioRef.current?.setMuted(muted);
  }, [muted, audioRef]);

  useEffect(() => {
    const cesiumEl = cesiumContainerRef.current;
    const threeEl = threeContainerRef.current;
    if (!cesiumEl || !threeEl) return;

    const isSoftwareGl = (() => {
      try {
        const probe = document.createElement('canvas').getContext('webgl2');
        if (!probe) return true;
        const ext = probe.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
        const gpu = String(probe.getParameter(param));
        probe.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    const cesium = createCesiumBridge(cesiumEl, isSoftwareGl);
    const cesiumActive = cesium.isActive();

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, cesiumActive ? 0 : 1);

    const width = threeEl.clientWidth || window.innerWidth;
    const height = threeEl.clientHeight || window.innerHeight;
    renderer.setSize(width, height);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    threeEl.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x8db4d8, 0.000055);
    if (!cesiumActive) {
      scene.background = new THREE.Color(0x7aa5d2);
    }

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(54, width / height, 0.4, 52000);

    const hemiLight = new THREE.HemisphereLight(0xdbeeff, 0x5c5346, 0.85);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff4e0, 2.35);
    keyLight.position.set(160, 280, -140);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 10;
    keyLight.shadow.camera.far = 650;
    keyLight.shadow.camera.left = -45;
    keyLight.shadow.camera.right = 45;
    keyLight.shadow.camera.top = 45;
    keyLight.shadow.camera.bottom = -45;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);
    scene.add(keyLight.target);

    const rimLight = new THREE.DirectionalLight(0x9cc6ff, 0.65);
    rimLight.position.set(-180, 90, 200);
    scene.add(rimLight);

    const lightningLight = new THREE.DirectionalLight(0xd8e8ff, 0);
    lightningLight.position.set(-220, 420, 160);
    scene.add(lightningLight);

    const dfw = createDfwAirport(renderer, cesiumActive);
    scene.add(dfw.group);

    // Pre-allocated Zero-GC 3D Rain Streak System (for thunderstorms)
    const rainCount = 850;
    const rainPositions = new Float32Array(rainCount * 6);
    const rainOffsets = new Float32Array(rainCount * 3);
    for (let i = 0; i < rainCount; i++) {
      const rx = (Math.random() - 0.5) * 90;
      const ry = (Math.random() - 0.5) * 48;
      const rz = (Math.random() - 0.5) * 90;
      rainOffsets[i * 3] = rx;
      rainOffsets[i * 3 + 1] = ry;
      rainOffsets[i * 3 + 2] = rz;
      const idx = i * 6;
      rainPositions[idx] = rx;
      rainPositions[idx + 1] = ry;
      rainPositions[idx + 2] = rz;
      rainPositions[idx + 3] = rx - 0.25;
      rainPositions[idx + 4] = ry - 2.6;
      rainPositions[idx + 5] = rz + 0.15;
    }
    const rainGeo = new THREE.BufferGeometry();
    const rainAttr = new THREE.BufferAttribute(rainPositions, 3);
    rainAttr.setUsage(THREE.DynamicDrawUsage);
    rainGeo.setAttribute('position', rainAttr);
    const rainMat = new THREE.LineBasicMaterial({
      color: 0xbcd0e8,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    const rainLines = new THREE.LineSegments(rainGeo, rainMat);
    rainLines.frustumCulled = false;
    rainLines.visible = false;
    scene.add(rainLines);

    // High atmospheric storm cloud canopy (visible in fog & thunderstorm)
    const cloudDeckGeo = new THREE.PlaneGeometry(45000, 45000);
    cloudDeckGeo.rotateX(Math.PI / 2);
    const cloudDeckMat = new THREE.MeshBasicMaterial({
      color: 0x3b4452,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const cloudDeck = new THREE.Mesh(cloudDeckGeo, cloudDeckMat);
    cloudDeck.position.y = 950;
    cloudDeck.visible = false;
    scene.add(cloudDeck);

    // Grounded Contact Shadow plane dynamically scaled per aircraft
    const contactTex = createContactShadowTexture();
    const contactGeo = new THREE.PlaneGeometry(1, 1);
    contactGeo.rotateX(-Math.PI / 2);
    const contactMat = new THREE.MeshBasicMaterial({
      map: contactTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.55,
    });
    const contactShadow = new THREE.Mesh(contactGeo, contactMat);
    contactShadow.position.y = 0.08;
    scene.add(contactShadow);

    const flight = new FlightDynamicsEngine();
    const audio = new ProceduralFlightAudio();
    audio.setMuted(muted);
    audioRef.current = audio;

    let activeRig: LoadedAircraftRig | null = null;
    let softbody: SoftbodyCrashEngine | null = null;
    let activeLiveryId = initialLiveryId;
    let activeVariantName = resolveAircraftVariant(
      getAircraftById(initialAircraftId),
      initialVariantId,
    ).variant.name;
    let orbitYaw = 0.35;
    let orbitPitch = 0.22;
    let orbitDist = resolveAircraftVariant(
      getAircraftById(initialAircraftId),
      initialVariantId,
    ).spec.flight.cameraChaseDist;
    let loadSeq = 0;
    let disposed = false;

    const camPosSmoothed = new THREE.Vector3(1055, 14, -1870);
    const camLookSmoothed = new THREE.Vector3(1075, 2, -1820);

    // Raycast Break-Up Selection state & zero-GC helpers
    const raycaster = new THREE.Raycaster();
    const ptrNdc = new THREE.Vector2();
    let hoveredPartKey: string | null = null;
    const highlightedMeshes: THREE.Mesh[] = [];
    const clonedBreakMats: THREE.MeshStandardMaterial[] = [];

    const clearBreakHighlight = () => {
      for (let i = 0; i < highlightedMeshes.length; i++) {
        const m = highlightedMeshes[i];
        const mat = m.material;
        if (mat instanceof THREE.MeshStandardMaterial && m.userData._origEmissive) {
          mat.emissive.copy(m.userData._origEmissive as THREE.Color);
          mat.emissiveIntensity = (m.userData._origEmissiveIntensity as number) ?? 1;
        }
      }
      highlightedMeshes.length = 0;
    };

    const applyBreakHighlight = (key: string | null) => {
      if (key === hoveredPartKey) return;
      clearBreakHighlight();
      hoveredPartKey = key;
      if (!key || !softbody) {
        onHoveredPartRef.current?.(null);
        renderer.domElement.style.cursor = breakModeRef.current ? 'crosshair' : 'grab';
        return;
      }
      const grp = softbody.getDebrisGroup(key);
      if (!grp) {
        hoveredPartKey = null;
        onHoveredPartRef.current?.(null);
        renderer.domElement.style.cursor = breakModeRef.current ? 'crosshair' : 'grab';
        return;
      }
      let label = key;
      grp.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          if (mesh.userData.debrisKey === key && mesh.userData.debrisLabel) {
            label = mesh.userData.debrisLabel as string;
          }
          if (mesh.material instanceof THREE.MeshStandardMaterial) {
            if (!mesh.userData._uniqueBreakMat) {
              const wasLivery = activeRig?.liveryMaterials.includes(mesh.material) ?? false;
              const cloned = mesh.material.clone();
              mesh.material = cloned;
              mesh.userData._uniqueBreakMat = true;
              mesh.userData._origEmissive = cloned.emissive.clone();
              mesh.userData._origEmissiveIntensity = cloned.emissiveIntensity;
              clonedBreakMats.push(cloned);
              if (wasLivery && activeRig) {
                activeRig.liveryMaterials.push(cloned);
              }
            }
            const mMat = mesh.material as THREE.MeshStandardMaterial;
            mMat.emissive.setHex(0xff3d1f);
            mMat.emissiveIntensity = 0.78;
            highlightedMeshes.push(mesh);
          }
        }
      });
      renderer.domElement.style.cursor = 'pointer';
      onHoveredPartRef.current?.({key, label});
    };

    const detachByKey = (key: string): boolean => {
      if (!softbody) return false;
      audio.unlock();
      const didDetach = softbody.detachPart(key, flight.vel, flight.quat, 24);
      if (didDetach) {
        if (hoveredPartKey === key) applyBreakHighlight(null);
        audio.playCrashImpact();
        crashShake = Math.max(crashShake, 0.72);
        onBreakablePartsRef.current?.(softbody.getBreakableParts());
      }
      return didDetach;
    };

    const pickDebrisKeyAtEvent = (clientX: number, clientY: number): string | null => {
      if (!activeRig || !softbody) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      ptrNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ptrNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ptrNdc, camera);
      const hits = raycaster.intersectObjects(activeRig.airframeGroup.children, true);
      for (let i = 0; i < hits.length; i++) {
        const key = hits[i].object.userData.debrisKey as string | undefined;
        if (key && !softbody.isPartDetached(key)) {
          return key;
        }
      }
      return null;
    };

    async function mountAircraft(
      aircraftId: AircraftId,
      variantId: string,
      liveryId: string,
      scenarioId: ScenarioId,
    ) {
      const seq = ++loadSeq;
      const baseSpec = getAircraftById(aircraftId);
      const {spec, variant} = resolveAircraftVariant(baseSpec, variantId);
      setLoadingLabel(`Loading ${spec.name}...`);

      try {
        const nextRig = await loadPreMadeAircraft(spec, liveryId, renderer, variant);
        if (disposed || seq !== loadSeq) {
          nextRig.dispose();
          return;
        }

        applyBreakHighlight(null);
        clonedBreakMats.forEach((m) => m.dispose());
        clonedBreakMats.length = 0;

        if (softbody) {
          softbody.dispose();
          softbody = null;
        }
        if (activeRig) {
          scene.remove(activeRig.root);
          activeRig.dispose();
          activeRig = null;
        }

        activeRig = nextRig;
        activeLiveryId = liveryId;
        activeVariantName = variant.name;
        scene.add(activeRig.root);

        const fr = Math.max(25, spec.flight.wingspanM * 1.1);
        keyLight.shadow.camera.left = -fr;
        keyLight.shadow.camera.right = fr;
        keyLight.shadow.camera.top = fr;
        keyLight.shadow.camera.bottom = -fr;
        keyLight.shadow.camera.updateProjectionMatrix();

        softbody = new SoftbodyCrashEngine(activeRig, scene);
        flight.loadScenario(scenarioId, softbody, spec);
        orbitDist = spec.flight.cameraChaseDist;
        onBreakablePartsRef.current?.(softbody.getBreakableParts());

        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(flight.quat);
        camPosSmoothed.copy(flight.pos).addScaledVector(fwd, -orbitDist).add(new THREE.Vector3(0, 9, 0));
        camLookSmoothed.copy(flight.pos);

        if (!isSoftwareGl) {
          renderer.compile(scene, camera);
        }
      } finally {
        if (!disposed && seq === loadSeq) {
          setLoadingLabel(null);
        }
      }
    }

    commandBridgeRef.current = {
      loadScenario: (id: ScenarioId) => {
        if (softbody && activeRig) {
          applyBreakHighlight(null);
          flight.loadScenario(id, softbody, activeRig.spec);
          onBreakablePartsRef.current?.(softbody.getBreakableParts());
        }
      },
      repairAircraft: () => {
        if (!softbody) return;
        applyBreakHighlight(null);
        softbody.reset();
        flight.gearCollapsed = false;
        if (flight.pos.y < 1.2) {
          flight.pos.y = 0.05;
          flight.vel.set(0, 0, 0);
          flight.angVel.set(0, 0, 0);
          const e = new THREE.Euler().setFromQuaternion(flight.quat, 'YXZ');
          e.x = 0;
          e.z = 0;
          flight.quat.setFromEuler(e);
        }
        onBreakablePartsRef.current?.(softbody.getBreakableParts());
      },
      triggerBirdStrike: () => {
        if (!softbody) return;
        audio.unlock();
        softbody.triggerBirdStrike(flight.pos, flight.quat, flight.vel);
        audio.playBirdStrike();
        crashShake = Math.max(crashShake, 0.45);
      },
      selectAircraft: async (
        aircraftId: AircraftId,
        variantId: string,
        liveryId: string,
        scenarioId: ScenarioId,
      ) => {
        await mountAircraft(aircraftId, variantId, liveryId, scenarioId);
      },
      selectLivery: async (liveryId: string) => {
        if (!activeRig) return;
        const liv = activeRig.spec.liveries.find((l) => l.id === liveryId);
        if (!liv) return;
        activeLiveryId = liv.id;
        await activeRig.setLiveryTexture(liv.textureUrl);
      },
      detachPart: (key: string) => detachByKey(key),
      getBreakableParts: () => (softbody ? softbody.getBreakableParts() : []),
    };

    void mountAircraft(initialAircraftId, initialVariantId, initialLiveryId, initialScenario);

    // Pointer drag camera inspection + Break-Off hover/click raycasting
    let dragActive = false;
    let ptrDownX = 0;
    let ptrDownY = 0;
    let lastPtrX = 0;
    let lastPtrY = 0;
    let lastHoverRayMs = 0;

    const onPtrDown = (e: PointerEvent) => {
      audio.unlock();
      if (e.target !== renderer.domElement) return;
      dragActive = true;
      ptrDownX = e.clientX;
      ptrDownY = e.clientY;
      lastPtrX = e.clientX;
      lastPtrY = e.clientY;
    };
    const onPtrMove = (e: PointerEvent) => {
      if (dragActive) {
        const dx = e.clientX - lastPtrX;
        const dy = e.clientY - lastPtrY;
        lastPtrX = e.clientX;
        lastPtrY = e.clientY;
        orbitYaw -= dx * 0.0055;
        orbitPitch = THREE.MathUtils.clamp(orbitPitch + dy * 0.0045, -0.15, 1.25);
        return;
      }
      if (breakModeRef.current) {
        const nowMs = performance.now();
        if (nowMs - lastHoverRayMs >= 42) {
          lastHoverRayMs = nowMs;
          applyBreakHighlight(pickDebrisKeyAtEvent(e.clientX, e.clientY));
        }
      }
    };
    const onPtrUp = (e: PointerEvent) => {
      const wasDrag = dragActive;
      dragActive = false;
      if (wasDrag && breakModeRef.current) {
        const dist = Math.hypot(e.clientX - ptrDownX, e.clientY - ptrDownY);
        if (dist < 6) {
          const hitKey = pickDebrisKeyAtEvent(e.clientX, e.clientY);
          if (hitKey) {
            detachByKey(hitKey);
          }
        }
      }
    };
    const onWheel = (e: WheelEvent) => {
      orbitDist = THREE.MathUtils.clamp(orbitDist + e.deltaY * 0.04, 10, 190);
    };

    renderer.domElement.addEventListener('pointerdown', onPtrDown);
    window.addEventListener('pointermove', onPtrMove);
    window.addEventListener('pointerup', onPtrUp);
    renderer.domElement.addEventListener('wheel', onWheel, {passive: true});

    const onResize = () => {
      if (!threeEl) return;
      const w = threeEl.clientWidth || window.innerWidth;
      const h = threeEl.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    const onContextLost = (ev: Event) => {
      ev.preventDefault();
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);

    const _desiredCamPos = new THREE.Vector3();
    const _desiredCamLook = new THREE.Vector3();
    const _offsetVec = new THREE.Vector3();
    const _upVec = new THREE.Vector3(0, 1, 0);
    const _aircraftForward = new THREE.Vector3();
    const _aircraftUp = new THREE.Vector3();
    const _eulerTmp = new THREE.Euler(0, 0, 0, 'YXZ');

    let frameId = 0;
    let lastTime = performance.now();
    let elapsed = 0;
    let telemetryAccumulator = 0;
    let crashShake = 0;
    let prevCrashed = false;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
      gl.flush();
      if (!sync) {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const poll = () => {
        if (disposed) return;
        const state = gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function applyAtmosphere(tod: TimeOfDay, weather: WeatherMode, lightningFlash = 0) {
      const fog = scene.fog as THREE.FogExp2;
      let keyHex = 0xfff5e4;
      let keyInt = 2.4;
      let hemiInt = 0.9;
      let bgHex = 0x78a7d6;
      let fogHex = 0x98bddf;
      let fogDensity = 0.000055;
      let exposure = 1.08;

      if (tod === 'golden') {
        keyHex = 0xffb46b;
        keyInt = 2.25;
        hemiInt = 0.7;
        bgHex = 0xc98b68;
        fogHex = 0xc99679;
        exposure = 1.06;
      } else if (tod === 'dusk') {
        keyHex = 0x88a8e8;
        keyInt = 1.05;
        hemiInt = 0.48;
        bgHex = 0x1f2d45;
        fogHex = 0x283852;
        exposure = 0.98;
      }

      if (weather === 'fog') {
        fogDensity = 0.00095;
        keyInt *= 0.62;
        hemiInt = tod === 'dusk' ? 0.56 : 1.05;
        exposure = tod === 'dusk' ? 0.94 : 1.02;
        if (tod === 'day') {
          bgHex = 0xc4d0db;
          fogHex = 0xc7d3de;
          keyHex = 0xe8eff5;
        } else if (tod === 'golden') {
          bgHex = 0xc2aea2;
          fogHex = 0xc4b0a4;
          keyHex = 0xf2ccb0;
        } else {
          bgHex = 0x3b485c;
          fogHex = 0x3f4c61;
        }
        cloudDeck.visible = true;
        cloudDeck.position.y = 520;
        cloudDeckMat.color.setHex(fogHex);
        cloudDeckMat.opacity = 0.55;
      } else if (weather === 'thunderstorm') {
        fogDensity = 0.00046;
        keyInt *= 0.36;
        hemiInt = tod === 'dusk' ? 0.34 : 0.68;
        exposure = tod === 'dusk' ? 0.88 : 0.95;
        if (tod === 'day') {
          bgHex = 0x35404f;
          fogHex = 0x3b4657;
          keyHex = 0xa9bad1;
        } else if (tod === 'golden') {
          bgHex = 0x3b3744;
          fogHex = 0x423d4d;
          keyHex = 0xb59f96;
        } else {
          bgHex = 0x141b28;
          fogHex = 0x182130;
          keyHex = 0x677ba0;
        }
        cloudDeck.visible = true;
        cloudDeck.position.y = 850;
        cloudDeckMat.color.setHex(tod === 'dusk' ? 0x1b2230 : 0x2c3442);
        cloudDeckMat.opacity = 0.78;
      } else {
        cloudDeck.visible = false;
      }

      keyLight.color.setHex(keyHex);
      keyLight.intensity = keyInt;
      hemiLight.intensity = hemiInt;
      fog.density = fogDensity;
      fog.color.setHex(fogHex);
      if (!cesiumActive) {
        scene.background = new THREE.Color(bgHex);
      }
      renderer.toneMappingExposure = exposure + lightningFlash * 0.45;
      lightningLight.intensity = lightningFlash * 6.5;

      dfw.setWetness(weather === 'thunderstorm' ? 0.95 : weather === 'fog' ? 0.42 : 0.0);
      cesium.setAtmosphere(weather, tod, lightningFlash);
    }

    let lastTod: TimeOfDay | null = null;
    let lastWeather: WeatherMode | null = null;
    let lightningTimer = 4.0;
    let lightningFlash = 0;

    function tick() {
      if (disposed) return;
      const now = performance.now();
      const dt = Math.min(Math.max((now - lastTime) / 1000, 0.004), 0.04);
      lastTime = now;
      elapsed += dt;

      const tod = timeOfDayRef.current;
      const weather = weatherModeRef.current;

      // Handle storm lightning flash timer
      let flashChanged = false;
      if (weather === 'thunderstorm') {
        lightningTimer -= dt;
        if (lightningTimer <= 0) {
          lightningTimer = 3.2 + Math.random() * 5.8;
          lightningFlash = 0.85 + Math.random() * 0.15;
          audio.playThunder(lightningFlash);
          flashChanged = true;
        } else if (lightningFlash > 0.005) {
          lightningFlash *= Math.exp(-8.5 * dt);
          if (lightningFlash <= 0.005) lightningFlash = 0;
          flashChanged = true;
        }
      } else if (lightningFlash !== 0) {
        lightningFlash = 0;
        flashChanged = true;
      }

      if (tod !== lastTod || weather !== lastWeather || flashChanged) {
        lastTod = tod;
        lastWeather = weather;
        applyAtmosphere(tod, weather, lightningFlash);
      }

      dfw.updateLights(elapsed, tod === 'dusk' || weather === 'thunderstorm' || weather === 'fog');

      if (!breakModeRef.current) {
        if (hoveredPartKey !== null) {
          applyBreakHighlight(null);
        } else if (renderer.domElement.style.cursor !== 'grab') {
          renderer.domElement.style.cursor = 'grab';
        }
      } else if (!hoveredPartKey && renderer.domElement.style.cursor !== 'crosshair') {
        renderer.domElement.style.cursor = 'crosshair';
      }

      if (activeRig && softbody) {
        const currentEmergencies = emergenciesRef.current;
        const result = flight.step(
          dt,
          inputRef.current,
          activeRig,
          dfw,
          softbody,
          cesium.worldToLatLon,
          cesiumActive,
          activeLiveryId,
          weather,
          currentEmergencies,
          windRef.current,
          activeRig.variantId,
          activeVariantName,
        );

        if (result.touchdownImpulse > 1.8) {
          audio.playTouchdown(result.touchdownImpulse);
          crashShake = Math.max(crashShake, Math.min(0.6, result.touchdownImpulse * 0.08));
        }
        if (result.telemetry.crashed && !prevCrashed) {
          prevCrashed = true;
          audio.playCrashImpact(1.0);
          crashShake = 1.8;
          onBreakablePartsRef.current?.(softbody.getBreakableParts());
        } else if (!result.telemetry.crashed) {
          prevCrashed = false;
        }

        if (prevCrashed && result.secondaryImpactIntensity > 0) {
          audio.playCrashImpact(THREE.MathUtils.clamp(result.secondaryImpactIntensity / 18, 0.45, 1.05));
          crashShake = Math.max(crashShake, THREE.MathUtils.clamp(result.secondaryImpactIntensity * 0.09, 0.5, 1.75));
        } else if (prevCrashed && result.partDetachedThisStep) {
          audio.playCrashImpact(0.42);
          crashShake = Math.max(crashShake, 0.4);
        }

        if (result.partDetachedThisStep) {
          onBreakablePartsRef.current?.(softbody.getBreakableParts());
        }

        const fireActive = currentEmergencies.engineFires.some(Boolean);
        audio.update(
          dt,
          result.telemetry.n1Percent,
          result.telemetry.iasKnots,
          result.scrapeIntensity,
          result.telemetry.crashed,
          result.telemetry.gpwsWarning || result.telemetry.stallWarning,
          activeRig.spec.audioProfile,
          result.telemetry.afterburnerActive,
          weather === 'thunderstorm' ? 1.0 : 0.0,
          fireActive,
          currentEmergencies.electricalFailure,
        );

        const elecOk = !currentEmergencies.electricalFailure;
        const strobeOn = elecOk && Math.sin(elapsed * 9.5) > 0.82;
        activeRig.strobeLights.forEach((m) => (m.visible = strobeOn));
        const beaconOn = elecOk && Math.sin(elapsed * 4.2) > 0.35;
        activeRig.beaconLights.forEach((m) => (m.visible = beaconOn));
        activeRig.landingLightBeam.intensity =
          elecOk && result.telemetry.gearDown && !result.telemetry.crashed
            ? tod === 'dusk' || weather === 'thunderstorm'
              ? 35
              : 14
            : 0;

        const sunOffsetX = tod === 'golden' ? -210 : 160;
        const sunOffsetY = tod === 'golden' ? 95 : 260;
        keyLight.position.set(flight.pos.x + sunOffsetX, flight.pos.y + sunOffsetY, flight.pos.z - 120);
        keyLight.target.position.copy(flight.pos);
        keyLight.target.updateMatrixWorld();

        const aglMeters = Math.max(0, flight.pos.y);
        const fSpec = activeRig.spec.flight;
        contactShadow.position.set(flight.pos.x, 0.08, flight.pos.z);
        _eulerTmp.setFromQuaternion(flight.quat, 'YXZ');
        contactShadow.rotation.y = _eulerTmp.y;
        contactMat.opacity = THREE.MathUtils.clamp(0.58 - aglMeters * 0.015, 0, 0.58);
        const shadowExpand = 1 + Math.min(aglMeters * 0.02, 0.8);
        contactShadow.scale.set(
          fSpec.wingspanM * 1.25 * shadowExpand,
          1,
          fSpec.lengthM * 1.18 * shadowExpand,
        );

        const mode = cameraModeRef.current;
        const isCockpit = mode === 'cockpit';
        activeRig.cockpitRig.group.visible = isCockpit;
        for (let h = 0; h < activeRig.cockpitHiddenMeshes.length; h++) {
          activeRig.cockpitHiddenMeshes[h].visible = !isCockpit;
        }
        if (isCockpit) {
          activeRig.cockpitRig.update(result.telemetry, inputRef.current, dt);
        }

        _aircraftForward.set(0, 0, -1).applyQuaternion(flight.quat).normalize();
        _aircraftUp.set(0, 1, 0).applyQuaternion(flight.quat).normalize();

        if (mode === 'chase') {
          camera.near = 0.4;
          const headingYaw = _eulerTmp.y;
          const totalYaw = headingYaw + orbitYaw;
          const horizDist = Math.cos(orbitPitch) * orbitDist;
          const vertDist = Math.sin(orbitPitch) * orbitDist + fSpec.heightM * 0.65;
          _desiredCamPos.set(
            flight.pos.x + Math.sin(totalYaw) * horizDist,
            Math.max(1.2, flight.pos.y + vertDist),
            flight.pos.z + Math.cos(totalYaw) * horizDist,
          );
          _desiredCamLook
            .copy(flight.pos)
            .addScaledVector(_aircraftForward, fSpec.lengthM * 0.22)
            .add(new THREE.Vector3(0, fSpec.heightM * 0.24, 0));
          camPosSmoothed.lerp(_desiredCamPos, 1 - Math.exp(-8 * dt));
          camLookSmoothed.lerp(_desiredCamLook, 1 - Math.exp(-12 * dt));
          camera.position.copy(camPosSmoothed);
          camera.up.copy(_upVec);
          camera.lookAt(camLookSmoothed);

          const targetFov = 52 + THREE.MathUtils.clamp(result.telemetry.iasKnots / 420, 0, 1) * 12;
          camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, dt * 4);
        } else if (mode === 'wing') {
          camera.near = 0.4;
          const [wx, wy, wz] = fSpec.wingCamOffset;
          const [lx, ly, lz] = fSpec.wingCamLook;
          _offsetVec.set(wx, wy, wz).applyQuaternion(flight.quat).add(flight.pos);
          _desiredCamLook.set(lx, ly, lz).applyQuaternion(flight.quat).add(flight.pos);
          camera.position.copy(_offsetVec);
          camera.up.copy(_aircraftUp);
          camera.lookAt(_desiredCamLook);
          camera.fov = 58;
        } else if (isCockpit) {
          camera.near = 0.08;
          const [cx, cy, cz] = fSpec.cockpitOffset;
          _offsetVec
            .set(cx, cy + activeRig.airframeGroup.position.y, cz)
            .applyQuaternion(flight.quat)
            .add(flight.pos);
          // Slight downward gaze (-0.065 rad) so both glareshield gauges and DFW runway horizon are framed together!
          _desiredCamLook
            .copy(_offsetVec)
            .addScaledVector(_aircraftForward, 120)
            .addScaledVector(_aircraftUp, -7.8);
          camera.position.copy(_offsetVec);
          camera.up.copy(_aircraftUp);
          camera.lookAt(_desiredCamLook);
          camera.fov = 66;
        } else if (mode === 'tower') {
          camera.near = 0.4;
          camera.position.set(25, 97, -240);
          const distToPlane = camera.position.distanceTo(flight.pos);
          camera.up.copy(_upVec);
          camera.lookAt(flight.pos);
          camera.fov = THREE.MathUtils.clamp(19000 / Math.max(distToPlane, 220), 14, 54);
        } else {
          camera.near = 0.4;
          const horizDist = Math.cos(orbitPitch) * orbitDist;
          const vertDist = Math.sin(orbitPitch) * orbitDist;
          camera.position.set(
            flight.pos.x + Math.sin(orbitYaw) * horizDist,
            Math.max(1.0, flight.pos.y + fSpec.heightM * 0.3 + vertDist),
            flight.pos.z + Math.cos(orbitYaw) * horizDist,
          );
          camera.up.copy(_upVec);
          camera.lookAt(flight.pos.x, flight.pos.y + fSpec.heightM * 0.25, flight.pos.z);
          camera.fov = 48;
        }

        if (crashShake > 0.01) {
          camera.position.x += (Math.random() - 0.5) * crashShake;
          camera.position.y += (Math.random() - 0.5) * crashShake;
          camera.position.z += (Math.random() - 0.5) * crashShake;
          crashShake *= Math.exp(-5.5 * dt);
        }

        telemetryAccumulator += dt;
        if (telemetryAccumulator >= 0.055) {
          telemetryAccumulator = 0;
          onTelemetryRef.current(result.telemetry);
        }
      } else {
        // Initial DFW Runway 17C framing while first .ac model parses
        camera.position.set(1055, 12, -1870);
        camera.lookAt(1075, 3, -1820);
      }

      // Update 3D Rain Streaks around camera when storming (slanted by active wind!)
      if (weather === 'thunderstorm') {
        rainLines.visible = true;
        const cx = camera.position.x;
        const cy = camera.position.y;
        const cz = camera.position.z;
        const w = windRef.current;
        const wRad = THREE.MathUtils.degToRad(w.directionDeg);
        const wMs = (w.speedKnots + 6) * 0.514444;
        const rainWindDx = -Math.sin(wRad) * wMs * 0.065;
        const rainWindDz = Math.cos(wRad) * wMs * 0.065;
        for (let i = 0; i < rainCount; i++) {
          const oIdx = i * 3;
          let ry = rainOffsets[oIdx + 1] - 46 * dt;
          if (ry < -24) ry += 48;
          rainOffsets[oIdx + 1] = ry;

          const rx = cx + rainOffsets[oIdx];
          const wy = cy + ry;
          const rz = cz + rainOffsets[oIdx + 2];
          const pIdx = i * 6;
          rainPositions[pIdx] = rx;
          rainPositions[pIdx + 1] = wy;
          rainPositions[pIdx + 2] = rz;
          rainPositions[pIdx + 3] = rx + rainWindDx;
          rainPositions[pIdx + 4] = wy - 2.9;
          rainPositions[pIdx + 5] = rz + rainWindDz;
        }
        rainAttr.needsUpdate = true;
      } else {
        rainLines.visible = false;
      }

      if (cloudDeck.visible) {
        cloudDeck.position.x = camera.position.x;
        cloudDeck.position.z = camera.position.z;
      }

      camera.updateProjectionMatrix();

      const curW = threeEl?.clientWidth || window.innerWidth;
      const curH = threeEl?.clientHeight || window.innerHeight;
      cesium.syncAndRender(camera, curW, curH);
      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);

      renderer.domElement.removeEventListener('pointerdown', onPtrDown);
      window.removeEventListener('pointermove', onPtrMove);
      window.removeEventListener('pointerup', onPtrUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);

      commandBridgeRef.current = null;
      audioRef.current = null;
      audio.dispose();
      clonedBreakMats.forEach((m) => m.dispose());
      clonedBreakMats.length = 0;
      softbody?.dispose();
      activeRig?.dispose();
      dfw.dispose();
      rainGeo.dispose();
      rainMat.dispose();
      cloudDeckGeo.dispose();
      cloudDeckMat.dispose();
      contactGeo.dispose();
      contactMat.dispose();
      contactTex.dispose();
      envTex.dispose();
      cesium.destroy();
      renderer.dispose();
      if (renderer.domElement.parentNode === threeEl) {
        threeEl.removeChild(renderer.domElement);
      }
    };
  }, [initialScenario, initialAircraftId, initialVariantId, initialLiveryId, commandBridgeRef, audioRef, inputRef, emergenciesRef, windRef]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#0a101a]">
      <div
        ref={cesiumContainerRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        aria-hidden="true"
      />
      <div ref={threeContainerRef} className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing" />
      {loadingLabel && (
        <div className="fixed top-32 sm:top-24 left-1/2 -translate-x-1/2 z-20 pointer-events-none px-3.5 py-1.5 rounded-lg border border-sky-400/35 bg-[#090d14]/88 text-xs font-medium text-sky-100 shadow-lg whitespace-nowrap max-w-[90vw] truncate">
          {loadingLabel}
        </div>
      )}
    </div>
  );
};
