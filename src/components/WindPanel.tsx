import React from 'react';
import {Wind, X} from 'lucide-react';
import {WindConfig} from '../sim/types';

interface WindPanelProps {
  open: boolean;
  onClose: () => void;
  wind: WindConfig;
  onChange: (next: WindConfig) => void;
  headingDeg: number;
  headwindKnots: number;
  crosswindKnots: number;
}

const WIND_PRESETS: Array<{label: string; wind: WindConfig}> = [
  {label: 'Calm', wind: {speedKnots: 0, directionDeg: 180, gustsKnots: 0}},
  {label: '17C Head 18kt', wind: {speedKnots: 18, directionDeg: 180, gustsKnots: 5}},
  {label: 'Right Cross 22kt', wind: {speedKnots: 22, directionDeg: 270, gustsKnots: 8}},
  {label: 'Left Cross 25kt', wind: {speedKnots: 25, directionDeg: 90, gustsKnots: 10}},
  {label: 'Tailwind 15kt', wind: {speedKnots: 15, directionDeg: 0, gustsKnots: 4}},
  {label: 'Severe Shear 40kt', wind: {speedKnots: 40, directionDeg: 245, gustsKnots: 20}},
];

export const WindPanel: React.FC<WindPanelProps> = ({
  open,
  onClose,
  wind,
  onChange,
  headingDeg,
  headwindKnots,
  crosswindKnots,
}) => {
  if (!open) return null;

  const headLabel =
    headwindKnots >= 0 ? `HEAD ${headwindKnots} kt` : `TAIL ${Math.abs(headwindKnots)} kt`;
  const crossLabel =
    crosswindKnots === 0
      ? 'XWIND 0 kt'
      : crosswindKnots > 0
        ? `R XWIND ${crosswindKnots} kt`
        : `L XWIND ${Math.abs(crosswindKnots)} kt`;

  return (
    <div
      className="w-[min(368px,calc(100vw-20px))] max-h-[calc(100dvh-160px)] flex flex-col rounded-xl border border-sky-500/35 bg-[#0c111b]/95 text-slate-100 shadow-2xl pointer-events-auto overflow-hidden"
      role="dialog"
      aria-label="KDFW Wind & Gusts Configuration"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/10 bg-[#101828]">
        <div className="flex items-center gap-2">
          <Wind className="w-4 h-4 text-sky-400 shrink-0" />
          <div>
            <h3 className="font-display text-sm font-bold tracking-wide text-white leading-none">
              DFW Wind & Shear
            </h3>
            <p className="text-[11px] font-mono-tabular text-slate-400 mt-0.5">
              METAR {String(wind.directionDeg).padStart(3, '0')}° at {wind.speedKnots}
              {wind.gustsKnots > 0 ? `G${wind.speedKnots + wind.gustsKnots}` : ''}KT
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Wind Panel"
          className="min-w-[36px] min-h-[36px] rounded-lg border border-white/15 bg-[#121926] hover:bg-slate-800 text-slate-300 hover:text-white flex items-center justify-center transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="overflow-y-auto p-3.5 space-y-3.5">
        {/* Wind Rose Compass + Live Relative Components */}
        <div className="flex items-center gap-3.5 p-2.5 rounded-lg border border-white/10 bg-[#090e17]">
          <svg viewBox="-54 -54 108 108" className="w-24 h-24 shrink-0">
            <circle cx="0" cy="0" r="46" fill="#0d1422" stroke="#334155" strokeWidth="1.5" />
            <text x="0" y="-36" textAnchor="middle" fill="#94a3b8" fontSize="8" fontWeight="bold">
              N
            </text>
            <text x="38" y="3" textAnchor="middle" fill="#64748b" fontSize="7">
              E
            </text>
            <text x="0" y="42" textAnchor="middle" fill="#64748b" fontSize="7">
              S
            </text>
            <text x="-38" y="3" textAnchor="middle" fill="#64748b" fontSize="7">
              W
            </text>

            {/* Aircraft Heading Nose Marker */}
            <g transform={`rotate(${headingDeg})`}>
              <polygon points="0,-24 5,-6 0,-10 -5,-6" fill="#e2e8f0" opacity="0.85" />
              <line x1="0" y1="-10" x2="0" y2="16" stroke="#e2e8f0" strokeWidth="2" opacity="0.7" />
              <line x1="-13" y1="2" x2="13" y2="2" stroke="#e2e8f0" strokeWidth="2" opacity="0.7" />
            </g>

            {/* Wind FROM Arrow pointing inward toward center */}
            {wind.speedKnots > 0 && (
              <g transform={`rotate(${wind.directionDeg})`}>
                <line x1="0" y1="-44" x2="0" y2="-16" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round" />
                <polygon points="0,-10 -5,-20 5,-20" fill="#38bdf8" />
              </g>
            )}
          </svg>

          <div className="flex-1 min-w-0 space-y-1.5 font-mono-tabular text-xs">
            <div className="text-[10px] uppercase tracking-wider text-slate-400">
              Relative To HDG {String(headingDeg).padStart(3, '0')}°
            </div>
            <div
              className={`font-semibold ${
                headwindKnots >= 0 ? 'text-emerald-300' : 'text-amber-300'
              }`}
            >
              {headLabel}
            </div>
            <div
              className={`font-semibold ${
                Math.abs(crosswindKnots) >= 18 ? 'text-amber-300' : 'text-sky-300'
              }`}
            >
              {crossLabel}
            </div>
            <div className="text-[11px] text-slate-400">
              Gust Factor ±{Math.round(wind.gustsKnots * 0.5)} kt
            </div>
          </div>
        </div>

        {/* Sliders */}
        <div className="space-y-3 text-xs">
          <div>
            <div className="flex justify-between font-mono-tabular mb-1">
              <span className="text-slate-300 font-medium">Wind Speed</span>
              <span className="text-sky-300 font-semibold">{wind.speedKnots} kts</span>
            </div>
            <input
              type="range"
              min={0}
              max={55}
              step={1}
              value={wind.speedKnots}
              onChange={(e) => onChange({...wind, speedKnots: Number(e.target.value)})}
              className="w-full accent-sky-400 cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between font-mono-tabular mb-1">
              <span className="text-slate-300 font-medium">Wind Direction (FROM)</span>
              <span className="text-sky-300 font-semibold">
                {String(wind.directionDeg).padStart(3, '0')}°
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={359}
              step={5}
              value={wind.directionDeg}
              onChange={(e) => onChange({...wind, directionDeg: Number(e.target.value)})}
              className="w-full accent-sky-400 cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between font-mono-tabular mb-1">
              <span className="text-slate-300 font-medium">Gusts & Turbulence</span>
              <span className="text-amber-300 font-semibold">+{wind.gustsKnots} kts</span>
            </div>
            <input
              type="range"
              min={0}
              max={25}
              step={1}
              value={wind.gustsKnots}
              onChange={(e) => onChange({...wind, gustsKnots: Number(e.target.value)})}
              className="w-full accent-amber-400 cursor-pointer"
            />
          </div>
        </div>

        {/* Quick Wind Presets */}
        <div>
          <div className="text-[11px] font-mono-tabular uppercase tracking-wider text-slate-400 mb-1.5">
            Runway 17C Presets
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {WIND_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => onChange(preset.wind)}
                className="min-h-[36px] px-2.5 py-1.5 rounded-lg border border-white/10 bg-[#121926] hover:bg-slate-800 text-[11px] font-medium text-slate-200 transition-colors"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
