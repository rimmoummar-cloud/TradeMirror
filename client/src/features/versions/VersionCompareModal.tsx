import { useMemo } from 'react';
import { X, ArrowRight, GitCompare } from 'lucide-react';
import { diffSnapshots, displayValue, type DiffEntry } from '../../lib/diff';

interface VersionCompareModalProps {
  open: boolean;
  onClose: () => void;
  /** Label for the left/old side, e.g. "Original" or "Version 1". */
  oldLabel: string;
  /** Label for the right/new side, e.g. "Version 2". */
  newLabel: string;
  oldSnapshot: unknown;
  newSnapshot: unknown;
  /** When true, this is the first version — no same-shaped predecessor to diff. */
  isBaseline?: boolean;
}

const TYPE_BADGE: Record<DiffEntry['type'], { label: string; cls: string }> = {
  changed: { label: 'Changed', cls: 'bg-amber-100 text-amber-700' },
  added: { label: 'Added', cls: 'bg-green-100 text-green-700' },
  removed: { label: 'Removed', cls: 'bg-red-100 text-red-700' },
};

export function VersionCompareModal({
  open, onClose, oldLabel, newLabel, oldSnapshot, newSnapshot, isBaseline = false,
}: VersionCompareModalProps) {
  const diffs = useMemo(
    () => (open && !isBaseline ? diffSnapshots(oldSnapshot, newSnapshot) : []),
    [open, isBaseline, oldSnapshot, newSnapshot]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} aria-hidden="true" />

      <div className="relative bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2 bg-slate-50 rounded-t-xl">
          <GitCompare className="w-5 h-5 text-slate-400" />
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900 truncate">
              {isBaseline ? `${newLabel} — original baseline` : `Differences between ${oldLabel} and ${newLabel}`}
            </h3>
          </div>
          <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-700" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-5">
          {/* Summary */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            {isBaseline ? (
              <p className="text-sm text-slate-600">
                {newLabel} is the original baseline — there is no earlier version to compare it against.
                Differences appear from the next generated version onward.
              </p>
            ) : diffs.length === 0 ? (
              <p className="text-sm text-slate-600">No differences — the two versions are identical.</p>
            ) : (
              <>
                <p className="text-sm font-semibold text-slate-800">
                  {diffs.length} field{diffs.length === 1 ? '' : 's'} changed
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {diffs.map((d) => (
                    <span key={d.path} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-600">
                      {d.label}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Column headers (desktop) */}
          {diffs.length > 0 && (
            <>
              <div className="hidden sm:grid grid-cols-2 gap-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <div>{oldLabel} — previous</div>
                <div>{newLabel} — new</div>
              </div>

              <div className="space-y-3">
                {diffs.map((d) => (
                  <div key={d.path} className="rounded-lg border border-slate-200 overflow-hidden">
                    <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-800">{d.label}</span>
                      <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${TYPE_BADGE[d.type].cls}`}>
                        {TYPE_BADGE[d.type].label}
                      </span>
                    </div>
                    {/* Split on desktop (50/50), stacked on mobile (old → new) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2">
                      <div className="p-3 bg-red-50/60 border-b sm:border-b-0 sm:border-r border-slate-100">
                        <p className="text-[11px] font-medium text-red-600 mb-1">✖ Old</p>
                        <p className="text-sm text-slate-700 break-words line-through decoration-red-300">
                          {displayValue(d.oldValue)}
                        </p>
                      </div>
                      <div className="p-3 bg-green-50/60">
                        <p className="text-[11px] font-medium text-green-700 mb-1 flex items-center gap-1">
                          <ArrowRight className="w-3 h-3 sm:hidden" />✔ New
                        </p>
                        <p className="text-sm font-medium text-slate-900 break-words">
                          {displayValue(d.newValue)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
