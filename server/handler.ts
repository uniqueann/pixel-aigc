import type { VercelRequest, VercelResponse } from './http.js'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { authenticate } from './auth.js'
import { database, withIdentity } from './db.js'
import { describeError, HttpError } from './errors.js'
import { identifier, projectWriteSchema, uploadSchema } from '../shared/cloud.js'
import { readProject, requireProject, toAsset, validateReferences } from './projects.js'
import { signRead, signUpload, verifyAndPromote } from './storage.js'
import { handleModelRoute } from './model-settings.js'
import { handleEmailTaskRoute } from './email-tasks.js'
import { handleImageTaskRoute, peekImageTask } from './image-jobs/route.js'
import { IMAGE_TASK_CAPABILITIES } from './image-jobs/service.js'
import { imageModelsAvailable, publicConfiguredImageModels } from './image-providers/registry.js'
import { handleTaskInputs } from './task-inputs.js'
import { detectGoodsSubject, goodsMatting, tencentCiConfig } from './tencent-ci.js'
import { eraseWithBailian } from './bailian-erase.js'
import { bailianConfig, expandWithBailian } from './bailian-outpaint.js'
import { repaintWithBailian } from './bailian-repaint.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestId = randomUUID(), start = Date.now()
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Request-Id', requestId)
  let userId: string | undefined
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const route = url.searchParams.get('__route') ?? url.pathname.replace(/^\/api/, '')
    const path = route.split('/').filter(Boolean).map(decodeURIComponent)
    const method = req.method ?? 'GET'
    if ((path.join('/') === 'internal/email-cleanup' || path.join('/') === 'internal/image-jobs-sweep') && method === 'GET') {
      const secret = process.env.CRON_SECRET
      const supplied = req.headers.authorization?.replace(/^Bearer /, '') ?? ''
      if (!secret || supplied.length !== secret.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(secret)))
        throw new HttpError(401, '未授权', 'AUTH_REQUIRED')
      const result = await database().begin(async sql => {
        await sql`set local role aigc_api`
        if (path.join('/') === 'internal/image-jobs-sweep') {
          const [expired] = await sql`select aigc.expire_overdue_image_jobs() as expired`
          const [deleted] = await sql`select aigc.purge_expired_image_jobs() as deleted`
          return { expired: Number(expired.expired), deleted: Number(deleted.deleted) }
        }
        const [row] = await sql`select aigc.purge_expired_email_tasks() as deleted`
        return { deleted: Number(row.deleted) }
      })
      res.status(200).json(result)
      return
    }
    if (path.join('/') === 'capabilities' && method === 'GET') {
      res.status(200).json({
        bgRemove: tencentCiConfig() !== null,
        outpaint: bailianConfig() !== null,
        erase: bailianConfig() !== null,
        repaint: bailianConfig() !== null,
        imageEdit: imageModelsAvailable('image_edit'),
      })
      return
    }
    if (path[0] === 'image-models' && method === 'GET') {
      const operation = url.searchParams.get('operation')
      const parsed = operation
        ? z.enum(['image_edit', 'text_to_image', 'variation', 'inpaint', 'outpaint']).safeParse(operation)
        : undefined
      if (operation && !parsed?.success) throw new HttpError(400, '不支持的图片能力', 'INVALID_REQUEST')
      res.status(200).json({ items: publicConfiguredImageModels(parsed?.data) })
      return
    }
    const heavyRoute = path[0] === 'bg-remove' || path[0] === 'subject-detect' || path[0] === 'outpaint' || path[0] === 'erase' || path[0] === 'repaint'
    const maxBytes = path[0] === 'repaint' ? 48 * 1024 * 1024 : heavyRoute ? 28 * 1024 * 1024 : 3 * 1024 * 1024
    const user = await authenticate(req.headers.authorization)
    userId = user.id
    const body: unknown = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    if (Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body ?? null)) > maxBytes) throw new HttpError(413, '请求内容过大')
    if (path.join('/') === 'bg-remove' && method === 'POST') {
      const input = z.object({
        mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        dataBase64: z.string().min(1),
      }).strict().parse(body)
      const image = Buffer.from(input.dataBase64, 'base64')
      if (!image.length || image.length > 20 * 1024 * 1024) throw new HttpError(413, '单张图片不能超过 20 MB')
      const png = await goodsMatting(image)
      res.setHeader('Content-Type', 'image/png')
      res.status(200).end(png)
      return
    }
    if (path.join('/') === 'subject-detect' && method === 'POST') {
      const input = z.object({
        mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        dataBase64: z.string().min(1),
        width: z.number().int().positive().max(20000),
        height: z.number().int().positive().max(20000),
      }).strict().parse(body)
      const image = Buffer.from(input.dataBase64, 'base64')
      if (!image.length || image.length > 20 * 1024 * 1024) throw new HttpError(413, '单张图片不能超过 20 MB')
      res.status(200).json({ box: await detectGoodsSubject(image, input.width, input.height) })
      return
    }
    if (path.join('/') === 'outpaint' && method === 'POST') {
      if (!bailianConfig()) throw new HttpError(503, '智能扩展尚未配置阿里云百炼 API Key', 'OUTPAINT_UNAVAILABLE')
      const input = z.object({
        mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        dataBase64: z.string().min(1),
        padding: z.object({
          left: z.number().int().min(0).max(20000),
          right: z.number().int().min(0).max(20000),
          top: z.number().int().min(0).max(20000),
          bottom: z.number().int().min(0).max(20000),
        }).strict(),
      }).strict().parse(body)
      const image = Buffer.from(input.dataBase64, 'base64')
      if (!image.length || image.length > 20 * 1024 * 1024) throw new HttpError(413, '单张图片不能超过 20 MB')
      const jpeg = await expandWithBailian(image, input.padding, { requestId })
      res.setHeader('Content-Type', 'image/jpeg')
      res.status(200).end(jpeg)
      console.info(JSON.stringify({
        evt: 'outpaint', requestId, userId, status: 200, route: 'outpaint',
        region: process.env.VERCEL_REGION ?? null, durationMs: Date.now() - start, bytes: jpeg.length,
      }))
      return
    }
    if (path.join('/') === 'erase' && method === 'POST') {
      if (!bailianConfig()) throw new HttpError(503, '图片消除尚未配置阿里云百炼 API Key', 'ERASE_UNAVAILABLE')
      const input = z.object({
        mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        dataBase64: z.string().min(1),
        maskMimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']).optional(),
        maskBase64: z.string().min(1),
        prompt: z.string().max(800).optional(),
      }).strict().parse(body)
      const image = Buffer.from(input.dataBase64, 'base64')
      const mask = Buffer.from(input.maskBase64, 'base64')
      if (!image.length || image.length > 20 * 1024 * 1024) throw new HttpError(413, '单张图片不能超过 20 MB')
      if (!mask.length || mask.length > 20 * 1024 * 1024) throw new HttpError(413, '蒙版不能超过 20 MB')
      const jpeg = await eraseWithBailian(image, mask, input.prompt ?? '', { requestId })
      res.setHeader('Content-Type', 'image/jpeg')
      res.status(200).end(jpeg)
      console.info(JSON.stringify({
        evt: 'erase', requestId, userId, status: 200, route: 'erase',
        region: process.env.VERCEL_REGION ?? null, durationMs: Date.now() - start, bytes: jpeg.length,
      }))
      return
    }
    if (path.join('/') === 'repaint' && method === 'POST') {
      if (!bailianConfig()) throw new HttpError(503, '重绘尚未配置阿里云百炼 API Key', 'REPAINT_UNAVAILABLE')
      const input = z.object({
        mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        dataBase64: z.string().min(1),
        maskBase64: z.string().min(1),
        prompt: z.string().min(1).max(2000),
      }).strict().parse(body)
      const image = Buffer.from(input.dataBase64, 'base64')
      const mask = Buffer.from(input.maskBase64, 'base64')
      if (!image.length || image.length > 20 * 1024 * 1024) throw new HttpError(413, '单张图片不能超过 20 MB')
      if (!mask.length || mask.length > 20 * 1024 * 1024) throw new HttpError(413, '蒙版不能超过 20 MB')
      const jpeg = await repaintWithBailian(image, mask, input.prompt, { requestId })
      res.setHeader('Content-Type', 'image/jpeg')
      res.status(200).end(jpeg)
      console.info(JSON.stringify({
        evt: 'repaint', requestId, userId, status: 200, route: 'repaint',
        region: process.env.VERCEL_REGION ?? null, durationMs: Date.now() - start, bytes: jpeg.length,
      }))
      return
    }
    if (path[0] === 'model-settings' || path[0] === 'model-profiles') {
      res.status(200).json(await handleModelRoute(user, method, path, body))
      return
    }
    if (path[0] === 'task-inputs' && path.length === 1) {
      res.status(200).json(await handleTaskInputs(user, method, body))
      return
    }
    if (path[0] === 'tasks') {
      if (method === 'POST') {
        const capability = body && typeof body === 'object' && 'capability' in body
          ? String((body as { capability?: unknown }).capability) : ''
        if (IMAGE_TASK_CAPABILITIES.has(capability)) {
          res.status(200).json(await handleImageTaskRoute(user, method, path, body, url.searchParams))
          return
        }
        if (capability && capability !== 'email_assist') {
          throw new HttpError(501, '该能力尚未接入真实任务', 'CAPABILITY_UNAVAILABLE')
        }
        res.status(200).json(await handleEmailTaskRoute(user, method, path, body, url.searchParams))
        return
      }
      if (method === 'GET' && path.length === 1 && IMAGE_TASK_CAPABILITIES.has(url.searchParams.get('capability') ?? '')) {
        res.status(200).json(await handleImageTaskRoute(user, method, path, body, url.searchParams))
        return
      }
      if (path.length === 2) {
        const id = z.uuid().safeParse(path[1])
        if (id.success && await peekImageTask(user, id.data)) {
          res.status(200).json(await handleImageTaskRoute(user, method, path, body, url.searchParams))
          return
        }
      }
      if (path[1] === 'by-request' && path.length === 3 && method === 'GET') {
        const image = await handleImageTaskRoute(user, method, path, body, url.searchParams)
        if (image) {
          res.status(200).json(image)
          return
        }
      }
      res.status(200).json(await handleEmailTaskRoute(user, method, path, body, url.searchParams))
      return
    }
    const result = await withIdentity(user.id, user.email, async sql => {
      if (path.join('/') === 'me' && method === 'POST') {
        const [row] = await sql`select aigc.initialize_member(${user.suggestedName}) as allowed`
        if (!row.allowed) throw new HttpError(403, '当前账号已被停用，请联系管理员', 'MEMBER_DISABLED')
        return accountContext(sql, user)
      }
      const [member] = await sql`select status from aigc.members where user_id=${user.id}`
      if (!member) throw new HttpError(403, '当前账号尚未初始化', 'MEMBER_UNAVAILABLE')
      if (member.status !== 'active') throw new HttpError(403, '当前账号已被停用，请联系管理员', 'MEMBER_DISABLED')
      if (path.join('/') === 'me' && method === 'GET') return accountContext(sql, user)
      if (path.join('/') === 'me' && method === 'PATCH') {
        const { displayName } = z.object({ displayName: z.string().trim().min(1).max(80) }).strict().parse(body)
        await sql`update aigc.members set display_name=${displayName},updated_at=now() where user_id=${user.id}`
        return accountContext(sql, user)
      }
      if (path[0] === 'workspaces' && path.length === 2 && method === 'PATCH') {
        const workspaceId = z.uuid().parse(path[1])
        const { name } = z.object({ name: z.string().trim().min(1).max(80) }).strict().parse(body)
        const rows = await sql`update aigc.workspaces set name=${name},updated_at=now() where id=${workspaceId} and owner_id=${user.id} returning id`
        if (!rows.length) throw new HttpError(404, '工作空间不存在或无权访问', 'NOT_FOUND')
        return accountContext(sql, user)
      }
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
          const [space] = await sql`select id from aigc.workspaces where owner_id=${user.id}`
          if (!space) throw new HttpError(403, '个人工作空间不可用', 'WORKSPACE_UNAVAILABLE')
          const rows = await sql`insert into aigc.projects(id,user_id,workspace_id,name,document,drafts) values(${id},${user.id},${space.id},${input.name},${sql.json(input.document)},${sql.json(input.drafts)}) on conflict(id) do nothing returning id`
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
      throw new HttpError(404, '接口不存在')
    })
    res.status(200).json(result)
  } catch (error) {
    const status = error instanceof HttpError ? error.status : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 500
    const message = error instanceof HttpError ? error.message : status === 400 ? '请求参数无效' : '服务暂时不可用，请稍后重试'
    const code = error instanceof HttpError ? error.code : status === 400 ? 'INVALID_REQUEST' : 'SERVER_ERROR'
    res.status(status).json({ error: message, code, requestId })
    const details = describeError(error)
    console.error(JSON.stringify({
      requestId, userId, status, category: details.name, durationMs: Date.now() - start,
      message: details.message, cause: details.cause ?? null, stage: details.stage ?? null,
    }))
  }
}

async function accountContext(sql: import('./db.js').Transaction, user: Awaited<ReturnType<typeof authenticate>>) {
  const [row] = await sql`select m.display_name as "displayName", w.id as "workspaceId",w.name as "workspaceName",wm.role
    from aigc.members m join aigc.workspaces w on w.owner_id=m.user_id
    join aigc.workspace_members wm on wm.workspace_id=w.id and wm.user_id=m.user_id and wm.status='active'
    where m.user_id=${user.id} and m.status='active'`
  if (!row) throw new HttpError(403, '账号资料不可用', 'PROFILE_UNAVAILABLE')
  return { userId: user.id, email: user.email, emailVerified: true, displayName: row.displayName,
    avatarUrl: user.avatarUrl, providers: user.providers, status: 'active',
    workspace: { id: row.workspaceId, name: row.workspaceName, type: 'personal', role: row.role } }
}
