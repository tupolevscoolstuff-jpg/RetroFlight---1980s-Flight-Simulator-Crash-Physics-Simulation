import React, {useRef, useState} from 'react';
import {FLAP_ANGLES} from '../sim/flightDynamics';
import {ControlInput} from '../sim/types';

interface MobileFlightControlsProps {
  inputState: ControlInput;
  onUpdateInput: (patch: Partial<ControlInput>) => void;
  onUnlockAudio: () => void;
  gearCollapsed: boolean;
  crashed: boolean;
  hasFlaps: boolean;
  hasRetractableGear: boolean;
  hasReverseThrust: boolean;
  dockExpanded: boolean;
  onToggleDock: () => void;
}

export const MobileFlightControls: React.FC<MobileFlightControlsProps> = ({
  inputState,
  onUpdateInput,
  onUnlockAudio,
  gearCollapsed,
  crashed,
  hasFlaps,
  hasRetractableGear,
  hasReverseThrust,
  dockExpanded,
  onToggleDock,
}) => {
  const yokeRef = useRef<HTMLDivElement | null>(null);
  const throttleRef = useRef<HTMLDivElement | null>(null);
  const [yokeKnob, setYokeKnob] = useState({x: 0, y: 0});
  const yokePtrId = useRef<number | null>(null);
  const throttlePtrId = useRef<number | null>(null);

  const handleYokeMove = (clientX: number, clientY: number) => {
    const el = yokeRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width * 0.5;
    const cy = rect.top + rect.height * 0.5;
    const maxR = rect.width * 0.38;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) {
      dx = (dx / dist) * maxR;
      dy = (dy / dist) * maxR;
    }
    setYokeKnob({x: dx, y: dy});
    // Aviation yoke convention: pull down (+dy) -> pitch up (+1), push up (-dy) -> nose down (-1)
    const normX = Math.abs(dx / maxR) < 0.06 ? 0 : dx / maxR;
    const normY = Math.abs(dy / maxR) < 0.06 ? 0 : dy / maxR;
    onUpdateInput({roll: normX, pitch: normY});
  };

  const handleThrottleMove = (clientY: number) => {
    const el = throttleRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const frac = 1 - (clientY - rect.top) / rect.height;
    const clamped = Math.max(0, Math.min(1, frac));
    onUpdateInput({throttle: clamped, reverseThrust: clamped < 0.03 ? inputState.reverseThrust : false});
  };

  const nextFlapIndex = (inputState.flapsIndex + 1) % FLAP_ANGLES.length;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex flex-col justify-end pb-2.5 sm:pb-3 px-2.5 sm:px-5 gap-2">
      {/* Mobile/Compact Systems Dock Row (< md screens): stacked cleanly ABOVE yoke & throttle so thumbs never overlap */}
      <div className="md:hidden pointer-events-auto flex flex-col items-center w-full">
        <button
          type="button"
          onClick={() => {
            onUnlockAudio();
            onToggleDock();
          }}
          className="mb-1 px-3 py-1 rounded-lg border border-white/15 bg-[#0b111c]/88 text-[11px] font-medium text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0"
        >
          {dockExpanded ? 'Hide Controls' : 'Show Controls'}
        </button>

        {dockExpanded && (
          <div className="flex flex-wrap items-center justify-center gap-1.5 p-1.5 rounded-xl border border-white/15 bg-[#0b111c]/88 max-w-full">
            <button
              type="button"
              onClick={() => {
                onUnlockAudio();
                if (hasRetractableGear) {
                  onUpdateInput({gearDown: !inputState.gearDown});
                }
              }}
              disabled={!hasRetractableGear || gearCollapsed || crashed}
              className={`min-h-[38px] px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 border ${
                gearCollapsed
                  ? 'bg-red-950/70 border-red-500/40 text-red-300'
                  : !hasRetractableGear || inputState.gearDown
                    ? 'bg-emerald-700/80 border-emerald-400/50 text-white'
                    : 'bg-slate-800/90 border-white/10 text-slate-200 hover:bg-slate-700'
              }`}
            >
              {gearCollapsed ? 'Gear Fail' : !hasRetractableGear ? 'Fixed Gear' : inputState.gearDown ? 'Gear Down' : 'Gear Up'}
            </button>

            {hasFlaps && (
              <button
                type="button"
                onClick={() => {
                  onUnlockAudio();
                  onUpdateInput({flapsIndex: nextFlapIndex});
                }}
                className="min-h-[38px] px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-800/90 hover:bg-slate-700 border border-white/10 text-slate-100 transition-colors whitespace-nowrap shrink-0 font-mono-tabular"
              >
                Flaps {FLAP_ANGLES[inputState.flapsIndex]}°
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                onUnlockAudio();
                onUpdateInput({spoilers: !inputState.spoilers});
              }}
              className={`min-h-[38px] px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 border ${
                inputState.spoilers
                  ? 'bg-amber-600/85 border-amber-300/50 text-white'
                  : 'bg-slate-800/90 border-white/10 text-slate-200 hover:bg-slate-700'
              }`}
            >
              Spoilers {inputState.spoilers ? 'On' : 'Off'}
            </button>

            <button
              type="button"
              onPointerDown={() => {
                onUnlockAudio();
                onUpdateInput({brakes: true});
              }}
              onPointerUp={() => onUpdateInput({brakes: false})}
              onPointerLeave={() => onUpdateInput({brakes: false})}
              onClick={() => {
                if (window.matchMedia('(pointer: coarse)').matches) {
                  onUpdateInput({brakes: !inputState.brakes});
                }
              }}
              className={`min-h-[38px] px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 border ${
                inputState.brakes
                  ? 'bg-red-600/85 border-red-300/60 text-white'
                  : 'bg-slate-800/90 border-white/10 text-slate-200 hover:bg-slate-700'
              }`}
            >
              Brakes
            </button>
          </div>
        )}
      </div>

      {/* Main Thumb-Zone Row: Left Virtual Yoke + Desktop Center Dock + Right Throttle Quadrant */}
      <div className="flex items-end justify-between gap-2 sm:gap-4 w-full">
        {/* Left Thumb Zone: Multi-Touch Virtual Flight Yoke */}
        {dockExpanded && (
          <div className="pointer-events-auto flex flex-col items-center gap-1.5 shrink-0">
            <div
              ref={yokeRef}
              onPointerDown={(e) => {
                e.preventDefault();
                onUnlockAudio();
                yokePtrId.current = e.pointerId;
                e.currentTarget.setPointerCapture(e.pointerId);
                handleYokeMove(e.clientX, e.clientY);
              }}
              onPointerMove={(e) => {
                if (yokePtrId.current !== e.pointerId) return;
                handleYokeMove(e.clientX, e.clientY);
              }}
              onPointerUp={(e) => {
                if (yokePtrId.current !== e.pointerId) return;
                yokePtrId.current = null;
                setYokeKnob({x: 0, y: 0});
                onUpdateInput({pitch: 0, roll: 0});
              }}
              onPointerCancel={() => {
                yokePtrId.current = null;
                setYokeKnob({x: 0, y: 0});
                onUpdateInput({pitch: 0, roll: 0});
              }}
              role="slider"
              aria-label="Virtual Flight Yoke"
              aria-valuetext={`Pitch ${Math.round(inputState.pitch * 100)}%, Roll ${Math.round(inputState.roll * 100)}%`}
              className="relative w-24 h-24 sm:w-32 sm:h-32 rounded-full border border-white/20 bg-[#0b111c]/82 touch-none flex items-center justify-center"
            >
              {/* Crosshair alignment marks */}
              <div className="absolute inset-x-4 top-1/2 h-px bg-white/15 pointer-events-none" />
              <div className="absolute inset-y-4 left-1/2 w-px bg-white/15 pointer-events-none" />
              <span className="absolute top-1 text-[8px] sm:text-[9px] font-mono-tabular text-slate-400 pointer-events-none">
                NOSE DN
              </span>
              <span className="absolute bottom-1 text-[8px] sm:text-[9px] font-mono-tabular text-slate-400 pointer-events-none">
                PULL UP
              </span>

              {/* Yoke Thumb Handle */}
              <div
                style={{transform: `translate(${yokeKnob.x}px, ${yokeKnob.y}px)`}}
                className="w-9 h-9 sm:w-11 sm:h-11 rounded-full border-2 border-sky-400 bg-[#152236] shadow-lg flex items-center justify-center pointer-events-none"
              >
                <div className="w-2.5 h-2.5 rounded-full bg-sky-400" />
              </div>
            </div>

            {/* Rudder Yaw Pedals */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onPointerDown={() => {
                  onUnlockAudio();
                  onUpdateInput({yaw: -1});
                }}
                onPointerUp={() => onUpdateInput({yaw: 0})}
                onPointerLeave={() => onUpdateInput({yaw: 0})}
                className="min-w-[44px] min-h-[38px] px-2 rounded-lg border border-white/15 bg-[#0b111c]/85 text-[11px] sm:text-xs font-mono-tabular text-slate-200 active:bg-sky-600/60 whitespace-nowrap"
              >
                L YAW
              </button>
              <button
                type="button"
                onPointerDown={() => {
                  onUnlockAudio();
                  onUpdateInput({yaw: 1});
                }}
                onPointerUp={() => onUpdateInput({yaw: 0})}
                onPointerLeave={() => onUpdateInput({yaw: 0})}
                className="min-w-[44px] min-h-[38px] px-2 rounded-lg border border-white/15 bg-[#0b111c]/85 text-[11px] sm:text-xs font-mono-tabular text-slate-200 active:bg-sky-600/60 whitespace-nowrap"
              >
                R YAW
              </button>
            </div>
          </div>
        )}

        {/* Desktop Center Collapsible Flight Deck Systems Dock (md+ screens) */}
        <div className="hidden md:flex pointer-events-auto flex-col items-center mx-auto min-w-0">
          <button
            type="button"
            onClick={() => {
              onUnlockAudio();
              onToggleDock();
            }}
            className="mb-1.5 px-3 py-1 rounded-t-lg border border-b-0 border-white/15 bg-[#0b111c]/85 text-[11px] font-medium text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            {dockExpanded ? 'Hide Flight Controls' : 'Show Flight Controls'}
          </button>

          {dockExpanded && (
            <div className="flex flex-wrap items-center justify-center gap-1.5 lg:gap-2 p-2 rounded-xl border border-white/15 bg-[#0b111c]/88">
              <button
                type="button"
                onClick={() => {
                  onUnlockAudio();
                  if (hasRetractableGear) {
                    onUpdateInput({gearDown: !inputState.gearDown});
                  }
                }}
                disabled={!hasRetractableGear || gearCollapsed || crashed}
                className={`min-h-[42px] px-3 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 border ${
                  gearCollapsed
                    ? 'bg-red-950/70 border-red-500/40 text-red-300'
                    : !hasRetractableGear || inputState.gearDown
                      ? 'bg-emerald-700/80 border-emerald-400/50 text-white'
                      : 'bg-slate-800/90 border-white/10 text-slate-200 hover:bg-slate-700'
                }`}
              >
                {gearCollapsed ? 'Gear Fail' : !hasRetractableGear ? 'Fixed Gear' : inputState.gearDown ? 'Gear Down' : 'Gear Up'}
              </button>

              {hasFlaps && (
                <button
                  type="button"
                  onClick={() => {
                    onUnlockAudio();
                    onUpdateInput({flapsIndex: nextFlapIndex});
                  }}
                  className="min-h-[42px] px-3 py-2 rounded-lg text-xs font-semibold bg-slate-800/90 hover:bg-slate-700 border border-white/10 text-slate-100 transition-colors whitespace-nowrap shrink-0 font-mono-tabular"
                >
                  Flaps {FLAP_ANGLES[inputState.flapsIndex]}°
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  onUnlockAudio();
                  onUpdateInput({spoilers: !inputState.spoilers});
                }}
                className={`min-h-[42px] px-3 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 border ${
                  inputState.spoilers
                    ? 'bg-amber-600/85 border-amber-300/50 text-white'
                    : 'bg-slate-800/90 border-white/10 text-slate-200 hover:bg-slate-700'
                }`}
              >
                Spoilers {inputState.spoilers ? 'On' : 'Off'}
              </button>

              <button
                type="button"
                onPointerDown={() => {
                  onUnlockAudio();
                  onUpdateInput({brakes: true});
                }}
                onPointerUp={() => onUpdateInput({brakes: false})}
                onPointerLeave={() => onUpdateInput({brakes: false})}
                onClick={() => {
                  if (window.matchMedia('(pointer: coarse)').matches) {
                    onUpdateInput({brakes: !inputState.brakes});
                  }
                }}
                className={`min-h-[42px] px-3 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 border ${
                  inputState.brakes
                    ? 'bg-red-600/85 border-red-300/60 text-white'
                    : 'bg-slate-800/90 border-white/10 text-slate-200 hover:bg-slate-700'
                }`}
              >
                Brakes
              </button>
            </div>
          )}
        </div>

        {/* Right Thumb Zone: Throttle Quadrant + Reverse Thrust */}
        {dockExpanded && (
          <div className="pointer-events-auto flex flex-col items-center gap-1.5 shrink-0 ml-auto md:ml-0">
            <div className="flex items-end gap-2">
              <div
                ref={throttleRef}
                onPointerDown={(e) => {
                  e.preventDefault();
                  onUnlockAudio();
                  throttlePtrId.current = e.pointerId;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  handleThrottleMove(e.clientY);
                }}
                onPointerMove={(e) => {
                  if (throttlePtrId.current !== e.pointerId) return;
                  handleThrottleMove(e.clientY);
                }}
                onPointerUp={(e) => {
                  if (throttlePtrId.current !== e.pointerId) return;
                  throttlePtrId.current = null;
                }}
                role="slider"
                aria-label="Engine Thrust Throttle"
                aria-valuenow={Math.round(inputState.throttle * 100)}
                className="relative w-12 sm:w-14 h-24 sm:h-32 rounded-xl border border-white/20 bg-[#0b111c]/85 touch-none flex flex-col justify-between py-2 px-1.5"
              >
                <span className="text-[8px] sm:text-[9px] font-mono-tabular text-slate-400 text-center pointer-events-none">
                  TOGA
                </span>
                <div className="absolute left-1/2 -translate-x-1/2 top-5 bottom-5 w-1.5 rounded-full bg-slate-700 pointer-events-none" />
                <div
                  style={{bottom: `${8 + inputState.throttle * 74}%`}}
                  className="absolute left-1 right-1 sm:left-1.5 sm:right-1.5 h-5 rounded-md bg-slate-200 border border-slate-400 shadow flex items-center justify-center pointer-events-none"
                >
                  <div className="w-5 sm:w-6 h-0.5 bg-slate-800" />
                </div>
                <span className="text-[8px] sm:text-[9px] font-mono-tabular text-slate-400 text-center pointer-events-none">
                  IDLE
                </span>
              </div>
            </div>

            {hasReverseThrust && (
              <button
                type="button"
                onClick={() => {
                  onUnlockAudio();
                  onUpdateInput({
                    reverseThrust: !inputState.reverseThrust,
                    throttle: !inputState.reverseThrust ? 0 : inputState.throttle,
                  });
                }}
                className={`min-w-[64px] min-h-[38px] px-2.5 rounded-lg border text-[11px] sm:text-xs font-mono-tabular font-semibold transition-colors whitespace-nowrap ${
                  inputState.reverseThrust
                    ? 'bg-amber-600/90 border-amber-300/60 text-white'
                    : 'bg-[#0b111c]/85 border-white/15 text-slate-200 hover:bg-slate-800'
                }`}
              >
                REV {inputState.reverseThrust ? 'ON' : 'OFF'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

