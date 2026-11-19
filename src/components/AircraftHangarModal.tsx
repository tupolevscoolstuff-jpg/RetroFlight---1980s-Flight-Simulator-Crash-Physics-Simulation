import React, {useEffect, useMemo, useState} from 'react';
import {Plane, X, Check} from 'lucide-react';
import {AIRCRAFT_CATALOG, AircraftSpec, resolveAircraftVariant} from '../sim/aircraftCatalog';
import {AircraftCategory, AircraftId} from '../sim/types';

interface AircraftHangarModalProps {
  open: boolean;
  activeAircraftId: AircraftId;
  activeVariantId: string;
  activeLiveryId: string;
  onSelectAircraft: (aircraftId: AircraftId, variantId: string, liveryId: string) => void;
  onClose: () => void;
}

const CATEGORIES: Array<'All' | AircraftCategory> = [
  'All',
  'Supersonic',
  'Widebody',
  'Narrowbody',
  'Regional & GA',
  'Military',
];

export const AircraftHangarModal: React.FC<AircraftHangarModalProps> = ({
  open,
  activeAircraftId,
  activeVariantId,
  activeLiveryId,
  onSelectAircraft,
  onClose,
}) => {
  const [category, setCategory] = useState<'All' | AircraftCategory>('All');
  const [previewId, setPreviewId] = useState<AircraftId>(activeAircraftId);
  const [previewVariantId, setPreviewVariantId] = useState<string>(activeVariantId);

  useEffect(() => {
    if (open) {
      setPreviewId(activeAircraftId);
      setPreviewVariantId(activeVariantId);
    }
  }, [open, activeAircraftId, activeVariantId]);

  const filtered = useMemo(() => {
    if (category === 'All') return AIRCRAFT_CATALOG;
    return AIRCRAFT_CATALOG.filter((a) => a.category === category);
  }, [category]);

  if (!open) return null;

  const baseSpec: AircraftSpec =
    AIRCRAFT_CATALOG.find((a) => a.id === previewId) ??
    AIRCRAFT_CATALOG.find((a) => a.id === activeAircraftId) ??
    AIRCRAFT_CATALOG[0];

  const {spec: resolvedSpec, variant: selectedVariant} = resolveAircraftVariant(
    baseSpec,
    previewVariantId,
  );

  const chosenLiveryId =
    baseSpec.id === activeAircraftId
      ? activeLiveryId
      : baseSpec.defaultLiveryId;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/70 pointer-events-auto"
      role="dialog"
      aria-modal="true"
      aria-label="1980s Aircraft Hangar, Variants & Livery Selection"
    >
      <div className="w-full max-w-4xl max-h-[88vh] flex flex-col rounded-xl border border-white/15 bg-[#0b111c] text-slate-100 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-white/10 bg-[#0e1624]">
          <div className="flex items-center gap-2.5">
            <Plane className="w-5 h-5 text-sky-400 shrink-0" />
            <div>
              <h2 className="font-display text-lg font-bold tracking-wide text-white leading-none">
                1980s DFW Fleet Hangar
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {AIRCRAFT_CATALOG.length} Aircraft Families · Selectable Variants, Flight Models & Historical Liveries
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Hangar"
            className="min-w-[40px] min-h-[40px] rounded-lg border border-white/15 bg-[#121926] hover:bg-slate-800 text-slate-300 hover:text-white flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Category Filter Tabs */}
        <div className="flex items-center gap-1.5 px-4 sm:px-5 py-2.5 border-b border-white/10 overflow-x-auto bg-[#0c1320]">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 border ${
                category === cat
                  ? 'bg-sky-600 border-sky-400/50 text-white'
                  : 'bg-[#121926] border-white/10 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Body: Aircraft List + Selected Aircraft Variant, Specs & Liveries */}
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[1.05fr_1.05fr] divide-y md:divide-y-0 md:divide-x divide-white/10 overflow-hidden">
          {/* Left: Scrollable Fleet Roster */}
          <div className="overflow-y-auto p-3 sm:p-4 space-y-2">
            {filtered.map((ac) => {
              const isPreview = ac.id === baseSpec.id;
              const isActive = ac.id === activeAircraftId;
              return (
                <button
                  key={ac.id}
                  type="button"
                  onClick={() => {
                    setPreviewId(ac.id);
                    setPreviewVariantId(
                      ac.id === activeAircraftId ? activeVariantId : ac.defaultVariantId,
                    );
                  }}
                  className={`w-full text-left p-3 rounded-lg border transition-colors flex items-start justify-between gap-3 ${
                    isPreview
                      ? 'bg-sky-950/55 border-sky-400/60'
                      : 'bg-[#111827]/80 border-white/10 hover:bg-[#162033]'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-display text-sm sm:text-base font-bold text-white truncate">
                        {ac.name}
                      </span>
                      {isActive && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-600/30 border border-emerald-400/40 text-[10px] font-mono-tabular font-semibold text-emerald-200 shrink-0">
                          FLYING
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono-tabular mt-0.5">
                      {ac.manufacturer} · {ac.era} · {ac.variants.length} variants
                    </div>
                  </div>
                  <div className="text-right shrink-0 font-mono-tabular text-[11px] text-slate-300">
                    <div>M {ac.flight.cruiseMach.toFixed(2)}</div>
                    <div className="text-slate-400">{ac.liveries.length} liveries</div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right: Variant Selection, Flight Model Specs & Liveries */}
          <div className="overflow-y-auto p-4 sm:p-5 flex flex-col justify-between gap-4 bg-[#0d1421]">
            <div className="space-y-4">
              <div>
                <div className="text-[11px] font-mono-tabular uppercase tracking-wider text-sky-400">
                  {baseSpec.category} · {baseSpec.era}
                </div>
                <h3 className="font-display text-xl font-bold text-white mt-0.5">
                  {resolvedSpec.name}
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed mt-1">
                  {selectedVariant.summary}
                </p>
              </div>

              {/* Selectable Aircraft Variants */}
              <div>
                <div className="text-xs font-semibold text-slate-200 mb-2">
                  Select 1980s Variant ({baseSpec.variants.length})
                </div>
                <div className="grid grid-cols-1 gap-1.5">
                  {baseSpec.variants.map((v) => {
                    const isPicked = v.id === selectedVariant.id;
                    const isFlyingVar = baseSpec.id === activeAircraftId && v.id === activeVariantId;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setPreviewVariantId(v.id)}
                        className={`w-full min-h-[40px] px-3 py-2 rounded-lg border text-left flex items-center justify-between gap-2 transition-colors ${
                          isPicked
                            ? 'bg-sky-950/75 border-sky-400/70 text-white'
                            : 'bg-[#111927] border-white/10 hover:bg-slate-800 text-slate-200'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold truncate flex items-center gap-1.5">
                            <span>{v.name}</span>
                            {isFlyingVar && (
                              <span className="text-[10px] font-mono-tabular text-emerald-300">
                                (Active)
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="text-[11px] font-mono-tabular text-sky-300 shrink-0">
                          {v.badge}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Live Resolved Variant Flight Model Specifications */}
              <div className="grid grid-cols-2 gap-2 p-3 rounded-lg border border-white/10 bg-[#090e17] text-xs font-mono-tabular">
                <div>
                  <div className="text-slate-400 text-[10px]">MASS / WING AREA</div>
                  <div className="text-slate-100 font-semibold mt-0.5">
                    {(resolvedSpec.flight.massKg / 1000).toFixed(1)} t · {resolvedSpec.flight.wingAreaM2} m²
                  </div>
                </div>
                <div>
                  <div className="text-slate-400 text-[10px]">CRUISE / VMAX</div>
                  <div className="text-slate-100 font-semibold mt-0.5">
                    M {resolvedSpec.flight.cruiseMach.toFixed(2)} · {resolvedSpec.flight.vMaxKnots} kts
                  </div>
                </div>
                <div>
                  <div className="text-slate-400 text-[10px]">PROPULSION</div>
                  <div className="text-slate-100 font-semibold mt-0.5 truncate">
                    {resolvedSpec.flight.engineLabel}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400 text-[10px]">SPAN / LENGTH</div>
                  <div className="text-slate-100 font-semibold mt-0.5">
                    {resolvedSpec.flight.wingspanM}m × {resolvedSpec.flight.lengthM}m
                  </div>
                </div>
              </div>

              {/* Selectable Liveries */}
              <div>
                <div className="text-xs font-semibold text-slate-200 mb-2">
                  Select 1980s Airline Livery ({baseSpec.liveries.length})
                </div>
                <div className="space-y-1.5">
                  {baseSpec.liveries.map((liv) => {
                    const isCurrentFlying =
                      baseSpec.id === activeAircraftId &&
                      selectedVariant.id === activeVariantId &&
                      liv.id === activeLiveryId;
                    return (
                      <button
                        key={liv.id}
                        type="button"
                        onClick={() => {
                          onSelectAircraft(baseSpec.id, selectedVariant.id, liv.id);
                          onClose();
                        }}
                        className={`w-full min-h-[42px] px-3 py-2 rounded-lg border text-left flex items-center justify-between gap-2.5 transition-colors ${
                          isCurrentFlying
                            ? 'bg-emerald-950/60 border-emerald-400/50 text-white'
                            : 'bg-[#121b2b] border-white/10 hover:bg-slate-800 text-slate-100'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className="w-3 h-3 rounded-sm shrink-0 border border-white/25"
                            style={{backgroundColor: liv.accentHex}}
                            aria-hidden="true"
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold truncate">{liv.name}</div>
                            <div className="text-[11px] text-slate-400 truncate">{liv.carrier}</div>
                          </div>
                        </div>
                        {isCurrentFlying ? (
                          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : (
                          <span className="text-[11px] font-medium text-sky-400 shrink-0">Fly</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                onSelectAircraft(baseSpec.id, selectedVariant.id, chosenLiveryId);
                onClose();
              }}
              className="w-full min-h-[44px] px-4 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold transition-colors"
            >
              Launch {selectedVariant.name} at KDFW
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

