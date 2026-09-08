import { z } from 'zod'

export const identifier = z.string().min(1).max(150)
const finite = z.number().finite()
const baseNode = z.object({
  id: identifier, name: z.string().max(300).optional(), x: finite, y: finite,
  width: finite.positive(), height: finite.positive(), rotation: finite,
  opacity: finite.min(0).max(1), visible: z.boolean(), locked: z.boolean(), zIndex: finite,
})
const node = z.discriminatedUnion('type', [
  baseNode.extend({ type: z.literal('image'), assetId: identifier }),
  baseNode.extend({ type: z.literal('video'), assetId: identifier, startTime: finite.optional(), duration: finite.optional() }),
  baseNode.extend({ type: z.literal('text'), text: z.string().max(100000), fontFamily: z.string().max(200), fontSize: finite.positive() }),
  baseNode.extend({ type: z.literal('shape'), shape: z.enum(['rect', 'ellipse']), fill: z.string().max(100) }),
  baseNode.extend({ type: z.literal('generation'), generationId: identifier, resultIndex: z.number().int().nonnegative().optional(), outputAssetId: identifier.optional() }),
])
export const documentSchema = z.object({
  version: z.literal(1), activeSceneId: identifier,
  scenes: z.array(z.object({ id: identifier, name: z.string().max(300), width: finite.positive(), height: finite.positive(),
    viewport: z.object({ zoom: finite.positive(), panX: finite, panY: finite }), nodes: z.array(node).max(5000) })).min(1).max(100),
}).superRefine((doc, ctx) => {
  const scenes = doc.scenes.map(s => s.id)
  const nodes = doc.scenes.flatMap(s => s.nodes.map(n => n.id))
  if (!scenes.includes(doc.activeSceneId) || new Set(scenes).size !== scenes.length || new Set(nodes).size !== nodes.length)
    ctx.addIssue({ code: 'custom', message: '场景或节点 ID 无效' })
})
const draft = z.object({ prompt: z.string().max(20000), presetKey: z.enum(['1:1', '4:3', '3:4', '16:9', '9:16']),
  count: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), durationSeconds: z.union([z.literal(5), z.literal(10)]) })
export const draftsSchema = z.object({
  'text-to-image': draft, 'text-to-video': draft,
  derived: z.object({ mode: z.enum(['variation', 'image-to-video']), sourceNode: baseNode.extend({ type: z.literal('image'), assetId: identifier }),
    sourceAssetId: identifier, prompt: z.string().max(20000), count: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    durationSeconds: z.union([z.literal(5), z.literal(10)]) }).optional(),
})
export const projectWriteSchema = z.object({ name: z.string().trim().min(1).max(100), document: documentSchema,
  drafts: draftsSchema, schemaVersion: z.literal(1) }).strict()
export const uploadSchema = z.object({ projectId: identifier, assetId: identifier, name: z.string().min(1).max(300),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']), size: z.number().int().positive().max(20 * 1024 * 1024) }).strict()
export type ProjectWrite = z.infer<typeof projectWriteSchema>
export interface CloudAsset {
  id: string; name: string; mimeType: string; width: number; height: number; size: number;
  objectKey: string; createdAt: string; type: 'image'; source: 'upload';
}
export interface CloudProject extends ProjectWrite {
  id: string; revision: number; createdAt: string; updatedAt: string;
  assets: CloudAsset[];
}
export interface ProjectSummary { id: string; name: string; revision: number; updatedAt: string }
