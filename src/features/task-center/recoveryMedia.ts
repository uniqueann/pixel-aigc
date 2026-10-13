import type { TaskCenterDetail, TaskCenterMedia } from '@shared/task-center'
import { Capability } from '@/types'
import { createImageAsset } from '@/editor/services/assetService'
import { readOwnedImage } from '@/services/api/ownedImages'
import { readResultImage } from '@/features/image-workstation/imageMetadata'
import { listHistoryMetadata, listHistoryDeletions, recordWorkstationHistory, recordVideoHistory } from '@/features/assets/workstationHistory'
import { sameTaskActor, type TaskActor } from './client'

export function assertRecoveryActor(actor: TaskActor, signal?: AbortSignal) {
  if (signal?.aborted || !sameTaskActor(actor)) throw new DOMException('账号、环境或任务已切换','AbortError')
}
export function recoveredResultId(detail: TaskCenterDetail, result: TaskCenterMedia) {
  const task = detail.task
  return `${task.sourceKind === 'image_job' ? '' : `${task.sourceKind}:`}${task.sourceId}:o${result.ordinal}`
}
export async function readRecoveryImage(result: TaskCenterMedia, actor: TaskActor, signal: AbortSignal) {
  assertRecoveryActor(actor,signal)
  if (result.kind !== 'image' || result.availability !== 'available' || !result.objectKey) throw new Error('原结果不可读取，请重新读取任务详情')
  const bytes = await readOwnedImage({ objectKey:result.objectKey, url:result.url, expiresAt:Date.parse(result.urlExpiresAt), mimeType:result.mimeType }, {ownerId:actor.owner,signal})
  const measured = await readResultImage(bytes)
  assertRecoveryActor(actor,signal)
  if ((result.width > 0 && result.width !== measured.width) || (result.height > 0 && result.height !== measured.height)) throw new Error('原结果尺寸与声明不一致')
  return measured
}
const capabilities: Record<string,Capability> = { image_edit:Capability.ImageEdit, variation:Capability.Variation, text_to_image:Capability.TextToImage,
  text_to_video:Capability.TextToVideo, erase:Capability.Inpaint, repaint:Capability.Inpaint, outpaint:Capability.Outpaint, 'bg-remove':Capability.BgRemove }
/** 只对已经验证过的对象关联历史；删除过的结果不会因恢复再次登记。 */
export async function persistRecoveredResult(detail: TaskCenterDetail, result: TaskCenterMedia, actor: TaskActor, signal: AbortSignal, blob?: Blob) {
  assertRecoveryActor(actor,signal)
  const [history,deletions] = await Promise.all([listHistoryMetadata(actor.owner,true,{readOnly:true}),listHistoryDeletions(actor.owner)])
  assertRecoveryActor(actor,signal)
  const id = recoveredResultId(detail,result)
  if (deletions.some(item => item.id === id || item.objectKey === result.objectKey)) return
  const existing = history.find(item => item.objectKey === result.objectKey || item.id === id)
  if (existing) return
  const metadata = { id,taskId:detail.task.sourceId,sourceKind:detail.task.sourceKind,runtimeScope:actor.scope, ordinal:result.ordinal,objectKey:result.objectKey,
    toolSlug:detail.task.tool ?? 'smart-edit', capability:capabilities[detail.task.capability] ?? Capability.ImageEdit,
    width:result.width,height:result.height,mimeType:result.mimeType,createdAt:detail.task.createdAt,updatedAt:detail.task.updatedAt }
  if (result.kind === 'video') {
    if (!result.video) throw new Error('原视频元数据不完整，可在任务详情中播放和下载')
    await recordVideoHistory(actor.owner,{...metadata,mediaType:'video',video:{...result.video,objectKey:result.objectKey,ordinal:result.ordinal,width:result.width,height:result.height,mimeType:'video/mp4'}})
  } else {
    const measured = blob ? await readResultImage(blob) : await readRecoveryImage(result,actor,signal)
    assertRecoveryActor(actor,signal)
    await recordWorkstationHistory(actor.owner,{...metadata,width:measured.width,height:measured.height,mimeType:measured.mimeType,result:measured.blob})
  }
  assertRecoveryActor(actor,signal)
}
export interface PreparedRecoveryParameters { params: Record<string,unknown>; source?: ReturnType<typeof createImageAsset>; reference?: ReturnType<typeof createImageAsset>; sourceBlob?: Blob; referenceBlob?: Blob }
/** 参数载入先读取所有原输入；任一输入失败时不改变当前表单。 */
export async function prepareRecoveryParameters(detail: TaskCenterDetail, actor: TaskActor, signal: AbortSignal): Promise<PreparedRecoveryParameters> {
  assertRecoveryActor(actor,signal)
  if (!detail.params) throw new Error('此任务未保存参数记录，可直接查看结果或作为新图片继续编辑')
  const params = {...detail.params}
  const prepared: PreparedRecoveryParameters = {params}
  const needsSource = ['image_edit','variation'].includes(detail.task.capability) || (detail.task.capability === 'text_to_video' && params.mode === 'image_to_video')
  if (needsSource && typeof params.sourceImageKey !== 'string') throw new Error('原输入对象缺失，无法完整载入参数')
  for (const field of ['sourceImageKey','referenceImageKey'] as const) {
    if (!params[field]) continue
    if (typeof params[field] !== 'string') throw new Error('原输入参数无效')
    const blob = await readOwnedImage({objectKey:params[field] as string},{ownerId:actor.owner,signal})
    const measured = await readResultImage(blob)
    assertRecoveryActor(actor,signal)
    const asset = createImageAsset({name:field==='sourceImageKey'?'原任务输入':'原任务参考图',url:`/owned-image/${encodeURIComponent(params[field] as string)}`,
      objectKey:params[field] as string,width:measured.width,height:measured.height,mimeType:measured.mimeType})
    if (field==='sourceImageKey') { prepared.source=asset;prepared.sourceBlob=measured.blob }
    else { prepared.reference=asset;prepared.referenceBlob=measured.blob }
  }
  return prepared
}
