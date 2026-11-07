import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useOutletContext, useSearchParams } from 'react-router-dom'
import { Alert, App, Button } from 'antd'
import { authEnabled } from '@/cloud/client'
import ToolSwitcher from '@/components/ToolSwitcher'
import { useEmailAssistantController } from '@/features/email-assistant/useEmailAssistantController'
import { useEmailGenerationGate } from '@/features/email-assistant/useEmailGenerationGate'
import { useEmailModelConfiguration } from '@/features/email-assistant/useEmailModelConfiguration'
import { useEmailBatchController } from '@/features/email-assistant/batch/useEmailBatchController'
import { useUserStore } from '@/store/useUserStore'
import { EMAIL_OPERATIONS } from '@/features/email-assistant/options'
import SingleEmailAssistant from './SingleEmailAssistant'
import BatchEmailAssistant from './BatchEmailAssistant'

const MODES = [{ value: 'single', label: '单个' }, { value: 'batch', label: '批量' }]

export default function EmailAssistant() {
  const userId = useUserStore(state => state.userId)
  return <EmailAssistantSession key={userId ?? 'local'} />
}

function EmailAssistantSession() {
  const { openModelSettings } = useOutletContext<{ openModelSettings: () => void }>()
  const { message } = App.useApp()
  const [params, setParams] = useSearchParams()
  const { key: entryKey } = useLocation()
  const mode = params.get('mode') === 'batch' ? 'batch' : 'single'
  const entryOperation = mode === 'single' ? EMAIL_OPERATIONS.find(item => item.value === params.get('operation'))?.value : undefined
  /** 资产页深链：`?taskId=` 表示直接打开这条邮件任务，与任务中心的 `?task=kind:id` 恢复流程互不影响。 */
  const deepLinkTaskId = params.get('taskId') ?? undefined
  const [batchVisited, setBatchVisited] = useState(mode === 'batch')
  const configuration = useEmailModelConfiguration()
  const gate = useEmailGenerationGate()
  const single = useEmailAssistantController({ autoRestoreLatest: !entryOperation && !params.has('mode') && !params.has('task') && !deepLinkTaskId,readOnlyRecovery:params.has('task') })
  const batch = useEmailBatchController(gate)
  const { settingsQuery, profilesQuery } = configuration
  const openTask = single.openTask
  const openedDeepLinkRef = useRef<string>()
  useEffect(() => {
    if (!deepLinkTaskId) return
    let active = true
    // 放到微任务里，StrictMode 的挂载-清理-再挂载只保留最后一次请求。
    queueMicrotask(() => {
      if (!active || openedDeepLinkRef.current === deepLinkTaskId) return
      openedDeepLinkRef.current = deepLinkTaskId
      void openTask(deepLinkTaskId).catch(error => {
        if (!active) return
        message.error(error instanceof Error ? error.message : '邮件任务加载失败')
        const next = new URLSearchParams(params)
        next.delete('taskId'); next.set('mode', 'single')
        setParams(next, { replace: true })
      })
    })
    return () => { active = false }
  }, [deepLinkTaskId, message, openTask, params, setParams])
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
    <h1 className="sr-only">邮件助手</h1>
    <ToolSwitcher className="page-tab-row" options={MODES} value={mode} onChange={value => {
      const next = new URLSearchParams(params)
      next.set('mode', value); next.delete('operation'); setParams(next)
      if (value === 'batch') setBatchVisited(true)
      if (value === 'single') void single.refreshHistory?.().catch(() => undefined)
    }} />
    {authEnabled && configuration.error ? <Alert type="error" showIcon className="email-model-alert"
      message="模型设置加载失败，请重试"
      action={<Button size="small" onClick={() => { void settingsQuery.refetch(); void profilesQuery.refetch() }}>重试</Button>} />
      : authEnabled && !configuration.loading && !configuration.ready ? <Alert type="info" showIcon className="email-model-alert"
        message="平台邮件模型暂不可用，请稍后重试" /> : null}
    <div hidden={mode !== 'single'}>
      {gate.owner === 'batch' ? <Alert className="email-model-alert" type="info" showIcon
        message={batch.unresolved ? '批量邮件等待确认原任务状态，确认后可继续单个生成' : '批量邮件正在处理，暂停并等待当前邮件完成后可继续单个生成'} /> : null}
      <SingleEmailAssistant controller={single} configuration={configuration} gate={gate}
        entryOperation={entryOperation} entryKey={entryKey} onEntryConsumed={consumeEntry} />
    </div>
    {batchVisited || mode === 'batch' ? <div hidden={mode !== 'batch'}>
      <BatchEmailAssistant controller={batch} configuration={configuration} singleBusy={gate.owner === 'single'} openModelSettings={openModelSettings} />
    </div> : null}
  </div>
}
