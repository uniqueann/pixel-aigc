import { z } from 'zod'
import { HttpError } from '../errors.js'
import { accessSuiteAssets, beginSuiteUpload, completeSuiteUpload } from './assets.js'
import { createSuiteBatch, findSuiteBatch, quoteSuite } from './generation.js'
import { createSuite, findSuiteByRequest, getSuite, listSuites, listSuiteVersions, recycleSuite, saveSuiteDraft, selectSuiteVersion, updateSuite } from './projects.js'
import { registerSuiteResults } from './results.js'
import type { SuiteUser } from './repository.js'
import { ecommerceSuiteEnabled } from './config.js'

export async function handleEcommerceSuiteRoute(user: SuiteUser, method: string, path: string[], body: unknown, query: URLSearchParams) {
  if (!ecommerceSuiteEnabled()) throw new HttpError(503, '电商套图暂未开放，请稍后再试', 'SUITE_DISABLED')
  if (path[1] !== 'suites') throw new HttpError(404, '接口不存在', 'NOT_FOUND')
  const uuid = (value: string) => z.uuid().parse(value)
  if (path.length === 2) {
    if (method === 'POST') return { status: 201, body: await createSuite(user, body) }
    if (method === 'GET') return { body: await listSuites(user, z.coerce.number().int().min(1).max(1000).parse(query.get('cursor') ?? '1'), query.get('deleted') === '1') }
  }
  if (path[2] === 'by-request' && path.length === 4 && method === 'GET') return { body: await findSuiteByRequest(user, uuid(path[3])) }
  const id = uuid(path[2])
  if (path.length === 3) {
    if (method === 'GET') return { body: await getSuite(user, id) }
    if (method === 'PATCH') return { body: await updateSuite(user, id, body) }
    if (method === 'DELETE') return { body: await recycleSuite(user, id, false) }
  }
  if (path.length === 4) {
    if (path[3] === 'restore' && method === 'POST') return { body: await recycleSuite(user, id, true) }
    if (path[3] === 'assets' && method === 'POST') return { body: await beginSuiteUpload(user, id, body) }
    if (path[3] === 'quotes' && method === 'POST') return { body: await quoteSuite(user, id, body) }
    if (path[3] === 'batches' && method === 'POST') return { status: 202, body: await createSuiteBatch(user, id, body) }
  }
  if (path[3] === 'assets' && path.length === 5 && method === 'POST') {
    if (path[4] === 'complete') return { body: await completeSuiteUpload(user, id, body) }
    if (path[4] === 'access') return { body: await accessSuiteAssets(user, id, body) }
  }
  if (path[3] === 'batches' && path[4] === 'by-request' && path.length === 6 && method === 'GET')
    return { body: await findSuiteBatch(user, id, uuid(path[5])) }
  if (path[3] === 'batches' && path.length === 6 && path[5] === 'results' && method === 'POST') {
    z.object({}).strict().parse(body)
    return { body: await registerSuiteResults(user, id, uuid(path[4])) }
  }
  if (path[3] === 'slots' && path.length === 6) {
    const slotId = uuid(path[4])
    if (path[5] === 'versions' && method === 'GET') return { body: await listSuiteVersions(user, id, slotId, z.coerce.number().int().positive().max(2147483647).parse(query.get('before') ?? '2147483647')) }
    if (path[5] === 'current' && method === 'PATCH') return { body: await selectSuiteVersion(user, id, slotId, body) }
    if (path[5] === 'draft' && method === 'PATCH') return { body: await saveSuiteDraft(user, id, slotId, body) }
  }
  throw new HttpError(404, '接口不存在', 'NOT_FOUND')
}
