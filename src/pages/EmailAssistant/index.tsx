import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Alert, Button } from 'antd'
import { authEnabled } from '@/cloud/client'
import ToolSwitcher from '@/components/ToolSwitcher'
import { useEmailAssistantController } from '@/features/email-assistant/useEmailAssistantController'
import { useEmailGenerationGate } from '@/features/email-assistant/useEmailGenerationGate'
import { useEmailModelConfiguration } from '@/features/email-assistant/useEmailModelConfiguration'
import { useEmailBatchController } from '@/features/email-assistant/batch/useEmailBatchController'
import { useUserStore } from '@/store/useUserStore'
import SingleEmailAssistant from './SingleEmailAssistant'
import BatchEmailAssistant from './BatchEmailAssistant'

const MODES = [{ value: 'single', label: '单个' }, { value: 'batch', label: '批量' }]

export default function EmailAssistant() {
  const userId = useUserStore(state => state.userId)
  return <EmailAssistantSession key={userId ?? 'local'} />
}

function EmailAssistantSession() {
  const { openModelSettings } = useOutletContext<{ openModelSettings: () => void }>()
  const [mode, setMode] = useState('single')
  const [batchVisited, setBatchVisited] = useState(false)
  const configuration = useEmailModelConfiguration()
  const gate = useEmailGenerationGate()
  const single = useEmailAssistantController()
  const batch = useEmailBatchController(gate)
  const { settingsQuery, profilesQuery } = configuration

  return <div className="email-assistant-page">
    <ToolSwitcher className="page-tab-row" options={MODES} value={mode} onChange={value => {
      setMode(value)
      if (value === 'batch') setBatchVisited(true)
      if (value === 'single') void single.refreshHistory?.().catch(() => undefined)
    }} />
    {authEnabled && configuration.error ? <Alert type="error" showIcon className="email-model-alert"
      message="模型设置加载失败，请重试"
      action={<Button size="small" onClick={() => { void settingsQuery.refetch(); void profilesQuery.refetch() }}>重试</Button>} />
      : authEnabled && configuration.keyConfigured === false ? <Alert type="info" showIcon className="email-model-alert"
        message="配置自己的 DeepSeek API Key 后即可生成"
        description="邮件内容会发送到 DeepSeek；调用费用由你的 DeepSeek 账号承担。任务和修改稿保留 7 天。"
        action={<Button size="small" onClick={openModelSettings}>模型与密钥设置</Button>} /> : null}
    <div hidden={mode !== 'single'}>
      {gate.owner === 'batch' ? <Alert className="email-model-alert" type="info" showIcon
        message={batch.unresolved ? '批量邮件等待确认原任务状态，确认后可继续单个生成' : '批量邮件正在处理，暂停并等待当前邮件完成后可继续单个生成'} /> : null}
      <SingleEmailAssistant controller={single} configuration={configuration} gate={gate} openModelSettings={openModelSettings} />
    </div>
    {batchVisited ? <div hidden={mode !== 'batch'}>
      <BatchEmailAssistant controller={batch} configuration={configuration} singleBusy={gate.owner === 'single'} />
    </div> : null}
  </div>
}
