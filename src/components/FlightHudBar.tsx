import React from 'react';
import {
  AlertTriangle,
  Camera,
  Volume2,
  VolumeX,
  RotateCcw,
  Sun,
  Sunset,
  Moon,
  CloudSun,
  CloudFog,
  CloudLightning,
  HelpCircle,
  Plane,
  Wind,
  Scissors,
} from 'lucide-react';
import {getAircraftById} from '../sim/aircraftCatalog';
import {AircraftId, CameraMode, FlightTelemetry, ScenarioId, TimeOfDay, WeatherMode, WindConfig} from '../sim/types';

interface FlightHudBarProps {
  telemetry: FlightTelemetry;
  activeAircraftId: AircraftId;
  activeLiveryId: string;
  onOpenHangar: () => void;
  onSelectLivery: (liveryId: string) => void;
  cameraMode: CameraMode;
  onCycleCamera: () => void;
  scenario: ScenarioId;
  onSelectScenario: (id: ScenarioId) => void;
  timeOfDay: TimeOfDay;
  onCycleTimeOfDay: () => void;
  weatherMode: WeatherMode;
  onCycleWeather: () => void;
  windConfig: WindConfig;
  windOpen: boolean;
  onToggleWind: () => void;
  breakMode: boolean;
  onToggleBreakMode: () => void;
  activeEmergencyCount: number;
  emergencyOpen: boolean;
  onToggleEmergency: () => void;
  muted: boolean;
  onToggleMute: () => void;
  onReset: () => void;
  showHelp: boolean;
  onToggleHelp: () => void;
  centerSlot?: React.ReactNode;
  rightSlot?: React.ReactNode;
}

const CAMERA_LABELS: Record<CameraMode, string> = {
  chase: 'Chase',
  wing: 'Wing',
  cockpit: 'Cockpit',
  tower: 'DFW Tower',
  orbit: 'Orbit',
};

const WEATHER_LABELS: Record<WeatherMode, string> = {
  clear: 'Clear',
  fog: 'Light Fog',
  thunderstorm: 'Storm',
};

