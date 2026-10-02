import { describe, it, expect } from 'vitest'
import { projectWriteSchema, uploadSchema } from './cloud'
const draft = { prompt: '', presetKey: '1:1', count: 1, durationSeconds: 5 }
const project = { name: '测试', schemaVersion: 1, document: { version: 1, activeSceneId: 's', scenes: [{ id: 's', name: '场景', width: 100, height: 100, viewport: { zoom: 1, panX: 0, panY: 0 }, nodes: [] }] }, drafts: { 'text-to-image': draft, 'text-to-video': draft } }
describe('云端写入边界', () => {
  it('旧草稿可继续写入，文生图模型和分辨率随草稿完整保留', () => {
    const legacy = projectWriteSchema.parse(project)
    expect(legacy.drafts['text-to-image'].modelProfileId).toBeUndefined()
    expect(legacy.drafts['text-to-image'].resolution).toBeUndefined()
    const current = projectWriteSchema.parse({ ...project, drafts: {
      ...project.drafts,
      'text-to-image': { ...draft, modelProfileId: 'dragoncode:gpt-image-2', resolution: '4k' },
    } })
    expect(current.drafts['text-to-image']).toMatchObject({ modelProfileId: 'dragoncode:gpt-image-2', resolution: '4k' })
  })
  it('拒绝无效的文生图草稿模型和分辨率', () => {
    for (const invalid of [{ modelProfileId: '' }, { resolution: '8k' }]) {
      expect(projectWriteSchema.safeParse({ ...project, drafts: {
        ...project.drafts, 'text-to-image': { ...draft, ...invalid },
      } }).success).toBe(false)
    }
  })
  it('项目快照不能夹带任务、额度和所有者写入', () => {
    expect(projectWriteSchema.safeParse(project).success).toBe(true)
    for (const extra of [{ generations: {} }, { user_id: 'other' }, { credits: 999 }]) expect(projectWriteSchema.safeParse({ ...project,...extra }).success).toBe(false)
  })
  it('拒绝重复场景和不存在的活动场景', () => {
    expect(projectWriteSchema.safeParse({ ...project, document: { ...project.document, activeSceneId: 'missing' } }).success).toBe(false)
    expect(projectWriteSchema.safeParse({ ...project, document: { ...project.document, scenes: [...project.document.scenes,...project.document.scenes] } }).success).toBe(false)
  })
  it('拒绝超限和非图片上传', () => {
    const input = { projectId: 'p', assetId: 'a', name: '图', mimeType: 'image/png', size: 100 }
    expect(uploadSchema.safeParse(input).success).toBe(true)
    expect(uploadSchema.safeParse({ ...input,size: 21 * 1024 * 1024 }).success).toBe(false)
    expect(uploadSchema.safeParse({ ...input,mimeType: 'image/svg+xml' }).success).toBe(false)
  })
})
