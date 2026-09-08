import type { VercelRequest, VercelResponse } from './http.js'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { authenticate } from './auth.js'
import { withIdentity } from './db.js'
import { HttpError } from './errors.js'
import { identifier, projectWriteSchema, uploadSchema } from '../shared/cloud.js'
import { readProject, requireProject, toAsset, validateReferences } from './projects.js'
import { signRead, signUpload, verifyAndPromote } from './storage.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestId = randomUUID(), start = Date.now()
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Request-Id', requestId)
  let userId: string | undefined
  try {
    const user = await authenticate(req.headers.authorization)
    userId = user.id
    const path = new URL(req.url ?? '/', 'http://localhost').pathname.replace(/^\/api/, '').split('/').filter(Boolean).map(decodeURIComponent)
    const method = req.method ?? 'GET'
    const body: unknown = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    if (Buffer.byteLength(JSON.stringify(body ?? null)) > 3 * 1024 * 1024) throw new HttpError(413, '项目文档超过 3 MB')
    const result = await withIdentity(user.id, user.email, async sql => {
      if (path.join('/') === 'me' && method === 'POST') {
        const [row] = await sql`select aigc.claim_invitation() as allowed`
        if (!row.allowed) throw new HttpError(403, '当前账号尚未受邀或已被停用，请联系管理员')
        return { userId: user.id, email: user.email }
      }
      const [member] = await sql`select status from aigc.members where user_id=${user.id} and status='active'`
      if (!member) throw new HttpError(403, '当前账号尚未受邀或已被停用')
      if (path[0] === 'projects') {
        if (path.length === 1 && method === 'GET') {
          const rows = await sql`select id,name,revision,updated_at as "updatedAt" from aigc.projects where deleted_at is null order by updated_at desc limit 200`
          return { items: rows }
        }
        if (path.length === 1 && method === 'POST') {
          const { id, ...input } = projectWriteSchema.extend({ id: identifier }).parse(body)
          // 创建接口只接收空素材文档；随后上传素材，再进行版本化保存。
          if (input.document.scenes.some(s => s.nodes.some(n => ['image','video','generation'].includes(n.type))) || input.drafts.derived)
            throw new HttpError(400, '请先创建项目，再上传关联素材')
          const rows = await sql`insert into aigc.projects(id,user_id,name,document,drafts) values(${id},${user.id},${input.name},${sql.json(input.document)},${sql.json(input.drafts)}) on conflict(id) do nothing returning id`
          if (!rows.length) {
            const existing = await requireProject(sql, id)
            if (existing.revision !== 1) throw new HttpError(409, '项目已存在，请从云端打开或另存为新项目')
          }
          return readProject(sql, id)
        }
        if (path.length === 2) {
          const id = identifier.parse(path[1])
          if (method === 'GET') return readProject(sql, id)
          if (method === 'PUT') {
            const { baseRevision, ...input } = projectWriteSchema.extend({ baseRevision: z.number().int().positive() }).parse(body)
            const current = await requireProject(sql, id, true)
            if (current.revision !== baseRevision) throw new HttpError(409, '云端项目已更新，请处理版本冲突')
            await validateReferences(sql, id, input)
            const [row] = await sql`update aigc.projects set name=${input.name},document=${sql.json(input.document)},drafts=${sql.json(input.drafts)},revision=revision+1,updated_at=now() where id=${id} returning revision`
            return { revision: row.revision }
          }
          if (method === 'DELETE') {
            await requireProject(sql, id, true)
            await sql`update aigc.projects set deleted_at=now(),updated_at=now(),revision=revision+1 where id=${id}`
            return { deleted: true }
          }
        }
      }
      if (path.join('/') === 'assets/uploads' && method === 'POST') {
        const input = uploadSchema.parse(body)
        await requireProject(sql, input.projectId)
        const token = randomUUID()
        const key = `media/${user.id}/${token}`
        await sql`insert into aigc.assets(id,project_id,user_id,name,mime_type,size,object_key,temp_key) values(${input.assetId},${input.projectId},${user.id},${input.name},${input.mimeType},${input.size},${key},${'temporary/' + token}) on conflict(project_id,id) do nothing`
        const [row] = await sql`select * from aigc.assets where project_id=${input.projectId} and id=${input.assetId}`
        if (!row || row.size !== input.size || row.mime_type !== input.mimeType) throw new HttpError(409, '素材标识已用于其他文件')
        if (row.status === 'ready') return { asset: toAsset(row) }
        return { uploadUrl: await signUpload(row.temp_key, row.mime_type, row.size), assetId: row.id }
      }
      if (path[0] === 'assets' && path[2] === 'complete' && path.length === 3 && method === 'POST') {
        const { projectId } = z.object({ projectId: identifier }).parse(body)
        await requireProject(sql, projectId)
        const [row] = await sql`select * from aigc.assets where project_id=${projectId} and id=${path[1]} for update`
        if (!row) throw new HttpError(404, '素材不存在')
        if (row.status !== 'ready') {
          const size = await verifyAndPromote(row.temp_key, row.object_key, row.size, row.mime_type)
          const [updated] = await sql`update aigc.assets set status='ready',width=${size.width},height=${size.height} where project_id=${projectId} and id=${row.id} returning *`
          return { asset: toAsset(updated) }
        }
        return { asset: toAsset(row) }
      }
      if (path.join('/') === 'assets/access' && method === 'POST') {
        const { projectId, assetIds } = z.object({ projectId: identifier, assetIds: z.array(identifier).min(1).max(100) }).parse(body)
        await requireProject(sql, projectId)
        const rows = await sql`select id,object_key from aigc.assets where project_id=${projectId} and status='ready' and id in ${sql([...new Set(assetIds)])}`
        if (rows.length !== new Set(assetIds).size) throw new HttpError(404, '素材不存在或无权访问')
        return { items: await Promise.all(rows.map(async row => ({ id: row.id, ...await signRead(row.object_key) }))) }
      }
      if (path[0] === 'tasks') throw new HttpError(501, '真实生成服务尚未配置，本轮提供账号、素材和项目同步')
      throw new HttpError(404, '接口不存在')
    })
    res.status(200).json(result)
  } catch (error) {
    const status = error instanceof HttpError ? error.status : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 500
    const message = error instanceof HttpError ? error.message : status === 400 ? '请求参数无效' : '服务暂时不可用，请稍后重试'
    res.status(status).json({ error: message, requestId })
    console.error(JSON.stringify({ requestId, userId, status, category: error instanceof Error ? error.name : '未知错误', durationMs: Date.now() - start }))
  }
}
