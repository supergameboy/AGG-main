// === Repository 实现 ===
export { SaveRepository } from './SaveRepository.js';
export { SaveSnapshotRepository } from './SaveSnapshotRepository.js';
export { SaveGameTimeRepository } from './SaveGameTimeRepository.js';
export { SaveStateRepository } from './SaveStateRepository.js';

// === Service + Port ===
export { SaveService } from './SaveService.js';
export { SaveDataPort } from './SaveDataPort.js';

// === 端口接口 + 类型 ===
export type {
  ISaveRepository,
  ISaveSnapshotRepository,
  ISaveStateRepository,
  ISaveGameTimeRepository,
  ISaveDataPort,
  ISaveProvider,
  SaveDataBundle,
  SaveRow,
  SaveSnapshotRow,
  SaveGameTimeRow,
  SaveStateRow,
  SaveSnapshotQueryOptions,
  SaveListOptions,
  SaveRecord,
  CompleteSaveData,
  SnapshotRecord,
  SnapshotQueryOptions,
  AutoSaveOptions,
  SaveQueryOptions,
  SaveUpdateData,
  SaveRestrictionResult,
} from './types.js';
