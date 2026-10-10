import { z } from 'zod'

export interface WelcomeState {
  initialCredits: number | null
  creditNoticeSeen: boolean
  starterCardDismissed: boolean
  analyticsEnabled: boolean
  hasCreatedWork: boolean
}

export const welcomePatchSchema = z.object({
  creditNoticeSeen: z.literal(true).optional(),
  starterCardDismissed: z.literal(true).optional(),
  analyticsEnabled: z.boolean().optional(),
}).strict().refine(value => Object.keys(value).length > 0)
export type WelcomePatch = z.infer<typeof welcomePatchSchema>

export const UPLOAD_TOOLS = [
  'smart-edit', 'relight', 'remove', 'repaint', 'variation', 'fusion', 'outpaint', 'retouch',
  'bg-remove', 'watermark', 'aspect-ratio', 'pipeline',
  'text-to-image', 'text-to-video', 'email-batch',
] as const
export type UploadTool = typeof UPLOAD_TOOLS[number]
export const uploadEventSchema = z.object({ event: z.literal('first_upload'), tool: z.enum(UPLOAD_TOOLS) }).strict()
