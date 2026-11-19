import * as THREE from 'three';
import {LoadedAircraftRig} from './ac3dLoader';
import {AircraftSpec} from './aircraftCatalog';
import {DfwAirportData} from './dfwScenery';
import {SoftbodyCrashEngine} from './softbodyPhysics';
import {ControlInput, EmergencyState, FlightTelemetry, ScenarioId, WeatherMode, WindConfig} from './types';

export const FLAP_ANGLES = [0, 5, 15, 25, 30, 40];

export const DEFAULT_WIND: WindConfig = {
  speedKnots: 8,
  directionDeg: 180,
  gustsKnots: 4,
};

const NO_EMERGENCIES: EmergencyState = {
  birdStrikeCount: 0,
  hydraulicFailure: false,
  noseGearFailure: false,
  leftGearFailure: false,
  rightGearFailure: false,
  engineFires: [false, false, false, false],
  electricalFailure: false,
  pressurizationFailure: false,
  fuelLeak: false,
  runawayTrim: false,
};

export class FlightDynamicsEngine {
  public pos = new THREE.Vector3();
  public vel = new THREE.Vector3();
  public quat = new THREE.Quaternion();
  public angVel = new THREE.Vector3();

  public n1 = 0.24; // 0..1.05
  public gearProgress = 1.0; // 1 = down, 0 = retracted
  public gearCollapsed = false;
  public flapProgress = 0; // degrees
  public spoilerProgress = 0; // 0..1
  public reverserProgress = 0; // 0..1

  private fanAngle = 0;
  private propAngle = 0;
  private wheelAngle = 0;
  private gForce = 1.0;
  private aoaDeg = 0;
  private peakG = 1.0;
  private impactSpeedKnots = 0;
  private impactSinkFpm = 0;
  private wasOnGround = true;

  // Scratch vectors/quaternions (zero GC)
  private _forward = new THREE.Vector3();
  private _right = new THREE.Vector3();
  private _up = new THREE.Vector3();
  private _localVel = new THREE.Vector3();
  private _force = new THREE.Vector3();
  private _torque = new THREE.Vector3();
  private _worldTorque = new THREE.Vector3();
  private _euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private _dq = new THREE.Quaternion();
  private _gearWorldPt = new THREE.Vector3();
  private _gearRelVel = new THREE.Vector3();
  private _rGear = new THREE.Vector3();
  private _invQuat = new THREE.Quaternion();
  private _noseOffset = new THREE.Vector3(0, 0, -17.6);
  private _lMainOffset = new THREE.Vector3(-2.9, 0, 2.6);
  private _rMainOffset = new THREE.Vector3(2.9, 0, 2.6);
  private _windVel = new THREE.Vector3();
  private _airVel = new THREE.Vector3();
  private _fwdHoriz = new THREE.Vector3();
  private _rightHoriz = new THREE.Vector3();

  private ctrlPitch = 0;
  private ctrlRoll = 0;
  private ctrlYaw = 0;
  private slatFrac = 0;

  private stormClock = 0;

  public loadScenario(id: ScenarioId, softbody: SoftbodyCrashEngine, spec: AircraftSpec) {
    softbody.reset();
    this.angVel.set(0, 0, 0);
    this.gearCollapsed = false;
    this.peakG = 1.0;
    this.impactSpeedKnots = 0;
    this.impactSinkFpm = 0;
    this.reverserProgress = 0;
    this.spoilerProgress = 0;

    // Runway 17C center (1075, 0), true heading 180 deg
    const rwyCenterX = 1075;
    const hRad = THREE.MathUtils.degToRad(180);
    const fx = Math.sin(hRad);
    const fz = -Math.cos(hRad);

    const approachMs = Math.max(32, spec.flight.approachSpeedKnots * 0.514444);
    const lowPassMs = THREE.MathUtils.clamp(spec.flight.vMaxKnots * 0.514444 * 0.56, 52, 165);
    const diveMs = THREE.MathUtils.clamp(spec.flight.vMaxKnots * 0.514444 * 0.65, 65, 195);

    if (id === 'rwy17c_takeoff') {
      const distFromCenter = -1820;
      this.pos.set(rwyCenterX + fx * distFromCenter, 0.02, fz * distFromCenter);
      this._euler.set(0, -hRad, 0, 'YXZ');
      this.quat.setFromEuler(this._euler);
      this.vel.set(0, 0, 0);
      this.n1 = 0.24;
      this.gearProgress = 1.0;
      this.flapProgress = spec.flight.hasFlaps ? 15 : 0;
      this.wasOnGround = true;
    } else if (id === 'rwy17c_approach') {
      const distFromCenter = -5200;
      this.pos.set(rwyCenterX + fx * distFromCenter, 220, fz * distFromCenter);
      const pitchRad = THREE.MathUtils.degToRad(spec.flight.isSupersonicDelta ? 2.5 : -2.0);
      this._euler.set(pitchRad, -hRad, 0, 'YXZ');
      this.quat.setFromEuler(this._euler);
      this.vel.set(fx * approachMs, -3.2, fz * approachMs);
      this.n1 = 0.56;
      this.gearProgress = 1.0;
      this.flapProgress = spec.flight.hasFlaps ? 30 : 0;
      this.wasOnGround = false;
    } else if (id === 'low_pass_emergency') {
      this.pos.set(380, 145, -2450);
      this._euler.set(0, -hRad, 0, 'YXZ');
      this.quat.setFromEuler(this._euler);
      this.vel.set(fx * lowPassMs, 0, fz * lowPassMs);
      this.n1 = 0.78;
      this.gearProgress = spec.flight.hasRetractableGear ? 0.0 : 1.0;
      this.flapProgress = 0;
      this.wasOnGround = false;
    } else {
      // high_dive_crash_test
      const distFromCenter = -3350;
      this.pos.set(rwyCenterX + fx * distFromCenter, 540, fz * distFromCenter);
      const pitchRad = THREE.MathUtils.degToRad(-19);
      this._euler.set(pitchRad, -hRad, 0, 'YXZ');
      this.quat.setFromEuler(this._euler);
      this.vel.set(fx * diveMs, -42, fz * diveMs);
      this.n1 = 0.85;
      this.gearProgress = spec.flight.hasRetractableGear ? 0.0 : 1.0;
      this.flapProgress = 0;
      this.wasOnGround = false;
    }
  }

