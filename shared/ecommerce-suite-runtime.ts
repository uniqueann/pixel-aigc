import { z } from 'zod'
import type { SuiteAssetRef, SuiteBatch, SuiteOperation, SuiteProject, SuiteSlotDraft, SuiteSlotVersion } from './ecommerce-suite.js'
import type { TaskCenterSummary } from './task-center.js'

export const suiteImportAssetRequestSchema = z.object({
  requestId: z.uuid(), sourceAssetId: z.uuid(), sourceProjectId: z.uuid(),
}).strict()
export interface SuiteProjectDetail {
  project: SuiteProject
  assets: SuiteAssetRef[]
  versions: SuiteSlotVersion[]
  drafts: { slotId: string; revision: number; value: SuiteSlotDraft | null }[]
  batches: SuiteBatch[]
  operations: SuiteOperation[]
  tasks: TaskCenterSummary[]
}
export interface SuiteProjectList {
  items: { project: SuiteProject; readySlots: number; enabledSlots: number; baseReady: boolean }[]
  nextCursor: string | null
}
export interface SuiteBatchDetail { batch: SuiteBatch; operations: SuiteOperation[]; tasks: TaskCenterSummary[] }
