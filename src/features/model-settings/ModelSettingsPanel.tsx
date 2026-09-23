import { useEffect, useState } from 'react'
import { App, Button, Input, Popconfirm, Select, Space, Spin, Tag } from 'antd'
import { authEnabled } from '@/cloud/client'
import {
  deleteDeepSeekKey, getModelProfiles, getModelSettings, saveDeepSeekKey,
  saveDefaultEmailModel, testDeepSeekKey, type ModelProfile, type ModelSettings,
} from '@/services/api/modelSettings'

export default function ModelSettingsPanel() {
  const { message } = App.useApp()
  const [settings, setSettings] = useState<ModelSettings>()
  const [profiles, setProfiles] = useState<ModelProfile[]>([])
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(authEnabled)

  useEffect(() => {
    if (!authEnabled) return
    void Promise.all([getModelSettings(), getModelProfiles()]).then(([value, catalog]) => {
      setSettings(value)
      setProfiles(catalog.items)
    }).catch(error => message.error(error instanceof Error ? error.message : '模型设置加载失败'))
      .finally(() => setLoading(false))
  }, [message])

  const run = async (action: () => Promise<ModelSettings>, success: string) => {
    setBusy(true)
    try {
      setSettings(await action())
      window.dispatchEvent(new Event('pixel:model-settings-changed'))
      message.success(success)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败')
    } finally { setBusy(false) }
  }

  if (!authEnabled) return <section><h2>模型与密钥</h2><p className="settings-description">登录后即可配置自己的模型密钥。</p></section>
  if (loading) return <Spin />

  return <section>
    <h2>模型与密钥</h2>
    <p className="settings-description">邮件助手使用你自己的 DeepSeek 账号调用模型。费用由 DeepSeek 向你的账号收取；密钥加密保存在服务端，保存后不会再次显示明文。</p>
    <div className="settings-rows">
      <div className="setting-row">
        <span><strong>DeepSeek API Key</strong><small>{settings?.deepseek.configured ? `已保存密钥 ····${settings.deepseek.keyTail}` : '尚未配置'}</small></span>
        <Tag color={settings?.deepseek.verificationStatus === 'valid' ? 'green' : 'default'}>
          {settings?.deepseek.verificationStatus === 'valid' ? '已验证' : settings?.deepseek.configured ? '需重新验证' : '未配置'}
        </Tag>
      </div>
      <div className="setting-row">
        <span><strong>保存或替换密钥</strong><small>仅提交到 Pixel AIGC 后端验证，不存入浏览器</small></span>
        <Space.Compact style={{ maxWidth: 340 }}>
          <Input.Password aria-label="DeepSeek API Key" autoComplete="off" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="输入 DeepSeek API Key" />
          <Button type="primary" loading={busy} disabled={!apiKey.trim()} onClick={() => void run(async () => {
            const result = await saveDeepSeekKey(apiKey.trim())
            setApiKey('')
            return result
          }, '密钥已验证并保存')}>保存</Button>
        </Space.Compact>
      </div>
      <div className="setting-row">
        <span><strong>默认邮件模型</strong><small>邮件页面可以临时切换单次使用的模型</small></span>
        <Select style={{ width: 210 }} disabled={busy} value={settings?.defaultEmailModelId}
          options={profiles.map(profile => ({ value: profile.id, label: profile.label }))}
          onChange={value => void run(() => saveDefaultEmailModel(value), '默认模型已更新')} />
      </div>
      <div className="setting-row">
        <span><strong>密钥管理</strong><small>删除后无法再生成；已有邮件历史仍按保留期显示</small></span>
        <Space>
          <Button disabled={!settings?.deepseek.configured || busy} onClick={() => void run(testDeepSeekKey, '连接正常')}>测试连接</Button>
          <Popconfirm title="删除已保存的 DeepSeek 密钥？" onConfirm={() => void run(deleteDeepSeekKey, '密钥已删除')}>
            <Button danger disabled={!settings?.deepseek.configured || busy}>删除</Button>
          </Popconfirm>
        </Space>
      </div>
    </div>
    <p className="settings-description" style={{ marginTop: 18 }}>支持的模型和价格以 <a href="https://api-docs.deepseek.com/quick_start/pricing/" target="_blank" rel="noreferrer">DeepSeek 官方说明</a>为准。</p>
  </section>
}