  public step(
    dtRaw: number,
    input: ControlInput,
    rig: LoadedAircraftRig,
    dfw: DfwAirportData,
    softbody: SoftbodyCrashEngine,
    cesiumLatLon: (x: number, z: number) => {lat: number; lon: number},
    cesiumActive: boolean,
    activeLiveryId: string,
    weather: WeatherMode = 'clear',
    emergencies: EmergencyState = NO_EMERGENCIES,
    wind: WindConfig = DEFAULT_WIND,
    variantId?: string,
    variantName?: string,
  ): {
    telemetry: FlightTelemetry;
    touchdownImpulse: number;
    scraping: boolean;
    scrapeIntensity: number;
    secondaryImpactIntensity: number;
    partDetachedThisStep: boolean;
  } {
    const dt = Math.min(dtRaw, 0.033);
    this.stormClock += dt;
    const f = rig.spec.flight;
    const crashed = softbody.crashed;
    const mass = f.massKg;
    const massScale = Math.max(0.014, mass / 76000);
    const hydFail = emergencies.hydraulicFailure;

    // Update gear contact offsets from true 3D tire bounds (fallback to catalog dimensions)
    if (rig.gearContactPoints) {
      this._noseOffset.copy(rig.gearContactPoints.nose);
      this._lMainOffset.copy(rig.gearContactPoints.left);
      this._rMainOffset.copy(rig.gearContactPoints.right);
    } else {
      this._noseOffset.set(0, 0, -f.gearWheelbaseM * 0.62);
      this._lMainOffset.set(-f.gearTrackM * 0.5, 0, f.gearWheelbaseM * 0.38);
      this._rMainOffset.set(f.gearTrackM * 0.5, 0, f.gearWheelbaseM * 0.38);
    }

    // 1. Engine spool, flaps, gear, spoilers, reversers animation state
    // Hydraulic failure freezes flaps, gear actuators, and speedbrakes in place!
    if (!hydFail) {
      const targetFlap = f.hasFlaps ? FLAP_ANGLES[THREE.MathUtils.clamp(input.flapsIndex, 0, 5)] : 0;
      this.flapProgress = THREE.MathUtils.lerp(this.flapProgress, targetFlap, dt * 1.8);

      const desiredGear = f.hasRetractableGear ? input.gearDown : true;
      const targetGear = this.gearCollapsed ? 0.15 : desiredGear ? 1.0 : 0.0;
      this.gearProgress = THREE.MathUtils.lerp(this.gearProgress, targetGear, dt * (this.gearCollapsed ? 8 : 0.85));

      const targetSpoiler = input.spoilers ? 1.0 : 0.0;
      this.spoilerProgress = THREE.MathUtils.lerp(this.spoilerProgress, targetSpoiler, dt * 6.0);
    }
    const desiredGear = f.hasRetractableGear ? input.gearDown : true;

    const revAllowed = f.hasReverseThrust && input.reverseThrust && !crashed;
    const targetRev = revAllowed ? 1.0 : 0.0;
    this.reverserProgress = THREE.MathUtils.lerp(this.reverserProgress, targetRev, dt * 3.5);

    const engCount = Math.max(1, Math.min(4, f.engineCount));
    let runningEngines = 0;
    for (let e = 0; e < engCount; e++) {
      if (!emergencies.engineFires[e] && !softbody.isPartDetached(`enginePod_${e}`)) {
        runningEngines++;
      }
    }
    const fuelFactor = emergencies.fuelLeak ? 0.68 : 1.0;

    const afterburnerActive =
      !crashed && !revAllowed && runningEngines > 0 && f.afterburnerBoost > 0 && input.throttle > 0.86;
    const targetN1 =
      crashed || runningEngines === 0
        ? 0.0
        : (revAllowed ? 0.78 : 0.22 + input.throttle * 0.8) * (runningEngines / engCount) * fuelFactor;
    this.n1 = THREE.MathUtils.lerp(this.n1, targetN1, dt * (f.isProp ? 2.2 : 1.15));

    // 2. Aircraft body axes & 3D ambient wind air-mass relative velocity
    this._forward.set(0, 0, -1).applyQuaternion(this.quat).normalize();
    this._right.set(1, 0, 0).applyQuaternion(this.quat).normalize();
    this._up.set(0, 1, 0).applyQuaternion(this.quat).normalize();

    const gustWave = Math.sin(this.stormClock * 1.35) * 0.55 + Math.cos(this.stormClock * 2.9) * 0.45;
    const stormWindAdd = weather === 'thunderstorm' ? 6 + gustWave * 5 : 0;
    const effectiveWindKt = Math.max(
      0,
      wind.speedKnots + gustWave * wind.gustsKnots * 0.5 + stormWindAdd,
    );
    const windMs = effectiveWindKt * 0.514444;
    const windDirRad = THREE.MathUtils.degToRad(wind.directionDeg);
    // Meteorological FROM direction -> TO vector in Three.js world (-Z North, +X East)
    this._windVel.set(-Math.sin(windDirRad) * windMs, 0, Math.cos(windDirRad) * windMs);
    this._airVel.copy(this.vel).sub(this._windVel);

    this._invQuat.copy(this.quat).invert();
    this._localVel.copy(this._airVel).applyQuaternion(this._invQuat);

    const forwardAirspeed = -this._localVel.z;
    const forwardGroundSpeed = -this._rGear.copy(this.vel).applyQuaternion(this._invQuat).z;
    const airspeed = this._airVel.length();
    const altM = Math.max(0, this.pos.y);
    const airDensity = 1.225 * Math.exp(-altM / 8500);
    const speedOfSound = 340.3 * Math.sqrt(Math.max(0.75, 1 - 0.0000226 * Math.min(altM, 11000)));
    const mach = airspeed / speedOfSound;
    const qDyn = 0.5 * airDensity * airspeed * airspeed;

    // Angle of attack & sideslip (relative to moving air mass)
    const aoaRad = airspeed > 2 ? Math.atan2(-this._localVel.y, Math.max(1, forwardAirspeed)) : 0;
    this.aoaDeg = THREE.MathUtils.radToDeg(aoaRad);
    const betaRad = airspeed > 2 ? Math.atan2(this._localVel.x, Math.max(1, airspeed)) : 0;

    // 3. Aerodynamic forces (Lift, Drag, Sideforce) & Control Torques
    this._force.set(0, -mass * 9.81, 0);
    this._torque.set(0, 0, 0);

    const rwyInfo = dfw.isPointOnRunway(this.pos.x, this.pos.z);
    const groundH = dfw.getGroundElevation(this.pos.x, this.pos.z);
    const agl = Math.max(0, this.pos.y - groundH);

    // Ground effect boost
    const groundEffectSpan = Math.max(6, f.wingspanM * 0.45);
    const groundEffect = agl < groundEffectSpan ? 1.0 + 0.24 * Math.pow(1 - agl / groundEffectSpan, 1.5) : 1.0;

    // Lift coefficient (including delta vortex lift for Concorde / F-16)
    const flapFrac = f.hasFlaps ? this.flapProgress / 40.0 : 0;
    const stallAoa = f.stallAoaDeg - flapFrac * 2.2;
    let cl = f.clZero + this.aoaDeg * f.clAlphaPerDeg + flapFrac * f.clFlapMax;
    if (f.isSupersonicDelta && this.aoaDeg > 4) {
      const s = Math.sin(aoaRad);
      cl += s * s * 1.45;
    }

    let stallWarning = false;
    const stallThresholdSpeed = f.approachSpeedKnots * 0.514444 * 0.72;
    if (Math.abs(this.aoaDeg) > stallAoa && airspeed > stallThresholdSpeed) {
      stallWarning = true;
      const postStall = Math.abs(this.aoaDeg) - stallAoa;
      cl = Math.max(0.18, cl - postStall * 0.13);
    }
    cl *= groundEffect;
    cl *= 1.0 - this.spoilerProgress * 0.35;

    // Drag coefficient + Transonic/Supersonic wave drag
    const machCrit = f.isSupersonicDelta ? 1.02 : Math.max(0.55, f.cruiseMach - 0.04);
    let cdWave = 0;
    if (mach > machCrit) {
      const dm = mach - machCrit;
      cdWave = f.isSupersonicDelta ? 0.018 * Math.min(1.8, dm) : 0.28 * dm * dm;
    }
    const cd0 =
      f.cdZero +
      this.gearProgress * (f.hasRetractableGear ? 0.022 : 0.008) +
      flapFrac * 0.062 +
      this.spoilerProgress * 0.095 +
      cdWave;
    const cdInduced = (cl * cl) / (Math.PI * f.aspectRatio * f.oswaldE);
    const cd = cd0 + cdInduced + Math.abs(Math.sin(betaRad)) * 0.35;

    // Structural wing/tail damage modifies aerodynamic lift & asymmetric roll moment!
    const leftWingIntact = softbody.getWingIntactFraction(-1);
    const rightWingIntact = softbody.getWingIntactFraction(1);
    const totalWingIntact = (leftWingIntact + rightWingIntact) * 0.5;
    const tailIntegrity = softbody.getTailIntegrityFactor();

    const liftMag = qDyn * f.wingAreaM2 * cl * totalWingIntact;
    const dragMag = qDyn * f.wingAreaM2 * (cd + (1 - totalWingIntact) * 0.25);
    const sideMag = -qDyn * f.wingAreaM2 * betaRad * 1.45 * tailIntegrity.yaw;
    const wingLossRollMoment = (rightWingIntact - leftWingIntact) * liftMag * (f.wingspanM * 0.14);

    this._force.addScaledVector(this._up, liftMag);
    if (airspeed > 0.5) {
      this._force.addScaledVector(this._airVel, -dragMag / airspeed);
    }
    this._force.addScaledVector(this._right, sideMag);

    // Engine Thrust (Jet ram recovery / Afterburner / Prop low-speed lapse / Reverse)
    let thrustAvailable = f.maxThrustN;
    if (f.isProp) {
      const propSpdRatio = THREE.MathUtils.clamp(airspeed / (f.vMaxKnots * 0.514444), 0, 1.35);
      thrustAvailable *= 1.32 - propSpdRatio * 0.72;
    } else if (f.isSupersonicDelta) {
      // Supersonic inlet ram recovery boosts thrust with Mach at altitude
      const ramFactor = 1.0 + Math.min(0.45, mach * 0.22);
      const abFactor = afterburnerActive ? 1.0 + f.afterburnerBoost : 1.0;
      thrustAvailable *= ramFactor * abFactor;
    }
    // Slight high-altitude density thrust lapse tempered for supersonic jets
    const altThrustFactor = f.isSupersonicDelta
      ? Math.pow(airDensity / 1.225, 0.58)
      : Math.pow(airDensity / 1.225, 0.68);
    thrustAvailable *= Math.max(0.24, altThrustFactor);

    const baseThrustMag = crashed
      ? 0
      : this.reverserProgress > 0.3
        ? -f.maxThrustN * 0.42 * this.n1
        : thrustAvailable * Math.pow(Math.max(0.01, this.n1), 1.3);

    // Per-engine thrust & asymmetric yaw/roll moment when any engine has a fire!
    const thrustPerEngine = (baseThrustMag / engCount) * fuelFactor;
    let totalThrustMag = 0;
    let asymYawMoment = 0;
    let asymRollMoment = 0;
    for (let e = 0; e < engCount; e++) {
      if (emergencies.engineFires[e] || softbody.isPartDetached(`enginePod_${e}`)) continue;
      totalThrustMag += thrustPerEngine;
      const cx = rig.engineCenters[e]?.x ?? 0;
      asymYawMoment += cx * thrustPerEngine * 0.42;
      asymRollMoment -= cx * thrustPerEngine * 0.09;
    }
    this._force.addScaledVector(this._forward, totalThrustMag);

    // Inertia tensor dynamically matched to aircraft dimensions & mass
    const Ix = mass * (f.lengthM * f.lengthM * 0.042 + 6);
    const Iy = mass * ((f.lengthM * f.lengthM + f.wingspanM * f.wingspanM) * 0.036 + 6);
    const Iz = mass * (f.wingspanM * f.wingspanM * 0.025 + 4);

    // Control surface torques scaled cleanly to aircraft inertia & reference speed
    const refCtrlSpeed = Math.max(20, f.approachSpeedKnots * 0.514444 * 0.65);
    const ctrlAuthority = THREE.MathUtils.clamp(airspeed / refCtrlSpeed, 0.08, 1.45);
    const hydAuthority = hydFail ? 0.34 : 1.0;
    const pitchInput = crashed ? 0 : input.pitch * hydAuthority;
    const rollInput = crashed ? 0 : input.roll * hydAuthority;
    const yawInput = crashed ? 0 : input.yaw * hydAuthority;
    const runawayTrimBias = !crashed && emergencies.runawayTrim ? -0.36 : 0;

    const pitchStability = -aoaRad * f.pitchStability * ctrlAuthority;
    const yawStability = -betaRad * 1.45 * ctrlAuthority;
    const rollLeveling = -this._right.y * 0.1 * ctrlAuthority;

    const localAngVel = this._rGear.copy(this.angVel).applyQuaternion(this._invQuat);

    // Convective turbulence & crosswind shear during thunderstorms
    let turbPitch = 0;
    let turbRoll = 0;
    let turbYaw = 0;
    if (weather === 'thunderstorm' && !crashed && airspeed > 20) {
      const airStrength = THREE.MathUtils.clamp((airspeed - 20) / 80, 0, 1) * THREE.MathUtils.clamp(agl / 18, 0.25, 1.0);
      const t = this.stormClock;
      const vertGust = (Math.sin(t * 2.7) * 0.55 + Math.cos(t * 6.3) * 0.45) * mass * 2.1 * airStrength;
      const sideGust = (Math.sin(t * 1.9 + 1.1) * 0.65 + Math.cos(t * 4.7) * 0.35) * mass * 1.6 * airStrength;
      this._force.y += vertGust;
      this._force.x += sideGust;
      turbPitch = Math.sin(t * 4.1) * 0.14 * airStrength;
      turbRoll = Math.cos(t * 3.4 + 0.7) * 0.22 * airStrength;
      turbYaw = Math.sin(t * 2.3 + 2.0) * 0.1 * airStrength;
    }

    this._torque.x =
      ((pitchInput * f.pitchAuthority * tailIntegrity.pitch + runawayTrimBias + turbPitch) * ctrlAuthority +
        pitchStability * tailIntegrity.pitch -
        localAngVel.x * (1.7 + ctrlAuthority * 1.4)) *
      (Ix * 0.36);
    this._torque.z =
      ((-rollInput * f.rollAuthority * totalWingIntact + turbRoll) * ctrlAuthority +
        rollLeveling -
        localAngVel.z * (2.2 + ctrlAuthority * 1.8)) *
        (Iz * 0.54) +
      asymRollMoment +
      wingLossRollMoment;
    this._torque.y =
      ((-yawInput * f.yawAuthority * tailIntegrity.yaw + turbYaw) * ctrlAuthority +
        yawStability * tailIntegrity.yaw -
        localAngVel.y * (1.8 + ctrlAuthority * 1.3)) *
        (Iy * 0.22) +
      asymYawMoment;

    // 4. Tricycle Landing Gear Suspension & Ground Handling
    let gearContacts = 0;
    let touchdownImpulse = 0;

    if (this.gearProgress > 0.72 && !this.gearCollapsed) {
      const checkGear = (localOffset: THREE.Vector3, isNose: boolean) => {
        this._gearWorldPt.copy(localOffset).applyQuaternion(this.quat).add(this.pos);
        const pen = groundH - this._gearWorldPt.y;
        if (pen <= 0) return;

        gearContacts++;
        this._rGear.copy(this._gearWorldPt).sub(this.pos);
        this._gearRelVel.copy(this.angVel).cross(this._rGear).add(this.vel);

        const vy = this._gearRelVel.y;
        const kSpring = (isNose ? 1350000 : 3200000) * massScale;
        const cDamp = (isNose ? 185000 : 420000) * massScale;
        const fy = Math.min(mass * 9.81 * 6.5, Math.max(0, pen * kSpring - vy * cDamp));

        const vFwd = this._gearRelVel.dot(this._forward);
        const vSide = this._gearRelVel.dot(this._right);

        const wetRunwayMu = weather === 'thunderstorm' ? 0.36 : weather === 'fog' ? 0.46 : 0.55;
        const brakeMu = input.brakes ? (rwyInfo.onRunway ? wetRunwayMu : 0.72) : rwyInfo.onRunway ? 0.018 : 0.085;
        const fFwd = -THREE.MathUtils.clamp(vFwd * 0.8, -1, 1) * fy * brakeMu;

        let steerAngle = 0;
        if (isNose) {
          steerAngle = -yawInput * THREE.MathUtils.clamp(1.0 - Math.abs(vFwd) / 55, 0.1, 0.55);
        }
        const fSide = -THREE.MathUtils.clamp((vSide - vFwd * Math.sin(steerAngle)) * 0.45, -1.2, 1.2) * fy * 0.9;

        const fx = this._forward.x * fFwd + this._right.x * fSide;
        const fz = this._forward.z * fFwd + this._right.z * fSide;

        this._force.x += fx;
        this._force.y += fy;
        this._force.z += fz;

        this._worldTorque.x += this._rGear.y * fz - this._rGear.z * fy;
        this._worldTorque.y += this._rGear.z * fx - this._rGear.x * fz;
        this._worldTorque.z += this._rGear.x * fy - this._rGear.y * fx;

        if (!this.wasOnGround && vy < -1.8) {
          touchdownImpulse = Math.max(touchdownImpulse, Math.abs(vy));
          softbody.spawnTouchdownSmoke(this._gearWorldPt, this.vel);
        }
        if (f.hasRetractableGear && (Math.abs(vy) > 6.6 || Math.abs(vSide) > 24)) {
          this.gearCollapsed = true;
        }
      };

      this._worldTorque.set(0, 0, 0);
      if (!emergencies.noseGearFailure && !softbody.isPartDetached('noseGear')) {
        checkGear(this._noseOffset, true);
      }
      if (!emergencies.leftGearFailure && !softbody.isPartDetached('leftGear')) {
        checkGear(this._lMainOffset, false);
      }
      if (!emergencies.rightGearFailure && !softbody.isPartDetached('rightGear')) {
        checkGear(this._rMainOffset, false);
      }
    } else {
      this._worldTorque.set(0, 0, 0);
    }

    // 5. Force-Driven Breakup Physics & Ground/Obstacle Structural Contact
    const liftLoadFactor = liftMag / (mass * 9.81);
    const sbResult = softbody.step({
      dt,
      aircraftWorldPos: this.pos,
      aircraftQuat: this.quat,
      aircraftVel: this.vel,
      aircraftAngVel: this.angVel,
      liftLoadFactor,
      onRunway: rwyInfo.onRunway,
      groundElevation: groundH,
      obstacles: dfw.obstacles,
      gearDown: this.gearProgress > 0.72,
      gearCollapsed: this.gearCollapsed || (emergencies.leftGearFailure && emergencies.rightGearFailure),
      gearContacts,
      emergencies,
      windVel: this._windVel,
    });

    if (sbResult.collapseGear && f.hasRetractableGear) {
      this.gearCollapsed = true;
    }

    this._force.add(sbResult.totalImpulse);
    this._worldTorque.add(sbResult.angularImpulse);

    // 6. Integrate Linear & Angular Momentum (transform world contact torques into body frame for true Ix/Iy/Iz)
    this._worldTorque.applyQuaternion(this._invQuat);
    this._torque.add(this._worldTorque);

    this.vel.addScaledVector(this._force, dt / mass);
    this.pos.addScaledVector(this.vel, dt);

    const bothMainsFailed = emergencies.leftGearFailure && emergencies.rightGearFailure;
    const noGearSupport =
      this.gearProgress < 0.72 || this.gearCollapsed || bothMainsFailed || crashed || sbResult.crashed;
    const bellyDropM = Math.min(2.6, Math.max(0.75, f.heightM * 0.145));
    const minFloorY =
      groundH - (noGearSupport ? Math.max(1.2, f.heightM * 0.38) : 0.22);
    if (this.pos.y < minFloorY) {
      this.pos.y = minFloorY;
      if (this.vel.y < 0) this.vel.y = 0;
    }

    this._worldTorque
      .set((this._torque.x / Ix) * dt, (this._torque.y / Iy) * dt, (this._torque.z / Iz) * dt)
      .applyQuaternion(this.quat);
    this.angVel.add(this._worldTorque);
    this.angVel.multiplyScalar(1 - dt * 0.45);
    this.angVel.clampLength(0, 3.6);

    const angSpeed = this.angVel.length();
    if (angSpeed > 0.0001) {
      this._dq.setFromAxisAngle(this._rGear.copy(this.angVel).divideScalar(angSpeed), angSpeed * dt);
      this.quat.premultiply(this._dq).normalize();
    }

    const verticalAccel = (this._force.y / mass + 9.81) / 9.81;
    this.gForce = THREE.MathUtils.lerp(this.gForce, verticalAccel, dt * 12);
    this.peakG = Math.max(this.peakG, Math.abs(this.gForce), sbResult.hardImpactG, softbody.peakG);

    if (sbResult.crashed && this.impactSpeedKnots === 0) {
      this.impactSpeedKnots = Math.round(airspeed * 1.94384);
      this.impactSinkFpm = Math.round(Math.abs(this.vel.y) * 196.85);
    }

    const onGround = gearContacts > 0 || sbResult.groundContacts > 0 || agl < 0.45;
    this.wasOnGround = onGround;

    // 7. Apply Transforms & Animations to the Loaded Pre-Made Aircraft Rig
    rig.root.position.copy(this.pos);
    rig.root.quaternion.copy(this.quat);

    // Drop belly proportionally if all gear collapsed or both mains failed
    rig.airframeGroup.position.y = this.gearCollapsed || bothMainsFailed ? -bellyDropM : 0;

    // Smoothly retract/extend hinged landing gear assemblies & doors (skip detached crash debris!)
    const gearInTransitOrDown = this.gearProgress > 0.12;
    const doorsClosed = this.gearProgress <= 0.15 && !this.gearCollapsed;
    const retractAngle = THREE.MathUtils.clamp((1 - this.gearProgress) / 0.88, 0, 1) * 1.48;

    if (rig.noseGearGroup.parent === rig.airframeGroup) {
      rig.noseGearGroup.visible = this.gearCollapsed || gearInTransitOrDown || emergencies.noseGearFailure;
      rig.noseGearGroup.rotation.x = emergencies.noseGearFailure ? 0.78 : retractAngle;
    }
    if (rig.leftGearGroup.parent === rig.airframeGroup) {
      rig.leftGearGroup.visible = this.gearCollapsed || gearInTransitOrDown || emergencies.leftGearFailure;
      rig.leftGearGroup.rotation.z = emergencies.leftGearFailure ? 0.82 : retractAngle;
    }
    if (rig.rightGearGroup.parent === rig.airframeGroup) {
      rig.rightGearGroup.visible = this.gearCollapsed || gearInTransitOrDown || emergencies.rightGearFailure;
      rig.rightGearGroup.rotation.z = emergencies.rightGearFailure ? -0.82 : -retractAngle;
    }

    for (let d = 0; d < rig.openGearDoorMeshes.length; d++) {
      rig.openGearDoorMeshes[d].visible = gearInTransitOrDown && !this.gearCollapsed;
    }
    for (let d = 0; d < rig.closedGearDoorMeshes.length; d++) {
      rig.closedGearDoorMeshes[d].visible = doorsClosed;
    }

    // Concorde droop nose & visor animation
    if (rig.visorMeshes.length > 0) {
      const droopFactor = desiredGear || airspeed < 128 ? 1 : 0;
      const targetDroop = droopFactor * 0.22;
      for (let v = 0; v < rig.visorMeshes.length; v++) {
        rig.visorMeshes[v].rotation.x = THREE.MathUtils.lerp(
          rig.visorMeshes[v].rotation.x,
          -targetDroop,
          dt * 2.5,
        );
      }
    }

    // Spin jet fans, propellers, & recentered ground wheels cleanly on their axles
    this.fanAngle += (8 + this.n1 * 48) * dt;
    for (let i = 0; i < rig.fanMeshes.length; i++) {
      rig.fanMeshes[i].rotation.z = this.fanAngle;
    }

    this.propAngle += (16 + this.n1 * 68) * dt;
    for (let i = 0; i < rig.propGroups.length; i++) {
      rig.propGroups[i].rotation.z = this.propAngle;
    }

    if (onGround && this.gearProgress > 0.72) {
      this.wheelAngle -= (forwardGroundSpeed / 0.48) * dt;
      for (let w = 0; w < rig.wheelMeshes.length; w++) {
        rig.wheelMeshes[w].rotation.x = this.wheelAngle;
      }
    }

    // Animate 3D Control Surfaces (Flaps, Slats, Ailerons, Elevators, Elevons, Rudder, Spoilers)
    const surfRate = hydFail ? 1.5 : 10.5;
    this.ctrlPitch = THREE.MathUtils.lerp(this.ctrlPitch, pitchInput, dt * surfRate);
    this.ctrlRoll = THREE.MathUtils.lerp(this.ctrlRoll, rollInput, dt * surfRate);
    this.ctrlYaw = THREE.MathUtils.lerp(this.ctrlYaw, yawInput, dt * surfRate);
    const autoSlat = this.aoaDeg > 9.5 && airspeed > 35 ? Math.min(1, (this.aoaDeg - 9.5) / 6) : 0;
    const targetSlat = hydFail ? this.slatFrac : Math.max(flapFrac, autoSlat);
    this.slatFrac = THREE.MathUtils.lerp(this.slatFrac, targetSlat, dt * 2.2);

    for (let c = 0; c < rig.controlSurfaces.length; c++) {
      const cs = rig.controlSurfaces[c];
      if (cs.kind === 'flap') {
        cs.pivot.quaternion.setFromAxisAngle(cs.hingeAxis, flapFrac * 0.56);
        cs.pivot.position.set(
          cs.basePos.x,
          cs.basePos.y - flapFrac * cs.chordM * 0.08,
          cs.basePos.z + flapFrac * cs.chordM * 0.22,
        );
      } else if (cs.kind === 'slat') {
        cs.pivot.quaternion.setFromAxisAngle(cs.hingeAxis, -this.slatFrac * 0.40);
        cs.pivot.position.set(
          cs.basePos.x,
          cs.basePos.y - this.slatFrac * cs.chordM * 0.10,
          cs.basePos.z - this.slatFrac * cs.chordM * 0.24,
        );
      } else if (cs.kind === 'spoiler') {
        const sp = Math.max(this.spoilerProgress, Math.abs(this.ctrlRoll) * (cs.side * this.ctrlRoll > 0.15 ? 0.55 : 0));
        cs.pivot.quaternion.setFromAxisAngle(cs.hingeAxis, -sp * 0.72);
      } else if (cs.kind === 'aileron') {
        cs.pivot.quaternion.setFromAxisAngle(cs.hingeAxis, -cs.side * this.ctrlRoll * 0.44);
      } else if (cs.kind === 'elevator') {
        cs.pivot.quaternion.setFromAxisAngle(cs.hingeAxis, -this.ctrlPitch * 0.42);
      } else if (cs.kind === 'elevon') {
        cs.pivot.quaternion.setFromAxisAngle(cs.hingeAxis, -this.ctrlPitch * 0.34 - cs.side * this.ctrlRoll * 0.32);
      } else if (cs.kind === 'rudder') {
        cs.pivot.quaternion.setFromAxisAngle(cs.hingeAxis, this.ctrlYaw * 0.44);
      }
    }

    // 8. Compute Heading & Telemetry
    this._euler.setFromQuaternion(this.quat, 'YXZ');
    const headingDeg = ((THREE.MathUtils.radToDeg(-this._euler.y) % 360) + 360) % 360;
    const pitchDeg = THREE.MathUtils.radToDeg(this._euler.x);
    const rollDeg = THREE.MathUtils.radToDeg(this._euler.z);

    const iasKnots = Math.round(airspeed * 1.94384 * Math.sqrt(airDensity / 1.225));
    const tasKnots = Math.round(airspeed * 1.94384);
    const groundSpeedKnots = Math.round(Math.hypot(this.vel.x, this.vel.z) * 1.94384);
    this._fwdHoriz.set(this._forward.x, 0, this._forward.z);
    if (this._fwdHoriz.lengthSq() > 1e-6) this._fwdHoriz.normalize();
    this._rightHoriz.set(this._right.x, 0, this._right.z);
    if (this._rightHoriz.lengthSq() > 1e-6) this._rightHoriz.normalize();
    const headwindKnots = Math.round(-this._windVel.dot(this._fwdHoriz) * 1.94384);
    const crosswindKnots = Math.round(-this._windVel.dot(this._rightHoriz) * 1.94384);

    const vsFpm = Math.round(this.vel.y * 196.85);
    const altAglFt = Math.round(agl * 3.28084);
    const altMslFt = Math.round((this.pos.y + 185.0) * 3.28084);
    const gpwsWarning = !onGround && altAglFt < 450 && vsFpm < -1100 && !crashed;
    const geoLatLon = cesiumLatLon(this.pos.x, this.pos.z);

    const activeLiv = rig.spec.liveries.find((l) => l.id === activeLiveryId) ?? rig.spec.liveries[0];

    const activeWarnings: string[] = [];
    for (let e = 0; e < engCount; e++) {
      if (emergencies.engineFires[e]) activeWarnings.push(`ENG ${e + 1} FIRE`);
    }
    if (emergencies.hydraulicFailure) activeWarnings.push('HYD SYS FAIL');
    if (emergencies.noseGearFailure) activeWarnings.push('NOSE GEAR FAIL');
    if (emergencies.leftGearFailure) activeWarnings.push('L MAIN GEAR FAIL');
    if (emergencies.rightGearFailure) activeWarnings.push('R MAIN GEAR FAIL');
    if (emergencies.electricalFailure) activeWarnings.push('ELEC BUS OFF');
    if (emergencies.pressurizationFailure) activeWarnings.push('CABIN ALTITUDE');
    if (emergencies.fuelLeak) activeWarnings.push('FUEL LEAK');
    if (emergencies.runawayTrim) activeWarnings.push('TRIM RUNAWAY');
    if (emergencies.birdStrikeCount > 0) {
      activeWarnings.push(
        emergencies.birdStrikeCount > 1 ? `BIRD STRIKE x${emergencies.birdStrikeCount}` : 'BIRD STRIKE',
      );
    }

    return {
      telemetry: {
        aircraftId: rig.spec.id,
        variantId: variantId ?? rig.variantId,
        variantName: variantName ?? rig.spec.shortName,
        aircraftName: rig.spec.name,
        aircraftShortName: rig.spec.shortName,
        liveryId: activeLiv.id,
        liveryCarrier: activeLiv.carrier,
        iasKnots,
        tasKnots,
        mach: Math.round(mach * 100) / 100,
        groundSpeedKnots,
        headwindKnots,
        crosswindKnots,
        altitudeFtMSL: altMslFt,
        altitudeFtAGL: altAglFt,
        verticalSpeedFpm: vsFpm,
        headingDeg: Math.round(headingDeg) === 360 ? 0 : Math.round(headingDeg),
        pitchDeg: Math.round(pitchDeg * 10) / 10,
        rollDeg: Math.round(rollDeg * 10) / 10,
        aoaDeg: Math.round(this.aoaDeg * 10) / 10,
        gForce: Math.round(this.gForce * 10) / 10,
        peakGForce: Math.round(this.peakG * 10) / 10,
        n1Percent: Math.round(this.n1 * 100),
        afterburnerActive,
        flapsDeg: Math.round(this.flapProgress),
        hasFlaps: f.hasFlaps,
        gearDown: desiredGear,
        hasRetractableGear: f.hasRetractableGear,
        gearCollapsed: this.gearCollapsed || bothMainsFailed,
        spoilersDeployed: this.spoilerProgress > 0.5,
        reverseActive: this.reverserProgress > 0.3,
        hasReverseThrust: f.hasReverseThrust,
        braking: input.brakes && onGround,
        onGround,
        onRunway: rwyInfo.onRunway,
        runwayName: rwyInfo.runwayName,
        stallWarning,
        gpwsWarning,
        integrityPercent: sbResult.integrityPercent,
        zones: sbResult.zones,
        detachedParts: sbResult.detachedParts,
        fragmentCount: sbResult.fragmentCount,
        emergencies,
        activeWarnings,
        crashed: sbResult.crashed,
        crashReason: sbResult.crashReason,
        impactSpeedKnots: this.impactSpeedKnots,
        impactSinkFpm: this.impactSinkFpm,
        cesiumActive,
        lat: geoLatLon.lat,
        lon: geoLatLon.lon,
      },
      touchdownImpulse,
      scraping: sbResult.scraping,
      scrapeIntensity: sbResult.scrapeIntensity,
      secondaryImpactIntensity: sbResult.secondaryImpactIntensity,
      partDetachedThisStep: sbResult.partDetachedThisStep,
    };
  }
}
