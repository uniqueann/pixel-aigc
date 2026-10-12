import type { TaskCenterDetail,TaskCenterMedia,TaskCenterSummary } from '../../../shared/task-center'
export const recoveryOwner='11111111-1111-4111-8111-111111111111'
export const recoveryId='22222222-2222-4222-8222-222222222222'
export const recoveryActor={owner:recoveryOwner,scope:'preview' as const}
export function recoverySummary(patch:Partial<TaskCenterSummary>={}):TaskCenterSummary {
  return {sourceKind:'image_job',sourceId:recoveryId,taskKey:`image_job:${recoveryId}`,requestId:recoveryId,tool:'text-to-image',capability:'text_to_image',modelProfileId:'fixture',
    state:'succeeded',requestedCount:2,completedCount:1,partial:true,errorCode:null,warnings:[],origin:null,billingState:'settled',creditsReserved:6,creditsCharged:3,creditsReturned:3,
    resultAvailability:'available',resultExpiresAt:null,taskExpiresAt:null,createdAt:'2026-10-12T01:00:00Z',updatedAt:'2026-10-12T01:01:00Z',completedAt:'2026-10-12T01:01:00Z',
    outcomeVersion:`v1:${'a'.repeat(32)}`,seen:false,dismissed:false,...patch}
}
export function recoveryImage(ordinal=0):TaskCenterMedia {
  return {kind:'image',ordinal,objectKey:`images/preview/${recoveryOwner}/${recoveryId}/${ordinal}.png`,mimeType:'image/png',width:64,height:64,
    url:`https://example.invalid/${ordinal}.png`,urlExpiresAt:new Date(Date.now()+900000).toISOString(),availability:'available'}
}
export function recoveryDetail(patch:Partial<TaskCenterDetail>={}):TaskCenterDetail {
  return {task:recoverySummary(),params:{prompt:'原提示词',size:{width:64,height:64},count:2,resolution:'1k'},errorMessage:null,results:[recoveryImage()],...patch}
}
