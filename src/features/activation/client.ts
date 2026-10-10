import { UPLOAD_TOOLS, type UploadTool, type WelcomePatch, type WelcomeState } from '@shared/activation'
import { authEnabled, cloudRequest } from '@/cloud/client'
import { useUserStore } from '@/store/useUserStore'

interface LocalWelcome { creditNoticeSeen?: true; starterCardDismissed?: true }
const key = (owner: string, kind: string) => {
  const account = useUserStore.getState().account
  const scope = account?.userId === owner ? account.runtimeScope ?? 'local' : 'local'
  return `pixel:activation:v1:${window.location.origin}:${scope}:${owner}:${kind}`
}
const uploading = new Set<string>()
const uploaded = new Set<string>()
const pendingUploads = new Map<string, UploadTool>()

export function readLocalWelcome(owner: string): LocalWelcome {
  try {
    const value = JSON.parse(localStorage.getItem(key(owner, 'welcome')) ?? '{}')
    return { ...(value?.creditNoticeSeen === true ? { creditNoticeSeen: true } : {}),
      ...(value?.starterCardDismissed === true ? { starterCardDismissed: true } : {}) }
  }
  catch { return {} }
}

export async function saveWelcomeState(owner: string, patch: WelcomePatch) {
  const scope = useUserStore.getState().account?.runtimeScope ?? 'local'
  const saved = await cloudRequest<WelcomeState>('/activation', 'PATCH', patch, { expectedUserId: owner, timeoutMs: 10000 })
  const account = useUserStore.getState().account
  if (account?.userId === owner && (account.runtimeScope ?? 'local') === scope && account.welcome) useUserStore.setState({ account: { ...account, welcome: {
    ...saved,
    creditNoticeSeen: account.welcome.creditNoticeSeen || saved.creditNoticeSeen,
    starterCardDismissed: account.welcome.starterCardDismissed || saved.starterCardDismissed,
    analyticsEnabled: patch.analyticsEnabled === undefined ? account.welcome.analyticsEnabled : saved.analyticsEnabled,
  } } })
  return saved
}

/** 提示状态先在本机记住；云端暂时失败时，下次登录补交，避免重复打扰。 */
export function acknowledgeWelcome(owner: string, patch: LocalWelcome) {
  if (useUserStore.getState().userId !== owner) return
  const next = { ...readLocalWelcome(owner), ...patch }
  try { localStorage.setItem(key(owner, 'welcome'), JSON.stringify(next)) } catch { /* 当前会话仍可关闭提示。 */ }
  const account = useUserStore.getState().account
  if (account?.welcome) useUserStore.setState({ account: { ...account, welcome: { ...account.welcome, ...patch } } })
  if (authEnabled) void saveWelcomeState(owner, next).catch(() => { /* 下次登录重试。 */ })
}

export function uploadToolForPath(
  pathname = typeof window === 'undefined' ? '' : window.location.pathname,
  search = typeof window === 'undefined' ? '' : window.location.search,
): UploadTool | undefined {
  if (pathname === '/email') return new URLSearchParams(search).get('mode') === 'batch' ? 'email-batch' : undefined
  const [group, slug] = pathname.split('/').filter(Boolean)
  if (!['image-workstation', 'toolbox', 'canvas'].includes(group)) return
  return UPLOAD_TOOLS.find(tool => tool === slug)
}

export async function flushUploadEvent(owner: string) {
  const requestKey = key(owner, 'upload')
  if (!authEnabled || useUserStore.getState().userId !== owner || uploading.has(requestKey) || uploaded.has(requestKey)) return
  const account = useUserStore.getState().account
  if (account?.welcome?.analyticsEnabled === false) {
    pendingUploads.delete(requestKey)
    try { localStorage.removeItem(requestKey) } catch { /* 存储受限不影响操作。 */ }
    return
  }
  let tool: UploadTool | undefined
  tool = pendingUploads.get(requestKey)
  try { tool ??= UPLOAD_TOOLS.find(value => value === localStorage.getItem(requestKey)) } catch { /* 使用当前会话的待提交事件。 */ }
  if (!tool) return
  uploading.add(requestKey)
  try {
    await cloudRequest('/activation/events', 'POST', { event: 'first_upload', tool }, { expectedUserId: owner, timeoutMs: 10000 })
    if (useUserStore.getState().userId !== owner) return
    uploaded.add(requestKey)
    pendingUploads.delete(requestKey)
    try { localStorage.removeItem(requestKey) } catch { /* 服务端已按账号去重。 */ }
  } catch { /* 网络恢复或下次登录时补交，不影响素材操作。 */ }
  finally { uploading.delete(requestKey) }
}

export function trackFirstUpload(owner: string | null, tool: UploadTool | undefined) {
  if (!authEnabled || !owner || !tool || useUserStore.getState().userId !== owner
    || useUserStore.getState().account?.welcome?.analyticsEnabled === false) return
  const requestKey = key(owner, 'upload')
  if (uploaded.has(requestKey)) return
  let firstTool = pendingUploads.get(requestKey)
  try { firstTool ??= UPLOAD_TOOLS.find(value => value === localStorage.getItem(requestKey)) } catch { /* 使用当前会话的首个工具。 */ }
  firstTool ??= tool
  pendingUploads.set(requestKey, firstTool)
  try { localStorage.setItem(requestKey, firstTool) } catch { /* 存储受限时仍在当前会话提交。 */ }
  void flushUploadEvent(owner)
}

export function syncActivation(owner: string) {
  const local = readLocalWelcome(owner)
  if (authEnabled && Object.keys(local).length) void saveWelcomeState(owner, local).catch(() => { /* 保留下次补交。 */ })
  void flushUploadEvent(owner)
}
