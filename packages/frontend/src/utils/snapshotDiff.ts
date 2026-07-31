export interface FieldDiff {
  path: string;
  type: 'added' | 'removed' | 'changed';
  oldValue?: unknown;
  newValue?: unknown;
}

export interface SnapshotDiffResult {
  snapshotId1: string;
  snapshotId2: string;
  diffs: Record<string, FieldDiff[]>;
}

const MAX_DEPTH = 10;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepCompare(
  path: string,
  oldVal: unknown,
  newVal: unknown,
  diffs: FieldDiff[],
  depth: number
): void {
  if (depth > MAX_DEPTH) return;

  if (typeof oldVal === 'function' || typeof newVal === 'function') return;
  if (typeof oldVal === 'symbol' || typeof newVal === 'symbol') return;

  if (oldVal === newVal) return;

  if (oldVal === undefined || oldVal === null) {
    if (newVal !== undefined && newVal !== null) {
      diffs.push({ path, type: 'added', newValue: newVal });
    }
    return;
  }

  if (newVal === undefined || newVal === null) {
    if (oldVal !== undefined && oldVal !== null) {
      diffs.push({ path, type: 'removed', oldValue: oldVal });
    }
    return;
  }

  const oldIsObj = isObject(oldVal);
  const newIsObj = isObject(newVal);
  const oldIsArr = Array.isArray(oldVal);
  const newIsArr = Array.isArray(newVal);

  if (oldIsArr && newIsArr) {
    const maxLen = Math.max(oldVal.length, newVal.length);
    for (let i = 0; i < maxLen; i++) {
      const itemPath = `${path}[${i}]`;
      if (i >= oldVal.length) {
        diffs.push({ path: itemPath, type: 'added', newValue: newVal[i] });
      } else if (i >= newVal.length) {
        diffs.push({ path: itemPath, type: 'removed', oldValue: oldVal[i] });
      } else {
        deepCompare(itemPath, oldVal[i], newVal[i], diffs, depth + 1);
      }
    }
    return;
  }

  if (oldIsObj && newIsObj) {
    const allKeys = new Set([...Object.keys(oldVal), ...Object.keys(newVal)]);
    for (const key of allKeys) {
      const childPath = path ? `${path}.${key}` : key;
      if (!(key in oldVal)) {
        diffs.push({ path: childPath, type: 'added', newValue: newVal[key] });
      } else if (!(key in newVal)) {
        diffs.push({ path: childPath, type: 'removed', oldValue: oldVal[key] });
      } else {
        deepCompare(childPath, oldVal[key], newVal[key], diffs, depth + 1);
      }
    }
    return;
  }

  diffs.push({ path, type: 'changed', oldValue: oldVal, newValue: newVal });
}

export function computeDiff(
  data1: Record<string, unknown>,
  data2: Record<string, unknown>,
  id1: string = 'snapshot1',
  id2: string = 'snapshot2'
): SnapshotDiffResult {
  const diffs: Record<string, FieldDiff[]> = {};
  const allStoreNames = new Set([...Object.keys(data1), ...Object.keys(data2)]);

  for (const storeName of allStoreNames) {
    const store1 = data1[storeName] as Record<string, unknown> | undefined;
    const store2 = data2[storeName] as Record<string, unknown> | undefined;
    const storeDiffs: FieldDiff[] = [];

    if (!store1 && store2) {
      storeDiffs.push({ path: '', type: 'added', newValue: store2 });
    } else if (store1 && !store2) {
      storeDiffs.push({ path: '', type: 'removed', oldValue: store1 });
    } else if (store1 && store2) {
      deepCompare('', store1, store2, storeDiffs, 0);
    }

    if (storeDiffs.length > 0) {
      diffs[storeName] = storeDiffs;
    }
  }

  return {
    snapshotId1: id1,
    snapshotId2: id2,
    diffs,
  };
}
