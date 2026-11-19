/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {useCallback, useEffect, useRef, useState} from 'react';
import {Scissors, Wrench, X} from 'lucide-react';
import {AircraftHangarModal} from './components/AircraftHangarModal';
import {EmergencyPanel} from './components/EmergencyPanel';
import {FlightHudBar} from './components/FlightHudBar';
import {FlightViewport, SimCommandBridge} from './components/FlightViewport';
import {MobileFlightControls} from './components/MobileFlightControls';
import {WindPanel} from './components/WindPanel';
import {getAircraftById, resolveAircraftVariant} from './sim/aircraftCatalog';
import {ProceduralFlightAudio} from './sim/audioEngine';
import {DFW_ORIGIN_LAT, DFW_ORIGIN_LON} from './sim/cesiumBridge';
import {DEFAULT_WIND} from './sim/flightDynamics';
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
} from './sim/types';

const CAMERA_SEQUENCE: CameraMode[] = ['chase', 'wing', 'cockpit', 'tower', 'orbit'];
const TIME_SEQUENCE: TimeOfDay[] = ['day', 'golden', 'dusk'];
const WEATHER_SEQUENCE: WeatherMode[] = ['clear', 'fog', 'thunderstorm'];

const INITIAL_EMERGENCIES: EmergencyState = {
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

const INITIAL_TELEMETRY: FlightTelemetry = {
  aircraftId: 'b727',
  variantId: '727-200adv',
  variantName: '727-200 Advanced',
  aircraftName: 'Boeing 727-200 Advanced',
  aircraftShortName: 'Boeing 727-200',
  liveryId: 'dal80',
  liveryCarrier: 'Delta Air Lines',
  iasKnots: 0,
  tasKnots: 0,
  mach: 0,
  groundSpeedKnots: 0,
  headwindKnots: DEFAULT_WIND.speedKnots,
  crosswindKnots: 0,
  altitudeFtMSL: 607,
  altitudeFtAGL: 0,
  verticalSpeedFpm: 0,
  headingDeg: 180,
  pitchDeg: 0,
  rollDeg: 0,
  aoaDeg: 0,
  gForce: 1.0,
  peakGForce: 1.0,
  n1Percent: 24,
  afterburnerActive: false,
  flapsDeg: 15,
  hasFlaps: true,
  gearDown: true,
  hasRetractableGear: true,
  gearCollapsed: false,
  spoilersDeployed: false,
  reverseActive: false,
  hasReverseThrust: true,
  braking: false,
  onGround: true,
  onRunway: true,
  runwayName: '17C/35C',
  stallWarning: false,
  gpwsWarning: false,
  integrityPercent: 100,
  zones: {
    nose: 100,
    fuselage: 100,
    leftWing: 100,
    rightWing: 100,
    tail: 100,
    engines: 100,
    gear: 100,
  },
  detachedParts: [],
  fragmentCount: 0,
  emergencies: INITIAL_EMERGENCIES,
  activeWarnings: [],
  crashed: false,
  crashReason: '',
  impactSpeedKnots: 0,
  impactSinkFpm: 0,
  cesiumActive: true,
  lat: DFW_ORIGIN_LAT,
  lon: DFW_ORIGIN_LON,
};

function getScenarioDefaultInput(id: ScenarioId, aircraftId: AircraftId, variantId?: string): ControlInput {
  const {spec} = resolveAircraftVariant(getAircraftById(aircraftId), variantId);
  const f = spec.flight;
  if (id === 'rwy17c_takeoff') {
    return {
      pitch: 0,
      roll: 0,
      yaw: 0,
      throttle: 0,
      reverseThrust: false,
      flapsIndex: f.hasFlaps ? 2 : 0,
      gearDown: true,
      spoilers: false,
      brakes: false,
    };
  }
  if (id === 'rwy17c_approach') {
    return {
      pitch: 0,
      roll: 0,
      yaw: 0,
      throttle: 0.48,
      reverseThrust: false,
      flapsIndex: f.hasFlaps ? 4 : 0,
      gearDown: true,
      spoilers: false,
      brakes: false,
    };
  }
  return {
    pitch: 0,
    roll: 0,
    yaw: 0,
    throttle: 0.8,
    reverseThrust: false,
    flapsIndex: 0,
    gearDown: !f.hasRetractableGear,
    spoilers: false,
    brakes: false,
  };
}

export default function App() {
  const [aircraftId, setAircraftId] = useState<AircraftId>('b727');
  const [variantId, setVariantId] = useState<string>('727-200adv');
  const [liveryId, setLiveryId] = useState<string>('dal80');
  const [hangarOpen, setHangarOpen] = useState(false);

  const [scenario, setScenario] = useState<ScenarioId>('rwy17c_takeoff');
  const [cameraMode, setCameraMode] = useState<CameraMode>('chase');
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>('day');
  const [weatherMode, setWeatherMode] = useState<WeatherMode>('clear');
  const [muted, setMuted] = useState(false);
  const [dockExpanded, setDockExpanded] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [windOpen, setWindOpen] = useState(false);
  const [breakMode, setBreakMode] = useState(false);
  const [hoveredBreakPart, setHoveredBreakPart] = useState<{key: string; label: string} | null>(null);
  const [breakableParts, setBreakableParts] = useState<BreakablePartInfo[]>([]);
  const [telemetry, setTelemetry] = useState<FlightTelemetry>(INITIAL_TELEMETRY);

  const [windConfig, setWindConfig] = useState<WindConfig>(DEFAULT_WIND);
  const windRef = useRef<WindConfig>(DEFAULT_WIND);

  const [emergencies, setEmergencies] = useState<EmergencyState>(INITIAL_EMERGENCIES);
  const emergenciesRef = useRef<EmergencyState>(INITIAL_EMERGENCIES);

  const [inputState, setInputState] = useState<ControlInput>(() =>
    getScenarioDefaultInput('rwy17c_takeoff', 'b727', '727-200adv'),
  );
  const inputRef = useRef<ControlInput>(
    getScenarioDefaultInput('rwy17c_takeoff', 'b727', '727-200adv'),
  );
  const commandBridgeRef = useRef<SimCommandBridge | null>(null);
  const audioRef = useRef<ProceduralFlightAudio | null>(null);
  const keysDown = useRef<Set<string>>(new Set());

  const {spec: activeSpec} = resolveAircraftVariant(getAircraftById(aircraftId), variantId);

  const handleWindChange = useCallback((next: WindConfig) => {
    windRef.current = next;
    setWindConfig(next);
  }, []);

  const commitEmergencies = useCallback((next: EmergencyState) => {
    emergenciesRef.current = next;
    setEmergencies(next);
  }, []);

  const clearAllEmergencies = useCallback(() => {
    commitEmergencies({
      ...INITIAL_EMERGENCIES,
      engineFires: [false, false, false, false],
    });
  }, [commitEmergencies]);

  const updateInput = useCallback((patch: Partial<ControlInput>) => {
    const next = {...inputRef.current, ...patch};
    inputRef.current = next;
    setInputState(next);
  }, []);

  const unlockAudio = useCallback(() => {
    audioRef.current?.unlock();
  }, []);

  const toggleBreakMode = useCallback(() => {
    unlockAudio();
    setBreakMode((prev) => {
      const next = !prev;
      if (next) {
        setWindOpen(false);
        setEmergencyOpen(false);
        setShowHelp(false);
        setCameraMode((cam) => (cam === 'cockpit' ? 'orbit' : cam));
        if (commandBridgeRef.current) {
          setBreakableParts(commandBridgeRef.current.getBreakableParts());
        }
      } else {
        setHoveredBreakPart(null);
      }
      return next;
    });
  }, [unlockAudio]);

  const handleToggleEmergency = useCallback(
    (
      key:
        | 'hydraulicFailure'
        | 'noseGearFailure'
        | 'leftGearFailure'
        | 'rightGearFailure'
        | 'electricalFailure'
        | 'pressurizationFailure'
        | 'fuelLeak'
        | 'runawayTrim',
    ) => {
      unlockAudio();
      const prev = emergenciesRef.current;
      const nextVal = !prev[key];
      const next = {...prev, [key]: nextVal};
      commitEmergencies(next);
      if (nextVal && !next.electricalFailure) {
        audioRef.current?.playCautionChime();
      }
    },
    [commitEmergencies, unlockAudio],
  );

  const handleToggleEngineFire = useCallback(
    (engineIndex: 0 | 1 | 2 | 3) => {
      unlockAudio();
      const prev = emergenciesRef.current;
      const fires: [boolean, boolean, boolean, boolean] = [...prev.engineFires];
      fires[engineIndex] = !fires[engineIndex];
      const next = {...prev, engineFires: fires};
      commitEmergencies(next);
      if (fires[engineIndex] && !next.electricalFailure) {
        audioRef.current?.playFireBell();
      }
    },
    [commitEmergencies, unlockAudio],
  );

  const handleTriggerBirdStrike = useCallback(() => {
    unlockAudio();
    commandBridgeRef.current?.triggerBirdStrike();
    const prev = emergenciesRef.current;
    const fires: [boolean, boolean, boolean, boolean] = [...prev.engineFires];
    let ignited = false;
    if (Math.random() < 0.45) {
      const engIdx = Math.floor(Math.random() * Math.max(1, Math.min(4, activeSpec.flight.engineCount)));
      if (!fires[engIdx]) {
        fires[engIdx] = true;
        ignited = true;
      }
    }
    commitEmergencies({
      ...prev,
      birdStrikeCount: prev.birdStrikeCount + 1,
      engineFires: fires,
    });
    if (ignited && !prev.electricalFailure) {
      audioRef.current?.playFireBell();
    }
  }, [activeSpec.flight.engineCount, commitEmergencies, unlockAudio]);

  const handleTriggerRandomEmergency = useCallback(() => {
    unlockAudio();
    const prev = emergenciesRef.current;
    const engCount = Math.max(1, Math.min(4, activeSpec.flight.engineCount));
    const actions: Array<() => void> = [
      () => handleTriggerBirdStrike(),
      () => {
        if (!prev.hydraulicFailure) handleToggleEmergency('hydraulicFailure');
      },
      () => {
        if (!prev.noseGearFailure) handleToggleEmergency('noseGearFailure');
      },
      () => {
        if (!prev.leftGearFailure) handleToggleEmergency('leftGearFailure');
      },
      () => {
        if (!prev.rightGearFailure) handleToggleEmergency('rightGearFailure');
      },
      () => {
        if (!prev.electricalFailure) handleToggleEmergency('electricalFailure');
      },
      () => {
        if (!prev.fuelLeak) handleToggleEmergency('fuelLeak');
      },
      () => {
        if (!prev.runawayTrim) handleToggleEmergency('runawayTrim');
      },
      () => {
        if (!prev.pressurizationFailure) handleToggleEmergency('pressurizationFailure');
      },
    ];
    for (let i = 0; i < engCount; i++) {
      if (!prev.engineFires[i]) {
        actions.push(() => handleToggleEngineFire(i as 0 | 1 | 2 | 3));
      }
    }
    const pick = actions[Math.floor(Math.random() * actions.length)];
    pick();
  }, [
    activeSpec.flight.engineCount,
    handleToggleEmergency,
    handleToggleEngineFire,
    handleTriggerBirdStrike,
    unlockAudio,
  ]);

  const handleSelectScenario = useCallback(
    (id: ScenarioId) => {
      unlockAudio();
      clearAllEmergencies();
      const defaults = getScenarioDefaultInput(id, aircraftId, variantId);
      inputRef.current = defaults;
      setInputState(defaults);
      setScenario(id);
      commandBridgeRef.current?.loadScenario(id);
    },
    [unlockAudio, clearAllEmergencies, aircraftId, variantId],
  );

  const handleSelectAircraftVariantAndLivery = useCallback(
    (nextAircraftId: AircraftId, nextVariantId: string, nextLiveryId: string) => {
      unlockAudio();
      if (nextAircraftId === aircraftId && nextVariantId === variantId) {
        setLiveryId(nextLiveryId);
        void commandBridgeRef.current?.selectLivery(nextLiveryId);
        return;
      }
      clearAllEmergencies();
      const defaults = getScenarioDefaultInput(scenario, nextAircraftId, nextVariantId);
      inputRef.current = defaults;
      setInputState(defaults);
      setAircraftId(nextAircraftId);
      setVariantId(nextVariantId);
      setLiveryId(nextLiveryId);
      void commandBridgeRef.current?.selectAircraft(
        nextAircraftId,
        nextVariantId,
        nextLiveryId,
        scenario,
      );
    },
    [aircraftId, variantId, scenario, unlockAudio, clearAllEmergencies],
  );

  const handleSelectLiveryOnly = useCallback(
    (nextLiveryId: string) => {
      unlockAudio();
      setLiveryId(nextLiveryId);
      void commandBridgeRef.current?.selectLivery(nextLiveryId);
    },
    [unlockAudio],
  );

  const handleReset = useCallback(() => {
    handleSelectScenario(scenario);
  }, [handleSelectScenario, scenario]);

  const handleRepair = useCallback(() => {
    unlockAudio();
    clearAllEmergencies();
    commandBridgeRef.current?.repairAircraft();
  }, [unlockAudio, clearAllEmergencies]);

  const cycleCamera = useCallback(() => {
    unlockAudio();
    setCameraMode((prev) => {
      const idx = CAMERA_SEQUENCE.indexOf(prev);
      return CAMERA_SEQUENCE[(idx + 1) % CAMERA_SEQUENCE.length];
    });
  }, [unlockAudio]);

  const cycleTime = useCallback(() => {
    unlockAudio();
    setTimeOfDay((prev) => {
      const idx = TIME_SEQUENCE.indexOf(prev);
      return TIME_SEQUENCE[(idx + 1) % TIME_SEQUENCE.length];
    });
  }, [unlockAudio]);

  const cycleWeather = useCallback(() => {
    unlockAudio();
    setWeatherMode((prev) => {
      const idx = WEATHER_SEQUENCE.indexOf(prev);
      return WEATHER_SEQUENCE[(idx + 1) % WEATHER_SEQUENCE.length];
    });
  }, [unlockAudio]);

  useEffect(() => {
    const recomputeAxesFromKeys = () => {
      const k = keysDown.current;
      let pitch = 0;
      let roll = 0;
      let yaw = 0;
      if (k.has('KeyS') || k.has('ArrowDown')) pitch += 1;
      if (k.has('KeyW') || k.has('ArrowUp')) pitch -= 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) roll -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) roll += 1;
      if (k.has('KeyQ')) yaw -= 1;
      if (k.has('KeyE')) yaw += 1;

      inputRef.current.pitch = pitch;
      inputRef.current.roll = roll;
      inputRef.current.yaw = yaw;
      inputRef.current.brakes = k.has('KeyB');
      setInputState({...inputRef.current});
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return;
      audioRef.current?.unlock();
      keysDown.current.add(e.code);

      if (e.code === 'KeyG' && !e.repeat) {
        updateInput({gearDown: !inputRef.current.gearDown});
      } else if (e.code === 'KeyF' && !e.repeat) {
        updateInput({flapsIndex: Math.min(5, inputRef.current.flapsIndex + 1)});
      } else if (e.code === 'KeyV' && !e.repeat) {
        updateInput({flapsIndex: Math.max(0, inputRef.current.flapsIndex - 1)});
      } else if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        updateInput({spoilers: !inputRef.current.spoilers});
      } else if (e.code === 'KeyX' && !e.repeat) {
        const nextRev = !inputRef.current.reverseThrust;
        updateInput({reverseThrust: nextRev, throttle: nextRev ? 0 : inputRef.current.throttle});
      } else if (e.code === 'KeyC' && !e.repeat) {
        cycleCamera();
      } else if (e.code === 'KeyM' && !e.repeat) {
        cycleWeather();
      } else if (e.code === 'KeyK' && !e.repeat) {
        toggleBreakMode();
      } else if (e.code === 'KeyH' && !e.repeat) {
        setDockExpanded((v) => !v);
      } else if (e.code === 'KeyR' && !e.repeat) {
        handleReset();
      } else {
        recomputeAxesFromKeys();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysDown.current.delete(e.code);
      recomputeAxesFromKeys();
    };

    const throttleTimer = window.setInterval(() => {
      const k = keysDown.current;
      let delta = 0;
      if (k.has('ShiftLeft') || k.has('ShiftRight')) delta += 0.03;
      if (k.has('ControlLeft') || k.has('ControlRight')) delta -= 0.03;
      if (delta !== 0) {
        const nextThr = Math.max(0, Math.min(1, inputRef.current.throttle + delta));
        updateInput({
          throttle: nextThr,
          reverseThrust: nextThr > 0.03 ? false : inputRef.current.reverseThrust,
        });
      }
    }, 30);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.clearInterval(throttleTimer);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [cycleCamera, cycleWeather, handleReset, toggleBreakMode, updateInput]);

  const activeEmergencyCount =
    emergencies.engineFires.slice(0, activeSpec.flight.engineCount).filter(Boolean).length +
    (emergencies.hydraulicFailure ? 1 : 0) +
    (emergencies.noseGearFailure ? 1 : 0) +
    (emergencies.leftGearFailure ? 1 : 0) +
    (emergencies.rightGearFailure ? 1 : 0) +
    (emergencies.electricalFailure ? 1 : 0) +
    (emergencies.pressurizationFailure ? 1 : 0) +
    (emergencies.fuelLeak ? 1 : 0) +
    (emergencies.runawayTrim ? 1 : 0) +
    (emergencies.birdStrikeCount > 0 ? 1 : 0);

  return (
    <main className="relative w-full h-full overflow-hidden bg-[#090d14]">
      <FlightViewport
        inputRef={inputRef}
        emergenciesRef={emergenciesRef}
        windRef={windRef}
        cameraMode={cameraMode}
        timeOfDay={timeOfDay}
        weatherMode={weatherMode}
        muted={muted}
        breakMode={breakMode}
        initialScenario="rwy17c_takeoff"
        initialAircraftId="b727"
        initialVariantId="727-200adv"
        initialLiveryId="dal80"
        onTelemetry={setTelemetry}
        onHoveredPartChange={setHoveredBreakPart}
        onBreakablePartsChange={setBreakableParts}
        commandBridgeRef={commandBridgeRef}
        audioRef={audioRef}
      />

      <FlightHudBar
        telemetry={telemetry}
        activeAircraftId={aircraftId}
        activeLiveryId={liveryId}
        onOpenHangar={() => {
          unlockAudio();
          setHangarOpen(true);
        }}
        onSelectLivery={handleSelectLiveryOnly}
        cameraMode={cameraMode}
        onCycleCamera={cycleCamera}
        scenario={scenario}
        onSelectScenario={handleSelectScenario}
        timeOfDay={timeOfDay}
        onCycleTimeOfDay={cycleTime}
        weatherMode={weatherMode}
        onCycleWeather={cycleWeather}
        windConfig={windConfig}
        windOpen={windOpen}
        onToggleWind={() => {
          unlockAudio();
          setWindOpen((v) => {
            const next = !v;
            if (next) {
              setEmergencyOpen(false);
              setShowHelp(false);
              setBreakMode(false);
              setHoveredBreakPart(null);
            }
            return next;
          });
        }}
        breakMode={breakMode}
        onToggleBreakMode={toggleBreakMode}
        activeEmergencyCount={activeEmergencyCount}
        emergencyOpen={emergencyOpen}
        onToggleEmergency={() => {
          unlockAudio();
          setEmergencyOpen((v) => {
            const next = !v;
            if (next) {
              setWindOpen(false);
              setShowHelp(false);
              setBreakMode(false);
              setHoveredBreakPart(null);
            }
            return next;
          });
        }}
        muted={muted}
        onToggleMute={() => {
          unlockAudio();
          setMuted((m) => !m);
        }}
        onReset={handleReset}
        showHelp={showHelp}
        onToggleHelp={() => {
          setShowHelp((h) => {
            const next = !h;
            if (next) {
              setEmergencyOpen(false);
              setWindOpen(false);
              setBreakMode(false);
              setHoveredBreakPart(null);
            }
            return next;
          });
        }}
        centerSlot={
          breakMode ? (
            <div className="pointer-events-auto w-full max-w-xl rounded-xl border border-amber-400/50 bg-[#0d121d]/94 px-3 py-2 text-xs text-slate-100 shadow-2xl">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <Scissors className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                  <span className="font-semibold text-amber-100 truncate">
                    {hoveredBreakPart
                      ? `Target: ${hoveredBreakPart.label} (Click to Shear Off)`
                      : 'Break-Up Mode: Click/Tap any part on the plane to detach'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={handleRepair}
                    className="px-2 py-1 rounded-md border border-emerald-400/40 bg-emerald-950/60 hover:bg-emerald-900/75 text-[11px] font-medium text-emerald-100 flex items-center gap-1 whitespace-nowrap"
                  >
                    <Wrench className="w-3 h-3" />
                    <span>Repair</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBreakMode(false);
                      setHoveredBreakPart(null);
                    }}
                    aria-label="Exit Break-Up Mode"
                    className="px-2 py-1 rounded-md border border-white/15 bg-[#121926] hover:bg-slate-800 text-[11px] text-slate-200 flex items-center gap-1 whitespace-nowrap"
                  >
                    <X className="w-3 h-3" />
                    <span>Done</span>
                  </button>
                </div>
              </div>
              {breakableParts.length > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                  {breakableParts.map((part) => (
                    <button
                      key={part.key}
                      type="button"
                      disabled={part.detached}
                      onClick={() => commandBridgeRef.current?.detachPart(part.key)}
                      className={`px-2 py-1 rounded-md border text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors ${
                        part.detached
                          ? 'border-white/5 bg-black/30 text-slate-500 line-through cursor-not-allowed'
                          : hoveredBreakPart?.key === part.key
                            ? 'border-amber-300 bg-amber-600 text-white'
                            : 'border-white/15 bg-[#141d2e] hover:bg-red-950/75 hover:border-red-400/50 text-slate-200'
                      }`}
                    >
                      {part.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : undefined
        }
        rightSlot={
          <>
            <WindPanel
              open={windOpen}
              onClose={() => setWindOpen(false)}
              wind={windConfig}
              onChange={handleWindChange}
              headingDeg={telemetry.headingDeg}
              headwindKnots={telemetry.headwindKnots}
              crosswindKnots={telemetry.crosswindKnots}
            />

            <EmergencyPanel
              open={emergencyOpen}
              onClose={() => setEmergencyOpen(false)}
              emergencies={emergencies}
              engineCount={activeSpec.flight.engineCount}
              aircraftShortName={activeSpec.shortName}
              onTriggerBirdStrike={handleTriggerBirdStrike}
              onTriggerRandom={handleTriggerRandomEmergency}
              onToggleEmergency={handleToggleEmergency}
              onToggleEngineFire={handleToggleEngineFire}
              onClearAll={clearAllEmergencies}
            />
          </>
        }
      />

      <AircraftHangarModal
        open={hangarOpen}
        activeAircraftId={aircraftId}
        activeVariantId={variantId}
        activeLiveryId={liveryId}
        onSelectAircraft={handleSelectAircraftVariantAndLivery}
        onClose={() => setHangarOpen(false)}
      />

      <MobileFlightControls
        inputState={inputState}
        onUpdateInput={updateInput}
        onUnlockAudio={unlockAudio}
        gearCollapsed={telemetry.gearCollapsed}
        crashed={telemetry.crashed}
        hasFlaps={activeSpec.flight.hasFlaps}
        hasRetractableGear={activeSpec.flight.hasRetractableGear}
        hasReverseThrust={activeSpec.flight.hasReverseThrust}
        dockExpanded={dockExpanded}
        onToggleDock={() => setDockExpanded((d) => !d)}
      />
    </main>
  );
}

