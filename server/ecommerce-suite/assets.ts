import { createHash, randomUUID } from 'node:crypto'
import sharp, { type Metadata } from 'sharp'
import { suiteAssetAccessRequestSchema, suiteUploadCompleteRequestSchema, suiteUploadRequestSchema, type SuiteAssetRef } from '../../shared/ecommerce-suite.js'
import { HttpError } from '../errors.js'
import { getObjectLimited, putObject, signRead, signUpload } from '../storage.js'
import { actor, fingerprint, readyAsset, requireSuite, suiteTransaction, toSuiteAsset, type SuiteUser } from './repository.js'
import { beginSuiteObjectWrite } from './object-writes.js'

export interface SuiteStorage {
  read(key: string): Promise<{ bytes: Uint8Array; contentType?: string }>
  put: typeof putObject
  signRead: typeof signRead
  signUpload: typeof signUpload
}
export const suiteStorage: SuiteStorage = {
  read: (key: string) => getObjectLimited(key, 20 * 1024 * 1024), put: putObject, signRead, signUpload,
}
const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
export const SUITE_THUMBNAIL_EDGE = 320
const thumbnailSkipUntil = new Map<string, number>()
let thumbnailColumnKnown = false
export function resetSuiteThumbnailState() {
  thumbnailColumnKnown = false
  thumbnailSkipUntil.clear()
}
function isUndefinedColumn(error: unknown) {
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    if ('code' in current && (current as { code?: unknown }).code === '42703') return true
    current = 'cause' in current ? (current as { cause?: unknown }).cause : undefined
  }
  return false
}
export async function suiteThumbnailColumnReady(user: SuiteUser) {
  if (thumbnailColumnKnown) return true
  try {
    const ready = await suiteTransaction(user, async sql => {
      const [row] = await sql`select exists(select 1 from information_schema.columns
        where table_schema='aigc' and table_name='suite_assets' and column_name='thumbnail_object_key') as ready`
      return row?.ready === true
    })
    if (ready) thumbnailColumnKnown = true
    return ready
  } catch { return false }
}
export async function renderSuiteThumbnail(bytes: Uint8Array) {
  const output = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate()
    .resize(SUITE_THUMBNAIL_EDGE, SUITE_THUMBNAIL_EDGE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 75 }).toBuffer()
  return { bytes: new Uint8Array(output), mimeType: 'image/webp' as const }
}
export function suiteThumbnailObjectKey(user: SuiteUser, projectId: string, assetId: string, checksum: string) {
  return `suite-assets/${actor(user).runtimeScope}/${user.id}/${projectId}/${assetId}-${checksum}.thumb.webp`
}
/** 缩略图失败或列尚未迁移时返回 null，调用方继续使用原图。只有明显小于原图才落库。 */
export async function rememberSuiteThumbnail(user: SuiteUser, projectId: string, asset: Pick<SuiteAssetRef, 'assetId' | 'checksum' | 'objectKey'>, storage: SuiteStorage = suiteStorage, bytes?: Uint8Array) {
  const skipKey = `${projectId}:${asset.assetId}`
  try {
    if ((thumbnailSkipUntil.get(skipKey) ?? 0) > Date.now()) return null
    if (!(await suiteThumbnailColumnReady(user))) return null
    const existing = await suiteTransaction(user, async sql => {
      const [row] = await sql`select thumbnail_object_key from aigc.suite_assets where project_id=${projectId} and id=${asset.assetId} and status='ready' and purged_at is null`
      return typeof row?.thumbnail_object_key === 'string' && row.thumbnail_object_key.startsWith('suite-assets/') ? row.thumbnail_object_key : null
    })
    if (existing) return existing
    const source = bytes ?? (await storage.read(asset.objectKey)).bytes
    const thumb = await renderSuiteThumbnail(source)
    if (thumb.bytes.byteLength * 4 >= source.byteLength) {
      thumbnailSkipUntil.set(skipKey, Date.now() + 10 * 60_000)
      return null
    }
    const key = suiteThumbnailObjectKey(user, projectId, asset.assetId, asset.checksum)
    await beginSuiteObjectWrite(user, projectId, key)
    await storage.put(key, thumb.bytes, thumb.mimeType, AbortSignal.timeout(20_000))
    const saved = await suiteTransaction(user, async sql => {
      const [row] = await sql`update aigc.suite_assets set thumbnail_object_key=${key},thumbnail_bytes=${thumb.bytes.byteLength}
        where project_id=${projectId} and id=${asset.assetId} and status='ready' and purged_at is null and thumbnail_object_key is null
        returning thumbnail_object_key`
      if (row?.thumbnail_object_key) return String(row.thumbnail_object_key)
      const [current] = await sql`select thumbnail_object_key from aigc.suite_assets where project_id=${projectId} and id=${asset.assetId} and status='ready'`
      return typeof current?.thumbnail_object_key === 'string' ? current.thumbnail_object_key : null
    })
    return saved
  } catch (error) {
    if (isUndefinedColumn(error)) thumbnailColumnKnown = false
    else console.warn(JSON.stringify({ scope: 'suite-thumbnail', projectId, assetId: asset.assetId, message: error instanceof Error ? error.message : 'thumbnail failed' }))
    return null
  }
}
export async function inspectSuiteImage(bytes: Uint8Array, expectedMime?: string) {
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new HttpError(413, '图片大小不能超过 20 MiB', 'IMAGE_TOO_LARGE')
  let metadata: Metadata
  try { metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata() }
  catch { throw new HttpError(400, '图片内容无效，请使用静态 JPEG、PNG 或 WebP', 'INVALID_IMAGE') }
  const mime = ({ jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as Record<string, string>)[metadata.format ?? '']
  if (!mime || (expectedMime && mime !== expectedMime) || (metadata.pages ?? 1) > 1 || !metadata.width || !metadata.height || Math.max(metadata.width, metadata.height) > 10000)
    throw new HttpError(400, '图片类型、像素或帧数不符合要求', 'INVALID_IMAGE')
  // 完整解码后才登记 ready，防止只有文件头合法的损坏图片进入项目。
  try { await sharp(bytes, { limitInputPixels: 40_000_000 }).stats() }
  catch { throw new HttpError(400, '图片解码失败，请重新上传', 'INVALID_IMAGE') }
  return { mimeType: mime as SuiteAssetRef['mimeType'], size: { width: metadata.autoOrient?.width ?? metadata.width, height: metadata.autoOrient?.height ?? metadata.height }, bytes: bytes.length,
    checksum: createHash('sha256').update(bytes).digest('hex') }
}
export function suiteObjectKey(user: SuiteUser, projectId: string, assetId: string, checksum: string, mimeType: string) {
  // 内容寻址避免两个完成请求把已验证对象相互覆盖；孤儿对象另行清理。
  return `suite-assets/${actor(user).runtimeScope}/${user.id}/${projectId}/${assetId}-${checksum}.${extensions[mimeType]}`
}
export async function beginSuiteUpload(user: SuiteUser, projectId: string, body: unknown, storage = suiteStorage) {
  const request = suiteUploadRequestSchema.parse(body)
  const row = await suiteTransaction(user, async sql => {
    await requireSuite(sql, projectId, true)
    const [old] = await sql`select * from aigc.suite_assets where id=${request.requestId}`
    if (old) {
      if (old.project_id !== projectId || old.request_fingerprint !== fingerprint(request)) throw new HttpError(409, '上传编号已用于其他图片', 'SUITE_REQUEST_CONFLICT')
      return old
    }
    const uploadId = randomUUID()
    const tempKey = `temporary/suite-uploads/${actor(user).runtimeScope}/${user.id}/${projectId}/${uploadId}`
    const [created] = await sql`insert into aigc.suite_assets(id,user_id,scope,project_id,request_fingerprint,upload_id,temp_key,object_key,mime_type,bytes,status)
      values(${request.requestId},${user.id},${actor(user).runtimeScope},${projectId},${fingerprint(request)},${uploadId},${tempKey},
        ${`suite-assets/${actor(user).runtimeScope}/${user.id}/${projectId}/${request.requestId}.pending`},${request.mimeType},${request.bytes},'pending') returning *`
    return created
  })
  if (row.status === 'ready') return { asset: toSuiteAsset(row) }
  return { assetId: String(row.id), uploadId: String(row.upload_id), uploadUrl: await storage.signUpload(String(row.temp_key), String(row.mime_type), Number(row.bytes)) }
}
export async function completeSuiteUpload(user: SuiteUser, projectId: string, body: unknown, storage = suiteStorage) {
  const request = suiteUploadCompleteRequestSchema.parse(body)
  const pending = await suiteTransaction(user, async sql => {
    await requireSuite(sql, projectId)
    const [row] = await sql`select * from aigc.suite_assets where project_id=${projectId} and id=${request.assetId} and upload_id=${request.uploadId}`
    if (!row) throw new HttpError(404, '上传许可不存在或无权访问', 'SUITE_ASSET_UNAVAILABLE')
    return row
  })
  if (pending.status === 'ready') return { asset: toSuiteAsset(pending) }
  const object = await storage.read(String(pending.temp_key))
  if (object.bytes.length !== Number(pending.bytes)) throw new HttpError(400, '上传文件大小不匹配', 'INVALID_IMAGE')
  const inspected = await inspectSuiteImage(object.bytes, String(pending.mime_type))
  const key = suiteObjectKey(user, projectId, request.assetId, inspected.checksum, inspected.mimeType)
  await beginSuiteObjectWrite(user, projectId, key)
  await storage.put(key, object.bytes, inspected.mimeType, AbortSignal.timeout(20_000))
  const asset = await suiteTransaction(user, async sql => {
    await requireSuite(sql, projectId, true)
    const [row] = await sql`update aigc.suite_assets set object_key=${key},width=${inspected.size.width},height=${inspected.size.height},checksum=${inspected.checksum},status='ready'
      where project_id=${projectId} and id=${request.assetId} and upload_id=${request.uploadId} and status='pending' returning *`
    return row ? toSuiteAsset(row) : readyAsset(sql, projectId, request.assetId)
  })
  await rememberSuiteThumbnail(user, projectId, asset, storage, object.bytes)
  return { asset }
}
async function readAccessAssets(user: SuiteUser, projectId: string, assetIds: string[], includeThumbnail: boolean) {
  return suiteTransaction(user, async sql => {
    await requireSuite(sql, projectId)
    return Promise.all(assetIds.map(async id => {
      const asset = await readyAsset(sql, projectId, id)
      let thumbnailObjectKey: string | null = null
      if (includeThumbnail) {
        const [row] = await sql`select thumbnail_object_key from aigc.suite_assets where project_id=${projectId} and id=${id} and status='ready' and purged_at is null`
        if (typeof row?.thumbnail_object_key === 'string' && row.thumbnail_object_key.startsWith('suite-assets/')) thumbnailObjectKey = row.thumbnail_object_key
      }
      return { asset, thumbnailObjectKey }
    }))
  })
}
export async function accessSuiteAssets(user: SuiteUser, projectId: string, body: unknown, storage = suiteStorage) {
  const request = suiteAssetAccessRequestSchema.parse(body)
  const variant = request.variant ?? 'original'
  let includeThumbnail = variant === 'thumbnail' && await suiteThumbnailColumnReady(user)
  let assets: Awaited<ReturnType<typeof readAccessAssets>>
  try { assets = await readAccessAssets(user, projectId, request.assetIds, includeThumbnail) }
  catch (error) {
    if (!includeThumbnail || !isUndefinedColumn(error)) throw error
    thumbnailColumnKnown = false
    includeThumbnail = false
    assets = await readAccessAssets(user, projectId, request.assetIds, false)
  }
  return { items: await Promise.all(assets.map(async item => {
    let key = item.asset.objectKey
    let served: 'original' | 'thumbnail' = 'original'
    if (variant === 'thumbnail' && includeThumbnail) {
      const thumbKey = item.thumbnailObjectKey ?? await rememberSuiteThumbnail(user, projectId, item.asset, storage)
      if (thumbKey) { key = thumbKey; served = 'thumbnail' }
    }
    return { assetId: item.asset.assetId, served, ...await storage.signRead(key) }
  })) }
}
