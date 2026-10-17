import { suitePrecheckRequestSchema, suiteVersionSchema } from '../../shared/ecommerce-suite.js'
import { checkSuiteVersion, suiteCheck, SUITE_RULE_VERSION, type SuitePrecheck } from '../../shared/ecommerce-suite-precheck.js'
import { HttpError } from '../errors.js'
import { fingerprint, readSuite, readyAsset, requireSuite, suiteTransaction, type SuiteUser } from './repository.js'

/** 预检只冻结已有版本与证据，不创建任务、不写收费状态。 */
export function precheckSuite(user: SuiteUser, projectId: string, body: unknown): Promise<SuitePrecheck> {
  const request = suitePrecheckRequestSchema.parse(body)
  return suiteTransaction(user, async sql => {
    await requireSuite(sql, projectId, true)
    const project = await readSuite(sql, projectId)
    const items: SuitePrecheck['items'] = []
    for (const id of request.versionIds) {
      const [row] = await sql`select snapshot from aigc.suite_versions where project_id=${projectId} and id=${id}`
      if (!row) throw new HttpError(404, '被检版本不存在或无权访问', 'SUITE_NOT_FOUND')
      const version = suiteVersionSchema.parse(row.snapshot)
      const slot = project.config.slots.find(slot => slot.id === version.slotId)!
      if (items.some(item => item.slot.id === slot.id)) throw new HttpError(400, '同一槽位只能选择一个版本', 'INVALID_REQUEST')
      const asset = await readyAsset(sql, projectId, version.assetId)
      items.push({ slot, version, asset, checks: checkSuiteVersion(project, slot, version, asset, request.output) })
    }
    items.sort((a, b) => a.slot.order - b.slot.order)
    const profile = project.config.ruleProfile
    const expectedId = project.config.platform === 'amazon' ? 'amazon-us-home-kitchen' : 'general'
    const checks = [suiteCheck('rules.profile', profile.id === expectedId && profile.version === SUITE_RULE_VERSION ? 'pass' : 'unknown', '规则版本', `项目 ${profile.id}/${profile.version}；当前检查器 ${SUITE_RULE_VERSION}`, '旧规则或未知规则需复核，可在商品资料中更新规则版本')]
    if (project.config.platform === 'amazon' && items.length < 6) checks.push(suiteCheck('amazon.count', 'warning', '图片数量建议', `本次选择 ${items.length} 张；至少六张为公开建议，不是强制七槽位`, '可补充其他可用图片', 'snapshot', 'https://sell.amazon.com/blog/product-photos'))
    return { projectId, projectRevision: project.revision, title: project.config.title, platform: project.config.platform,
      ...(project.config.marketplace ? { marketplace: project.config.marketplace } : {}), ruleProfile: profile, ruleVersion: SUITE_RULE_VERSION,
      ruleReviewedAt: '2026-10-17', checkedAt: new Date().toISOString(), fingerprint: fingerprint({ config: project.config, heads: project.slotHeads, versions: items.map(item => item.version), assets: items.map(item => item.asset), output: request.output, ruleVersion: SUITE_RULE_VERSION }),
      checkedVersionIds: items.map(item => item.version.id), output: request.output, items, checks }
  })
}
