import { useState } from 'react'
import { emailModelIdSchema } from '@shared/email-models'
import { App, Alert, Button, Select, Spin } from 'antd'
import { authEnabled } from '@/cloud/client'
import { saveDefaultEmailModel } from '@/services/api/modelSettings'
import { useModelSettings } from './useModelSettings'

export default function ModelSettingsPanel() {
  const { message } = App.useApp()
  const { settingsQuery, profilesQuery, updateSettings } = useModelSettings()
  const [busy, setBusy] = useState(false)
  if (!authEnabled) return null
  if (!settingsQuery.data || !profilesQuery.data) {
    return settingsQuery.error || profilesQuery.error ? <Alert type="error" showIcon message="邮件模型偏好加载失败"
      action={<Button onClick={() => { void settingsQuery.refetch(); void profilesQuery.refetch() }}>重试</Button>} /> : <Spin />
  }
  return <section>
    <div className="setting-row"><span><strong>默认邮件模型</strong><small>未指定时按输出语言推荐；邮件按每次成功生成扣积分</small></span>
      <Select aria-label="默认邮件模型" style={{ width: 270 }} disabled={busy} value={settingsQuery.data.defaultEmailModelId ?? 'auto'}
        options={[{ value: 'auto', label: '按输出语言推荐' }, ...profilesQuery.data.items.map(model => ({
          value: model.id, label: `${model.label} · ${model.credits} 积分`, disabled: !model.available,
        }))]} onChange={async value => {
          setBusy(true)
          try {
            await updateSettings(await saveDefaultEmailModel(value === 'auto' ? null : emailModelIdSchema.parse(value)))
            window.dispatchEvent(new Event('pixel:model-settings-changed'))
            message.success('默认邮件模型已更新')
          } catch (error) { message.error(error instanceof Error ? error.message : '保存失败') }
          finally { setBusy(false) }
        }} />
    </div>
  </section>
}
