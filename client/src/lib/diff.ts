// ---------------------------------------------------------------------------
// JSON snapshot diff engine for trade version comparison.
//
// Flattens two snapshots into dot-path → value maps (recursing plain objects),
// then classifies every differing path as changed / added / removed. Unchanged
// fields are dropped. Labels are generated dynamically from the path.
// ---------------------------------------------------------------------------

export type DiffType = 'changed' | 'added' | 'removed';

export interface DiffEntry {
  path: string;        // e.g. "contact.name"
  label: string;       // e.g. "Contact Name"
  type: DiffType;
  oldValue: unknown;
  newValue: unknown;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// Keys that are noise for an audit diff (ids/timestamps/internal blobs).
const IGNORED_LEAF_KEYS = new Set(['id', '_meta', 'rawTextPreview']);

/** Flatten a snapshot into { "a.b.c": value }, recursing plain objects only. */
function flatten(obj: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (!isPlainObject(obj)) {
    if (prefix) out[prefix] = obj;
    return out;
  }
  for (const [key, value] of Object.entries(obj)) {
    if (IGNORED_LEAF_KEYS.has(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      flatten(value, path, out);
    } else {
      out[path] = value;
    }
  }
  return out;
}

/** snake_case / camelCase / dotted path → "Title Case Words". */
export function humanizeLabel(path: string): string {
  return path
    .split('.')
    .map((seg) =>
      seg
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase → camel Case
        .replace(/[_-]+/g, ' ')
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase())
    )
    .join(' ');
}

const norm = (v: unknown) => (v === undefined || v === null || v === '' ? null : v);
const equal = (a: unknown, b: unknown) => {
  const na = norm(a), nb = norm(b);
  if (na === nb) return true;
  return JSON.stringify(na) === JSON.stringify(nb);
};

/** Compute the differences from `oldSnap` to `newSnap`. */
export function diffSnapshots(oldSnap: unknown, newSnap: unknown): DiffEntry[] {
  const oldFlat = flatten(oldSnap);
  const newFlat = flatten(newSnap);
  const paths = Array.from(new Set([...Object.keys(oldFlat), ...Object.keys(newFlat)]));

  const entries: DiffEntry[] = [];
  for (const path of paths) {
    const inOld = path in oldFlat;
    const inNew = path in newFlat;
    const oldValue = oldFlat[path];
    const newValue = newFlat[path];

    if (inOld && inNew) {
      if (!equal(oldValue, newValue)) {
        entries.push({ path, label: humanizeLabel(path), type: 'changed', oldValue, newValue });
      }
    } else if (!inOld && inNew) {
      if (norm(newValue) !== null) {
        entries.push({ path, label: humanizeLabel(path), type: 'added', oldValue: undefined, newValue });
      }
    } else if (inOld && !inNew) {
      if (norm(oldValue) !== null) {
        entries.push({ path, label: humanizeLabel(path), type: 'removed', oldValue, newValue: undefined });
      }
    }
  }

  return entries.sort((a, b) => a.label.localeCompare(b.label));
}

/** Render any leaf value for display. */
export function displayValue(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// ---------------------------------------------------------------------------
// Canonical, audit-safe output contract (MODIFIED / ADDED / REMOVED).
// Minimal by construction — only changed fields are present.
// ---------------------------------------------------------------------------

export interface VersionChange {
  field: string;   // flattened path, e.g. "buyer.contact.name"
  label: string;   // human label, e.g. "Buyer Contact Name"
  type: 'MODIFIED' | 'ADDED' | 'REMOVED';
  old_value: unknown;
  new_value: unknown;
}

export interface VersionDiffResult {
  summary: string;
  changes: VersionChange[];
}

const TYPE_MAP = { changed: 'MODIFIED', added: 'ADDED', removed: 'REMOVED' } as const;

/** Compute the precise, minimal diff between two snapshots in the canonical contract. */
export function computeVersionDiff(snapshotA: unknown, snapshotB: unknown): VersionDiffResult {
  const changes: VersionChange[] = diffSnapshots(snapshotA, snapshotB).map((d) => ({
    field: d.path,
    label: d.label,
    type: TYPE_MAP[d.type],
    old_value: d.oldValue ?? null,
    new_value: d.newValue ?? null,
  }));
  return { summary: `${changes.length} field${changes.length === 1 ? '' : 's'} changed`, changes };
}
