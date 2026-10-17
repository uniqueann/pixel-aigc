import { z } from 'zod'
import type { SuiteAssetRef, SuiteBatch, SuiteOperation, SuiteProject, SuiteSlotDraft, SuiteSlotVersion } from './ecommerce-suite.js'
import type { TaskCenterSummary } from './task-center.js'

/** 阶段二只接受一个槽位；整套派发在维护处理器完成后单独开放。 */
export const SUITE_SINGLE_SLOT_ONLY = '本阶段每次只处理一个槽位，请单独确认费用'
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
