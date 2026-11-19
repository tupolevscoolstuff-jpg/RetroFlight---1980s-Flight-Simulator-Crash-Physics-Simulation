export type CameraMode = 'chase' | 'wing' | 'cockpit' | 'tower' | 'orbit';

export type ScenarioId =
  | 'rwy17c_takeoff'
  | 'rwy17c_approach'
  | 'low_pass_emergency'
  | 'high_dive_crash_test';

export type TimeOfDay = 'day' | 'golden' | 'dusk';

export type WeatherMode = 'clear' | 'fog' | 'thunderstorm';

export type AircraftId =
  | 'b727'
  | 'concorde'
  | 'b747'
  | 'l1011'
  | 'dc10'
  | 'b767'
  | 'b757'
  | 'b737'
  | 'dc9'
  | 'md80'
  | 'b707'
  | 'a310'
  | 'caravelle'
  | 'atr42'
  | 'citation'
  | 'c172'
  | 'f16';

export type AircraftCategory =
  | 'Supersonic'
  | 'Widebody'
  | 'Narrowbody'
  | 'Regional & GA'
  | 'Military';

export type EngineAudioProfile =
  | 'trijet'
  | 'widebody'
  | 'supersonic'
  | 'turboprop'
  | 'piston'
  | 'fighter';

export interface ControlInput {
  pitch: number; // -1 (nose down) to +1 (nose up)
  roll: number; // -1 (left) to +1 (right)
  yaw: number; // -1 (left) to +1 (right)
  throttle: number; // 0 to 1
  reverseThrust: boolean;
  flapsIndex: number; // 0..5
  gearDown: boolean;
  spoilers: boolean;
  brakes: boolean;
}

export interface StructuralZoneHealth {
  nose: number; // 0..100
  fuselage: number;
  leftWing: number;
  rightWing: number;
  tail: number;
  engines: number;
  gear: number;
}

export interface EmergencyState {
  birdStrikeCount: number;
  hydraulicFailure: boolean;
  noseGearFailure: boolean;
  leftGearFailure: boolean;
  rightGearFailure: boolean;
  engineFires: [boolean, boolean, boolean, boolean];
  electricalFailure: boolean;
  pressurizationFailure: boolean;
  fuelLeak: boolean;
  runawayTrim: boolean;
}

export interface WindConfig {
  speedKnots: number; // 0..55
  directionDeg: number; // 0..359 (FROM direction)
  gustsKnots: number; // 0..25
}

export interface BreakablePartInfo {
  key: string;
  label: string;
  zone: keyof StructuralZoneHealth;
  detached: boolean;
}

export interface FlightTelemetry {
  aircraftId: AircraftId;
  variantId: string;
  variantName: string;
  aircraftName: string;
  aircraftShortName: string;
  liveryId: string;
  liveryCarrier: string;
  iasKnots: number;
  tasKnots: number;
  mach: number;
  groundSpeedKnots: number;
  headwindKnots: number;
  crosswindKnots: number;
  altitudeFtMSL: number;
  altitudeFtAGL: number;
  verticalSpeedFpm: number;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  aoaDeg: number;
  gForce: number;
  peakGForce: number;
  n1Percent: number;
  afterburnerActive: boolean;
  flapsDeg: number;
  hasFlaps: boolean;
  gearDown: boolean;
  hasRetractableGear: boolean;
  gearCollapsed: boolean;
  spoilersDeployed: boolean;
  reverseActive: boolean;
  hasReverseThrust: boolean;
  braking: boolean;
  onGround: boolean;
  onRunway: boolean;
  runwayName: string;
  stallWarning: boolean;
  gpwsWarning: boolean;
  integrityPercent: number;
  zones: StructuralZoneHealth;
  detachedParts: string[];
  fragmentCount: number;
  emergencies: EmergencyState;
  activeWarnings: string[];
  crashed: boolean;
  crashReason: string;
  impactSpeedKnots: number;
  impactSinkFpm: number;
  cesiumActive: boolean;
  lat: number;
  lon: number;
}