export const FlightHudBar: React.FC<FlightHudBarProps> = ({
  telemetry,
  activeAircraftId,
  activeLiveryId,
  onOpenHangar,
  onSelectLivery,
  cameraMode,
  onCycleCamera,
  scenario,
  onSelectScenario,
  timeOfDay,
  onCycleTimeOfDay,
  weatherMode,
  onCycleWeather,
  windConfig,
  windOpen,
  onToggleWind,
  breakMode,
  onToggleBreakMode,
  activeEmergencyCount,
  emergencyOpen,
  onToggleEmergency,
  muted,
  onToggleMute,
  onReset,
  showHelp,
  onToggleHelp,
  centerSlot,
  rightSlot,
}) => {
  const TimeIcon = timeOfDay === 'day' ? Sun : timeOfDay === 'golden' ? Sunset : Moon;
  const WeatherIcon = weatherMode === 'clear' ? CloudSun : weatherMode === 'fog' ? CloudFog : CloudLightning;
  const spec = getAircraftById(activeAircraftId);

  return (
    <div className="fixed top-0 inset-x-0 z-30 pointer-events-none flex flex-col">
      {/* Row 1: Responsive Aviation HUD Header */}
      <header className="pointer-events-auto w-full bg-[#090d14]/88 border-b border-white/10 px-2.5 sm:px-4 py-1.5 sm:py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-2">
        {/* Sub-row 1 (Left on sm+, Top on <sm): Aircraft Hangar + Livery + 2xl Telemetry + Mobile Scenario */}
        <div className="flex items-center justify-between gap-2 w-full sm:w-auto sm:flex-1 sm:min-w-0">
          <div className="flex items-center gap-2 min-w-0 flex-1 sm:flex-initial">
            <button
              type="button"
              onClick={onOpenHangar}
              title="Select 1980s Aircraft, Variant & Livery"
              className="h-9 px-2.5 rounded-lg border border-sky-400/35 bg-[#121c2e] hover:bg-[#1a2842] text-left flex items-center gap-2 transition-colors flex-1 sm:flex-initial min-w-0 sm:max-w-[140px] md:max-w-[190px]"
            >
              <Plane className="w-4 h-4 text-sky-400 shrink-0" />
              <span className="font-display text-sm sm:text-base font-bold tracking-wide text-white truncate">
                {telemetry.variantName || spec.shortName}
              </span>
            </button>

            <select
              aria-label="Airline Livery"
              value={activeLiveryId}
              onChange={(e) => onSelectLivery(e.target.value)}
              className="hidden lg:block h-9 px-2 rounded-lg border border-white/15 bg-[#121926] text-xs font-medium text-slate-200 focus:outline-none focus:border-sky-400 max-w-[128px] truncate shrink-0"
            >
              {spec.liveries.map((liv) => (
                <option key={liv.id} value={liv.id}>
                  {liv.name}
                </option>
              ))}
            </select>

            <div className="hidden 2xl:flex items-center gap-2 text-xs text-slate-300 font-mono-tabular whitespace-nowrap min-w-0 overflow-hidden">
              <span className="text-slate-500" aria-hidden="true">·</span>
              <span>
                IAS {telemetry.iasKnots} kt
                {telemetry.mach >= 0.45 ? ` (M ${telemetry.mach.toFixed(2)})` : ''}
              </span>
              <span className="text-slate-500" aria-hidden="true">·</span>
              <span>ALT {telemetry.altitudeFtAGL} ft</span>
              <span className="text-slate-500" aria-hidden="true">·</span>
              <span>V/S {telemetry.verticalSpeedFpm >= 0 ? '+' : ''}{telemetry.verticalSpeedFpm}</span>
              <span className="text-slate-500" aria-hidden="true">·</span>
              <span>HDG {String(telemetry.headingDeg).padStart(3, '0')}°</span>
              <span className="text-slate-500" aria-hidden="true">·</span>
              <span className={telemetry.afterburnerActive ? 'text-amber-300 font-semibold' : ''}>
                N1 {telemetry.n1Percent}%{telemetry.afterburnerActive ? ' A/B' : ''}
              </span>
              <span className="text-slate-500" aria-hidden="true">·</span>
              <span className={telemetry.integrityPercent < 75 ? 'text-amber-300 font-semibold' : 'text-slate-200'}>
                {telemetry.integrityPercent}%
              </span>
            </div>
          </div>

          <select
            aria-label="Flight Scenario"
            value={scenario}
            onChange={(e) => onSelectScenario(e.target.value as ScenarioId)}
            className="sm:hidden h-9 px-2 rounded-lg border border-white/15 bg-[#121926] text-xs font-medium text-slate-100 focus:outline-none focus:border-sky-400 max-w-[132px] shrink-0 truncate"
          >
            <option value="rwy17c_takeoff">DFW 17C Takeoff</option>
            <option value="rwy17c_approach">ILS 17C Approach</option>
            <option value="low_pass_emergency">Tower Low-Pass</option>
            <option value="high_dive_crash_test">Dive Crash Test</option>
          </select>
        </div>

        {/* Sub-row 2 (Right on sm+, Bottom action strip on <sm): Interactive Controls */}
        <div className="flex items-center gap-1 sm:gap-1.5 w-full sm:w-auto justify-between sm:justify-end overflow-x-auto no-scrollbar shrink-0">
          <select
            aria-label="Flight Scenario"
            value={scenario}
            onChange={(e) => onSelectScenario(e.target.value as ScenarioId)}
            className="hidden sm:block h-9 px-2 rounded-lg border border-white/15 bg-[#121926] text-xs font-medium text-slate-100 focus:outline-none focus:border-sky-400 max-w-[118px] md:max-w-[148px] shrink-0 truncate"
          >
            <option value="rwy17c_takeoff">DFW 17C Takeoff</option>
            <option value="rwy17c_approach">ILS 17C Approach</option>
            <option value="low_pass_emergency">Tower Low-Pass</option>
            <option value="high_dive_crash_test">Dive Crash Test</option>
          </select>

          <button
            type="button"
            onClick={onCycleCamera}
            title="Cycle Camera View (C)"
            className="h-9 px-2 rounded-lg border border-white/15 bg-[#121926] hover:bg-slate-800 text-xs font-medium text-slate-100 flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            <Camera className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span className="hidden md:inline">{CAMERA_LABELS[cameraMode]}</span>
          </button>

          <button
            type="button"
            onClick={onCycleWeather}
            title={`Weather: ${WEATHER_LABELS[weatherMode]} (M)`}
            aria-label={`Weather: ${WEATHER_LABELS[weatherMode]}`}
            className={`h-9 px-2 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
              weatherMode === 'thunderstorm'
                ? 'border-amber-400/50 bg-amber-950/50 hover:bg-amber-900/60 text-amber-100'
                : weatherMode === 'fog'
                  ? 'border-slate-400/45 bg-slate-800/80 hover:bg-slate-700 text-slate-100'
                  : 'border-white/15 bg-[#121926] hover:bg-slate-800 text-slate-100'
            }`}
          >
            <WeatherIcon
              className={`w-3.5 h-3.5 shrink-0 ${
                weatherMode === 'thunderstorm'
                  ? 'text-amber-300'
                  : weatherMode === 'fog'
                    ? 'text-slate-300'
                    : 'text-sky-400'
              }`}
            />
            <span className="hidden xl:inline">{WEATHER_LABELS[weatherMode]}</span>
          </button>

          <button
            type="button"
            onClick={onToggleWind}
            title="Wind & Gusts Settings"
            aria-label="Wind & Gusts Settings"
            className={`h-9 px-2 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
              windOpen
                ? 'border-sky-400/65 bg-sky-950/75 text-sky-100'
                : 'border-white/15 bg-[#121926] hover:bg-slate-800 text-slate-100'
            }`}
          >
            <Wind className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span className="hidden md:inline font-mono-tabular">{windConfig.speedKnots}kt</span>
          </button>

          <button
            type="button"
            onClick={onToggleBreakMode}
            title="Break Up Selection: Click any aircraft part to shear it off (K)"
            aria-label="Break Up Selection Mode"
            className={`h-9 px-2 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
              breakMode
                ? 'border-amber-400/75 bg-amber-950/80 hover:bg-amber-900/85 text-amber-100'
                : 'border-white/15 bg-[#121926] hover:bg-slate-800 text-slate-100'
            }`}
          >
            <Scissors className={`w-3.5 h-3.5 shrink-0 ${breakMode ? 'text-amber-300' : 'text-orange-400'}`} />
            <span className="hidden xl:inline">Break</span>
          </button>

          <button
            type="button"
            onClick={onToggleEmergency}
            title="Aircraft Emergencies & Failures"
            aria-label="Aircraft Emergencies & Failures"
            className={`h-9 px-2 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
              emergencyOpen || activeEmergencyCount > 0
                ? 'border-red-400/60 bg-red-950/75 hover:bg-red-900/80 text-red-100'
                : 'border-white/15 bg-[#121926] hover:bg-slate-800 text-slate-100'
            }`}
          >
            <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${activeEmergencyCount > 0 ? 'text-red-400' : 'text-amber-400'}`} />
            <span className="hidden xl:inline">Failures</span>
            {activeEmergencyCount > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-red-500 text-[10px] font-bold text-white leading-none">
                {activeEmergencyCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={onCycleTimeOfDay}
            title="Switch Sky Time"
            aria-label="Switch Sky Time"
            className="h-9 w-9 rounded-lg border border-white/15 bg-[#121926] hover:bg-slate-800 text-slate-200 flex items-center justify-center transition-colors shrink-0"
          >
            <TimeIcon className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onToggleMute}
            title={muted ? 'Unmute Audio' : 'Mute Audio'}
            aria-label={muted ? 'Unmute Audio' : 'Mute Audio'}
            className="h-9 w-9 rounded-lg border border-white/15 bg-[#121926] hover:bg-slate-800 text-slate-200 flex items-center justify-center transition-colors shrink-0"
          >
            {muted ? <VolumeX className="w-3.5 h-3.5 text-slate-400" /> : <Volume2 className="w-3.5 h-3.5 text-sky-400" />}
          </button>

          <button
            type="button"
            onClick={onReset}
            title="Reset Flight (R)"
            aria-label="Reset Flight"
            className="h-9 w-9 rounded-lg border border-white/15 bg-[#121926] hover:bg-slate-800 text-slate-200 flex items-center justify-center transition-colors shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onToggleHelp}
            title="Controls Reference"
            aria-label="Controls Reference"
            className={`h-9 w-9 rounded-lg border flex items-center justify-center transition-colors shrink-0 ${
              showHelp
                ? 'border-sky-400/65 bg-sky-950/75 text-sky-100'
                : 'border-white/15 bg-[#121926] hover:bg-slate-800 text-slate-200'
            }`}
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Row 2: Compact Telemetry Strip (< 2xl screens, directly below header in flex flow) */}
      <div className="2xl:hidden w-full flex items-center justify-center gap-2 sm:gap-3 px-3 py-1 bg-[#090d14]/78 border-b border-white/10 text-[11px] font-mono-tabular text-slate-200 whitespace-nowrap overflow-x-auto no-scrollbar">
        <span>
          {telemetry.iasKnots} KT{telemetry.mach >= 0.5 ? ` · M${telemetry.mach.toFixed(2)}` : ''}
        </span>
        <span className="text-slate-500" aria-hidden="true">·</span>
        <span>{telemetry.altitudeFtAGL} FT</span>
        <span className="text-slate-500" aria-hidden="true">·</span>
        <span>HDG {String(telemetry.headingDeg).padStart(3, '0')}°</span>
        <span className="text-slate-500" aria-hidden="true">·</span>
        <span className={telemetry.afterburnerActive ? 'text-amber-300 font-semibold' : ''}>
          N1 {telemetry.n1Percent}%
        </span>
        <span className="text-slate-500" aria-hidden="true">·</span>
        <span className={telemetry.integrityPercent < 75 ? 'text-amber-300 font-semibold' : ''}>
          {telemetry.integrityPercent}%
        </span>
      </div>

      {/* Row 3: Below-Header HUD Region (ADI Gauge + Center Slot/Warnings + Right Overlay Slot) */}
      <div className="relative w-full px-2.5 sm:px-5 pt-2 flex items-start justify-between gap-2 sm:gap-3">
        {/* Left: Compact Sperry ADI Attitude Gauge */}
        <div className={`${centerSlot ? 'hidden md:flex' : 'flex'} items-center gap-2.5 shrink-0`}>
          <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full border border-white/25 bg-[#090d14]/80 overflow-hidden relative shadow-lg">
            <svg viewBox="-50 -50 100 100" className="w-full h-full">
              <g transform={`rotate(${-telemetry.rollDeg}) translate(0, ${Math.max(-28, Math.min(28, telemetry.pitchDeg * 1.4))})`}>
                <rect x="-80" y="-80" width="160" height="80" fill="#1e60a8" />
                <rect x="-80" y="0" width="160" height="80" fill="#5c4028" />
                <line x1="-60" y1="0" x2="60" y2="0" stroke="#ffffff" strokeWidth="2" />
                <line x1="-14" y1="-14" x2="14" y2="-14" stroke="#ffffff" strokeWidth="1.2" />
                <line x1="-14" y1="14" x2="14" y2="14" stroke="#ffffff" strokeWidth="1.2" />
              </g>
              <path d="M -22 0 L -7 0 L -4 5 L 0 0 L 4 5 L 7 0 L 22 0" fill="none" stroke="#f59e0b" strokeWidth="2.8" />
              <circle cx="0" cy="0" r="2" fill="#f59e0b" />
            </svg>
          </div>
          <div className="hidden sm:block text-[11px] font-mono-tabular text-slate-300 leading-snug bg-[#090d14]/75 px-2.5 py-1.5 rounded-lg border border-white/10">
            <div className="text-slate-100 font-semibold">{telemetry.liveryCarrier}</div>
            <div>G {telemetry.gForce.toFixed(1)} · AOA {telemetry.aoaDeg.toFixed(1)}°</div>
            <div className="text-slate-400">
              WIND {String(windConfig.directionDeg).padStart(3, '0')}/{windConfig.speedKnots}KT
            </div>
          </div>
        </div>

        {/* Center: Break-Up Bar OR Critical GPWS / Stall / Master Warnings (Never stacked together) */}
        <div className="flex-1 min-w-0 flex flex-col items-center gap-1.5">
          {centerSlot}

          {!centerSlot && (telemetry.gpwsWarning || telemetry.stallWarning) && !telemetry.crashed && (
            <div className="px-3 sm:px-4 py-1.5 rounded-lg border border-red-400/60 bg-red-950/90 text-[11px] sm:text-xs font-mono-tabular font-bold tracking-wider text-red-100 whitespace-nowrap max-w-full truncate">
              {telemetry.gpwsWarning ? 'PULL UP · SINK RATE' : 'STALL WARNING · PITCH DOWN'}
            </div>
          )}

          {!centerSlot && telemetry.activeWarnings.length > 0 && !telemetry.crashed && (
            <div className="max-w-full px-3 py-1 rounded-lg border border-amber-400/55 bg-[#1a0b0d]/90 text-[10px] sm:text-[11px] font-mono-tabular font-semibold tracking-wide text-amber-200 truncate">
              MASTER WARN: {telemetry.activeWarnings.slice(0, 4).join(' · ')}
              {telemetry.activeWarnings.length > 4 ? ` +${telemetry.activeWarnings.length - 4}` : ''}
            </div>
          )}
        </div>

        {/* Right Overlay Slot: Anchored cleanly below header & telemetry bar */}
        {(rightSlot || showHelp) && (
          <div className="absolute top-2 right-2.5 sm:right-5 z-40 flex flex-col items-end gap-2 max-w-[calc(100vw-20px)] pointer-events-none">
            {showHelp && (
              <div className="w-[min(288px,calc(100vw-20px))] max-h-[calc(100dvh-160px)] overflow-y-auto rounded-xl border border-white/15 bg-[#0c111b]/95 p-4 text-xs text-slate-200 shadow-2xl pointer-events-auto">
                <div className="flex items-center justify-between mb-2 pb-2 border-b border-white/10">
                  <span className="font-display text-sm font-bold text-white">Flight Controls</span>
                  <button type="button" onClick={onToggleHelp} className="text-slate-400 hover:text-white">
                    Close
                  </button>
                </div>
                <div className="space-y-1.5 font-mono-tabular text-[11px]">
                  <div className="flex justify-between"><span className="text-slate-400">Pitch / Roll</span><span>W S A D or Arrows</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Rudder Yaw</span><span>Q / E</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Throttle Up / Down</span><span>Shift / Ctrl</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Reverse Thrust</span><span>X</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Landing Gear</span><span>G</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Flaps Extend / Retract</span><span>F / V</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Spoilers / Brakes</span><span>Space / B</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Camera / Weather</span><span>C / M</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Break Part Mode</span><span>K (Click Part)</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Hide HUD / Reset</span><span>H / R</span></div>
                </div>
              </div>
            )}
            {rightSlot}
          </div>
        )}
      </div>
    </div>
  );
};

