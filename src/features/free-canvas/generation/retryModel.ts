import { recoveryForTask } from '@/editor/persistence/persistenceStore'

/**
 * 重试报价与提交共用原任务模型。
 * 刷新后内存任务会丢掉 modelProfileId，只回退到恢复记录里的原请求，不借用当前草稿模型。
 */
export function modelProfileIdForRetry(task: { id: string; modelProfileId?: string }) {
  return task.modelProfileId ?? recoveryForTask(task.id)?.request.modelProfileId
}
