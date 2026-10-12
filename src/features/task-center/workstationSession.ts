import { z } from 'zod'
import { sameTaskActor,type TaskActor } from './client'
import type { TaskTool } from '@shared/task-center'

const identity=z.object({sourceKind:z.enum(['image_job','sync_credit']),sourceId:z.uuid()}).strict()
const schema=z.object({v:z.literal(1),updatedAt:z.number(),task:identity.optional(),input:identity.extend({ordinal:z.number().int().min(0)}).optional()}).strict()
export type WorkstationSession=z.infer<typeof schema>
const key=(actor:TaskActor,tool:TaskTool)=>`pixel-workstation-session:${actor.owner}:${actor.scope}:${tool}`
export function readWorkstationSession(actor:TaskActor,tool:TaskTool):WorkstationSession|null {
  try {
    const parsed=schema.safeParse(JSON.parse(localStorage.getItem(key(actor,tool))??'null'))
    return parsed.success&&parsed.data.updatedAt>Date.now()-7*86400000&&parsed.data.updatedAt<=Date.now()+1000?parsed.data:null
  } catch {return null}
}
/** 只保存原任务身份与结果序号；不保存图片、正文、蒙版或签名地址。 */
export function saveWorkstationSession(actor:TaskActor,tool:TaskTool,patch:Partial<Pick<WorkstationSession,'task'|'input'>>):boolean {
  if(!sameTaskActor(actor))return false
  try {
    const value=schema.parse({...readWorkstationSession(actor,tool),v:1,...patch,updatedAt:Date.now()})
    localStorage.setItem(key(actor,tool),JSON.stringify(value));return true
  } catch {return false}
}
