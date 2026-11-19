import React from 'react';
import {
  AlertTriangle,
  Bird,
  Flame,
  Gauge,
  RotateCcw,
  Shuffle,
  Wrench,
  X,
  ZapOff,
  Droplets,
  Wind,
} from 'lucide-react';
import {EmergencyState} from '../sim/types';

interface EmergencyPanelProps {
  open: boolean;
  onClose: () => void;
  emergencies: EmergencyState;
  engineCount: number;
  aircraftShortName: string;
  onTriggerBirdStrike: () => void;
  onTriggerRandom: () => void;
  onToggleEmergency: (
    key:
      | 'hydraulicFailure'
      | 'noseGearFailure'
      | 'leftGearFailure'
      | 'rightGearFailure'
      | 'electricalFailure'
      | 'pressurizationFailure'
      | 'fuelLeak'
      | 'runawayTrim',
  ) => void;
  onToggleEngineFire: (engineIndex: 0 | 1 | 2 | 3) => void;
  onClearAll: () => void;
}

export const EmergencyPanel: React.FC<EmergencyPanelProps> = ({
  open,
  onClose,
  emergencies,
  engineCount,
  aircraftShortName,
  onTriggerBirdStrike,
  onTriggerRandom,
  onToggleEmergency,
  onToggleEngineFire,
  onClearAll,
}) => {
  if (!open) return null;

  const activeCount =
    emergencies.engineFires.slice(0, engineCount).filter(Boolean).length +
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
    <div className="w-[min(372px,calc(100vw-20px))] max-h-[calc(100dvh-160px)] overflow-y-auto rounded-xl border border-red-500/35 bg-[#0c111b]/95 p-4 text-xs text-slate-100 shadow-2xl pointer-events-auto">
      <div className="flex items-center justify-between gap-2 pb-2.5 mb-3 border-b border-white/10">
        <div className="flex items-center gap-2 min-w-0">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <div className="min-w-0">
            <h3 className="font-display text-sm font-bold tracking-wide text-white truncate">
              Emergencies & Failures
            </h3>
            <p className="text-[11px] text-slate-400 truncate">
              {aircraftShortName} · {activeCount} active
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Emergencies Panel"
          className="h-8 w-8 rounded-lg border border-white/10 bg-slate-900 hover:bg-slate-800 flex items-center justify-center text-slate-300"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Immediate Event Triggers */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <button
          type="button"
          onClick={onTriggerBirdStrike}
          className="min-h-[40px] px-2.5 py-2 rounded-lg border border-amber-500/40 bg-amber-950/60 hover:bg-amber-900/70 text-amber-100 font-semibold flex items-center justify-center gap-1.5 transition-colors"
        >
          <Bird className="w-4 h-4 text-amber-300 shrink-0" />
          <span>Bird Strike{emergencies.birdStrikeCount > 0 ? ` (${emergencies.birdStrikeCount})` : ''}</span>
        </button>
        <button
          type="button"
          onClick={onTriggerRandom}
          className="min-h-[40px] px-2.5 py-2 rounded-lg border border-red-500/40 bg-red-950/60 hover:bg-red-900/70 text-red-100 font-semibold flex items-center justify-center gap-1.5 transition-colors"
        >
          <Shuffle className="w-4 h-4 text-red-300 shrink-0" />
          <span>Random Failure</span>
        </button>
      </div>

      {/* Engine Fires (1..N) */}
      <div className="mb-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
          Engine Fires ({engineCount} {engineCount === 1 ? 'Engine' : 'Engines'})
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {([0, 1, 2, 3] as const).slice(0, Math.max(1, Math.min(4, engineCount))).map((idx) => {
            const active = emergencies.engineFires[idx];
            return (
              <button
                key={idx}
                type="button"
                onClick={() => onToggleEngineFire(idx)}
                className={`min-h-[38px] px-2.5 py-1.5 rounded-lg border text-left font-medium flex items-center justify-between transition-colors ${
                  active
                    ? 'border-red-400 bg-red-900/80 text-white'
                    : 'border-white/10 bg-[#131b2b] hover:bg-slate-800 text-slate-200'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <Flame className={`w-3.5 h-3.5 ${active ? 'text-orange-300' : 'text-slate-400'}`} />
                  Engine {idx + 1} Fire
                </span>
                <span className={`text-[10px] font-mono-tabular ${active ? 'text-red-200' : 'text-slate-500'}`}>
                  {active ? 'ON' : 'OK'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Landing Gear Failures */}
      <div className="mb-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
          Landing Gear Failures
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {(
            [
              ['noseGearFailure', 'Nose Gear'],
              ['leftGearFailure', 'Left Gear'],
              ['rightGearFailure', 'Right Gear'],
            ] as const
          ).map(([key, label]) => {
            const active = emergencies[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => onToggleEmergency(key)}
                className={`min-h-[38px] px-2 py-1.5 rounded-lg border font-medium flex flex-col items-center justify-center transition-colors ${
                  active
                    ? 'border-red-400 bg-red-900/80 text-white'
                    : 'border-white/10 bg-[#131b2b] hover:bg-slate-800 text-slate-200'
                }`}
              >
                <span className="truncate">{label}</span>
                <span className={`text-[10px] font-mono-tabular ${active ? 'text-red-200' : 'text-slate-500'}`}>
                  {active ? 'FAIL' : 'OK'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Flight Control, Hydraulic, Electrical, Fuel & Cabin Systems */}
      <div className="mb-3.5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
          Aircraft Systems
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => onToggleEmergency('hydraulicFailure')}
            className={`min-h-[38px] px-2.5 py-1.5 rounded-lg border flex items-center justify-between transition-colors ${
              emergencies.hydraulicFailure
                ? 'border-amber-400 bg-amber-900/75 text-white'
                : 'border-white/10 bg-[#131b2b] hover:bg-slate-800 text-slate-200'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <Wrench className="w-3.5 h-3.5 text-emerald-400" />
              Hydraulic Fail
            </span>
            <span className="text-[10px] font-mono-tabular">{emergencies.hydraulicFailure ? 'FAIL' : 'OK'}</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleEmergency('runawayTrim')}
            className={`min-h-[38px] px-2.5 py-1.5 rounded-lg border flex items-center justify-between transition-colors ${
              emergencies.runawayTrim
                ? 'border-amber-400 bg-amber-900/75 text-white'
                : 'border-white/10 bg-[#131b2b] hover:bg-slate-800 text-slate-200'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <Gauge className="w-3.5 h-3.5 text-amber-400" />
              Runaway Trim
            </span>
            <span className="text-[10px] font-mono-tabular">{emergencies.runawayTrim ? 'ON' : 'OK'}</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleEmergency('electricalFailure')}
            className={`min-h-[38px] px-2.5 py-1.5 rounded-lg border flex items-center justify-between transition-colors ${
              emergencies.electricalFailure
                ? 'border-red-400 bg-red-900/80 text-white'
                : 'border-white/10 bg-[#131b2b] hover:bg-slate-800 text-slate-200'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <ZapOff className="w-3.5 h-3.5 text-sky-400" />
              Elec Blackout
            </span>
            <span className="text-[10px] font-mono-tabular">{emergencies.electricalFailure ? 'OFF' : 'OK'}</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleEmergency('fuelLeak')}
            className={`min-h-[38px] px-2.5 py-1.5 rounded-lg border flex items-center justify-between transition-colors ${
              emergencies.fuelLeak
                ? 'border-amber-400 bg-amber-900/75 text-white'
                : 'border-white/10 bg-[#131b2b] hover:bg-slate-800 text-slate-200'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <Droplets className="w-3.5 h-3.5 text-cyan-400" />
              Fuel Leak
            </span>
            <span className="text-[10px] font-mono-tabular">{emergencies.fuelLeak ? 'LEAK' : 'OK'}</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleEmergency('pressurizationFailure')}
            className={`col-span-2 min-h-[38px] px-2.5 py-1.5 rounded-lg border flex items-center justify-between transition-colors ${
              emergencies.pressurizationFailure
                ? 'border-amber-400 bg-amber-900/75 text-white'
                : 'border-white/10 bg-[#131b2b] hover:bg-slate-800 text-slate-200'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <Wind className="w-3.5 h-3.5 text-slate-300" />
              Cabin Rapid Decompression
            </span>
            <span className="text-[10px] font-mono-tabular">
              {emergencies.pressurizationFailure ? 'CABIN ALT' : 'NORMAL'}
            </span>
          </button>
        </div>
      </div>

      {/* Clear / Extinguish */}
      <button
        type="button"
        onClick={onClearAll}
        disabled={activeCount === 0}
        className="w-full min-h-[38px] px-3 py-2 rounded-lg border border-white/15 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:pointer-events-none text-slate-100 font-semibold flex items-center justify-center gap-1.5 transition-colors"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        Extinguish & Clear All Failures
      </button>
    </div>
  );
};
