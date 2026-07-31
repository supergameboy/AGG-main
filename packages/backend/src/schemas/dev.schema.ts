import { z } from 'zod';

export const snapshotCreateSchema = z.object({
  type: z.enum(['auto', 'manual'], {
    message: 'type must be one of: auto, manual',
  }),
  data: z.string().min(1, 'data is required'),
  storeNames: z.string().min(1, 'storeNames is required'),
  sessionId: z.string().max(200).optional(),
  timestamp: z.number().int().min(0),
});

export const snapshotQuerySchema = z.object({
  type: z.enum(['auto', 'manual'], {
    message: 'type must be one of: auto, manual',
  }).optional(),
  sessionId: z.string().max(200).optional(),
  limit: z.preprocess(
    (val) => {
      if (typeof val === 'string') {
        const parsed = parseInt(val, 10);
        return isNaN(parsed) ? undefined : parsed;
      }
      return val;
    },
    z.number().int().min(1).max(1000).default(50)
  ).optional(),
  offset: z.preprocess(
    (val) => {
      if (typeof val === 'string') {
        const parsed = parseInt(val, 10);
        return isNaN(parsed) ? undefined : parsed;
      }
      return val;
    },
    z.number().int().min(0).default(0)
  ).optional(),
});

export const snapshotCompareSchema = z.object({
  snapshotId1: z.string().min(1, 'snapshotId1 is required'),
  snapshotId2: z.string().min(1, 'snapshotId2 is required'),
});

export const consistencyReportSchema = z.object({
  checkTime: z.number().int().min(0),
  totalChecks: z.number().int().min(0),
  mismatchCount: z.number().int().min(0),
  details: z.string().min(1, 'details is required'),
  sessionId: z.string().max(200).optional(),
});

export const debugExportSchema = z.object({
  data: z.string().min(1, 'data is required'),
  sessionId: z.string().max(200).optional(),
});

export const llmMetricsQuerySchema = z.object({
  timeRange: z.preprocess(
    (val) => (val === '' || val === undefined ? '24h' : val),
    z.enum(['1h', '6h', '24h', '7d'])
  ).default('24h').optional(),
  stage: z.string().min(1).max(100).optional(),
  limit: z.preprocess(
    (val) => {
      if (typeof val === 'string') {
        const parsed = parseInt(val, 10);
        return isNaN(parsed) ? undefined : parsed;
      }
      return val;
    },
    z.number().int().min(1).max(100).default(20)
  ).optional(),
});

export type SnapshotCreateBody = z.infer<typeof snapshotCreateSchema>;
export type SnapshotQueryParams = z.infer<typeof snapshotQuerySchema>;
export type SnapshotCompareBody = z.infer<typeof snapshotCompareSchema>;
export type ConsistencyReportBody = z.infer<typeof consistencyReportSchema>;
export type DebugExportBody = z.infer<typeof debugExportSchema>;
export type LLMMetricsQueryParams = z.infer<typeof llmMetricsQuerySchema>;
