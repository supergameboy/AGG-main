export interface MismatchItem {
  storeName: string;
  fieldPath: string;
  frontendValue: unknown;
  backendValue: unknown;
  mismatchType: 'missing' | 'different' | 'extra';
  isBackendOnly?: boolean;
}

/** 后端表名 → 前端Store路径映射 */
const BACKEND_TO_FRONTEND_MAP: Record<string, string> = {
  characters: 'game.player',
  inventory: 'game.inventory',
  itemPool: 'game.itemPool',
  quests: 'game.quests',
  npcs: 'game.npcs',
  locations: 'map.locations',
  characterSkills: 'game.skills',
  // 以下仅后端有数据，前端无对应Store
  skillPool: '__backend_only__',
  storyEvents: '__backend_only__',
  npcGoals: '__backend_only__',
  npcCurrencies: '__backend_only__',
  entityGraphNodes: '__backend_only__',
  entityGraphEdges: '__backend_only__',
};

const MAX_DEPTH = 10;

function shouldIgnore(value: unknown): boolean {
  return typeof value === 'function' || typeof value === 'symbol' || value === undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.prototype.toString.call(value) === '[object Object]';
}

function compareValues(
  backend: unknown,
  frontend: unknown,
  storeName: string,
  path: string,
  depth: number,
  results: MismatchItem[]
): void {
  if (depth > MAX_DEPTH) return;

  if (shouldIgnore(backend) && shouldIgnore(frontend)) return;

  if (shouldIgnore(backend) && !shouldIgnore(frontend)) {
    results.push({
      storeName,
      fieldPath: path,
      frontendValue: frontend,
      backendValue: backend,
      mismatchType: 'extra',
    });
    return;
  }

  if (!shouldIgnore(backend) && shouldIgnore(frontend)) {
    results.push({
      storeName,
      fieldPath: path,
      frontendValue: frontend,
      backendValue: backend,
      mismatchType: 'missing',
    });
    return;
  }

  if (Array.isArray(backend) && Array.isArray(frontend)) {
    const maxLen = Math.max(backend.length, frontend.length);
    for (let i = 0; i < maxLen; i++) {
      const itemPath = `${path}[${i}]`;
      const bItem = i < backend.length ? backend[i] : undefined;
      const fItem = i < frontend.length ? frontend[i] : undefined;

      if (i >= backend.length) {
        results.push({
          storeName,
          fieldPath: itemPath,
          frontendValue: fItem,
          backendValue: undefined,
          mismatchType: 'extra',
        });
      } else if (i >= frontend.length) {
        results.push({
          storeName,
          fieldPath: itemPath,
          frontendValue: undefined,
          backendValue: bItem,
          mismatchType: 'missing',
        });
      } else {
        compareValues(bItem, fItem, storeName, itemPath, depth + 1, results);
      }
    }
    return;
  }

  if (isPlainObject(backend) && isPlainObject(frontend)) {
    const allKeys = new Set([...Object.keys(backend), ...Object.keys(frontend)]);
    for (const key of allKeys) {
      const childPath = path ? `${path}.${key}` : key;
      const bVal = backend[key];
      const fVal = frontend[key];

      if (shouldIgnore(bVal) && shouldIgnore(fVal)) continue;

      if (!(key in backend)) {
        results.push({
          storeName,
          fieldPath: childPath,
          frontendValue: fVal,
          backendValue: undefined,
          mismatchType: 'extra',
        });
      } else if (!(key in frontend)) {
        results.push({
          storeName,
          fieldPath: childPath,
          frontendValue: undefined,
          backendValue: bVal,
          mismatchType: 'missing',
        });
      } else {
        compareValues(bVal, fVal, storeName, childPath, depth + 1, results);
      }
    }
    return;
  }

  if (backend !== frontend) {
    results.push({
      storeName,
      fieldPath: path,
      frontendValue: frontend,
      backendValue: backend,
      mismatchType: 'different',
    });
  }
}

/** 根据映射路径从对象中获取嵌套值 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function compareWithBackend(
  backendData: Record<string, unknown>,
  frontendStores: Record<string, unknown>
): MismatchItem[] {
  const results: MismatchItem[] = [];

  for (const [backendKey, backendValue] of Object.entries(backendData)) {
    if (backendKey === 'saveId') continue;

    const frontendPath = BACKEND_TO_FRONTEND_MAP[backendKey];

    // 后端独有数据：标记为 backend-only，不做比较
    if (frontendPath === '__backend_only__') {
      results.push({
        storeName: backendKey,
        fieldPath: '',
        frontendValue: undefined,
        backendValue: backendValue,
        mismatchType: 'missing',
        isBackendOnly: true,
      });
      continue;
    }

    // 使用映射路径获取前端值
    const frontendValue = frontendPath
      ? getNestedValue(frontendStores, frontendPath)
      : frontendStores[backendKey];

    if (frontendValue === undefined) {
      results.push({
        storeName: backendKey,
        fieldPath: '',
        frontendValue: undefined,
        backendValue: backendValue,
        mismatchType: 'missing',
      });
      continue;
    }

    compareValues(backendValue, frontendValue, backendKey, '', 0, results);
  }

  return results;
}
