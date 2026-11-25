import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useOutletContext, useSearchParams } from 'react-router-dom'
import { Alert, App, Button } from 'antd'
import { useTranslation } from 'react-i18next'
import { authEnabled } from '@/cloud/client'
import ToolSwitcher from '@/components/ToolSwitcher'
import { translateApiError } from '@/i18n/apiErrors'
import { useEmailAssistantController } from '@/features/email-assistant/useEmailAssistantController'
import { useEmailGenerationGate } from '@/features/email-assistant/useEmailGenerationGate'
import { useEmailModelConfiguration } from '@/features/email-assistant/useEmailModelConfiguration'
import { useEmailBatchController } from '@/features/email-assistant/batch/useEmailBatchController'
import { useUserStore } from '@/store/useUserStore'
import { EMAIL_OPERATION_IDS } from '@/features/email-assistant/options'
import SingleEmailAssistant from './SingleEmailAssistant'
import BatchEmailAssistant from './BatchEmailAssistant'

function formatEmailPageError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback
  const record = error as Error & {
    code?: unknown
    status?: unknown
    extra?: unknown
    requestId?: unknown
  }
  return translateApiError({
    code: typeof record.code === 'string' ? record.code : undefined,
    status: typeof record.status === 'number' ? record.status : undefined,
    extra: record.extra && typeof record.extra === 'object' ? (record.extra as Record<string, unknown>) : undefined,
    requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
    message: error.message,
    fallback,
  })
}

export default function EmailAssistant() {
  const userId = useUserStore(state => state.userId)
  return <EmailAssistantSession key={userId ?? 'local'} />
}

function EmailAssistantSession() {
  const { t } = useTranslation(['email', 'common'])
  const { openModelSettings } = useOutletContext<{ openModelSettings: () => void }>()
  const { message } = App.useApp()
  const [params, setParams] = useSearchParams()
  const { key: entryKey } = useLocation()
  const mode = params.get('mode') === 'batch' ? 'batch' : 'single'
  const rawOperation = params.get('operation')
  const entryOperation = mode === 'single'
    ? EMAIL_OPERATION_IDS.find(value => value === rawOperation)
    : undefined
  /** 资产页深链：`?taskId=` 表示直接打开这条邮件任务，与任务中心的 `?task=kind:id` 恢复流程互不影响。 */
  const deepLinkTaskId = params.get('taskId') ?? undefined
  const [batchVisited, setBatchVisited] = useState(mode === 'batch')
  const configuration = useEmailModelConfiguration()
  const gate = useEmailGenerationGate()
  const single = useEmailAssistantController({ autoRestoreLatest: !entryOperation && !params.has('mode') && !params.has('task') && !deepLinkTaskId, readOnlyRecovery: params.has('task') })
  const batch = useEmailBatchController(gate)
  const { settingsQuery, profilesQuery } = configuration
  const openTask = single.openTask
  const openedDeepLinkRef = useRef<string>()
  const modes = useMemo(
    () => [
      { value: 'single', label: t('email:modes.single') },
      { value: 'batch', label: t('email:modes.batch') },
    ],
    [t],
  )
  useEffect(() => {
    if (!deepLinkTaskId) return
    let active = true
    // 放到微任务里，StrictMode 的挂载-清理-再挂载只保留最后一次请求。
    queueMicrotask(() => {
      if (!active || openedDeepLinkRef.current === deepLinkTaskId) return
      openedDeepLinkRef.current = deepLinkTaskId
      void openTask(deepLinkTaskId).catch(error => {
        if (!active) return
        message.error(formatEmailPageError(error, t('email:errors.loadTaskFailed')))
        const next = new URLSearchParams(params)
        next.delete('taskId'); next.set('mode', 'single')
        setParams(next, { replace: true })
      })
    })
    return () => { active = false }
  }, [deepLinkTaskId, message, openTask, params, setParams, t])
  useEffect(() => {
    if (mode === 'batch' && !batchVisited) queueMicrotask(() => setBatchVisited(true))
  }, [mode, batchVisited])
  const consumeEntry = useCallback(() => {
    if (!params.has('operation')) return
    const next = new URLSearchParams(params)
    next.delete('operation'); next.set('mode', 'single')
    setParams(next, { replace: true })
  }, [params, setParams])

  return <div className="email-assistant-page">
    <h1 className="sr-only">{t('email:pageTitle')}</h1>
    <ToolSwitcher className="page-tab-row" options={modes} value={mode} onChange={value => {
      const next = new URLSearchParams(params)
      next.set('mode', value); next.delete('operation'); setParams(next)
      if (value === 'batch') setBatchVisited(true)
      if (value === 'single') void single.refreshHistory?.().catch(() => undefined)
    }} />
    {authEnabled && configuration.error ? <Alert type="error" showIcon className="email-model-alert"
      message={t('email:errors.modelSettingsLoadFailed')}
      action={<Button size="small" onClick={() => { void settingsQuery.refetch(); void profilesQuery.refetch() }}>{t('common:actions.retry')}</Button>} />
      : authEnabled && !configuration.loading && !configuration.ready ? <Alert type="info" showIcon className="email-model-alert"
        message={t('email:errors.platformModelsUnavailable')} /> : null}
    <div hidden={mode !== 'single'}>
      {gate.owner === 'batch' ? <Alert className="email-model-alert" type="info" showIcon
        message={batch.unresolved ? t('email:alerts.batchUnresolved') : t('email:alerts.batchBusy')} /> : null}
      <SingleEmailAssistant controller={single} configuration={configuration} gate={gate}
        entryOperation={entryOperation} entryKey={entryKey} onEntryConsumed={consumeEntry} />
    </div>
    {batchVisited || mode === 'batch' ? <div hidden={mode !== 'batch'}>
      <BatchEmailAssistant controller={batch} configuration={configuration} singleBusy={gate.owner === 'single'} openModelSettings={openModelSettings} />
    </div> : null}
  </div>
}
