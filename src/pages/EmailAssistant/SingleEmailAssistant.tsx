import { useEffect, useMemo, useState } from 'react'
import { App, Button, Card, Col, Input, Popconfirm, Radio, Row, Select, Space } from 'antd'
import { CopyOutlined, RedoOutlined } from '@ant-design/icons'
import GenerationTaskStatus from '@/components/GenerationTaskStatus'
import { buildEmailAssistRequest } from '@/features/email-assistant/requestBuilder'
import type { useEmailAssistantController } from '@/features/email-assistant/useEmailAssistantController'
import { authEnabled } from '@/cloud/client'
import type { EmailGenerationGate } from '@/features/email-assistant/useEmailGenerationGate'
import type { EmailModelConfiguration } from '@/features/email-assistant/useEmailModelConfiguration'
import { EMAIL_OPERATIONS as TASK_TYPES, EMAIL_POLISH_STYLES as POLISH_STYLES } from '@/features/email-assistant/options'
import { usePreferencesStore } from '@/features/preferences/store'
import type {
  EmailAssistLanguage,
  EmailAssistOperation,
  EmailPolishStyle,
} from '@/types'

interface Props {
  controller: ReturnType<typeof useEmailAssistantController>
  configuration: EmailModelConfiguration
  gate: EmailGenerationGate
  openModelSettings: () => void
}

export default function SingleEmailAssistant({ controller, configuration, gate, openModelSettings }: Props) {
  const { message } = App.useApp()
  const [sourceText, setSourceText] = useState('')
  const [instruction, setInstruction] = useState('')
  const [operation, setOperation] = useState<EmailAssistOperation>(() => usePreferencesStore.getState().preferences.email.operation)
  const [language, setLanguage] = useState<EmailAssistLanguage>(() => usePreferencesStore.getState().preferences.email.language)
  const [polishStyles, setPolishStyles] = useState<EmailPolishStyle[]>(() => usePreferencesStore.getState().preferences.email.polishStyles)
  const [modelProfileId, setModelProfileId] = useState<string>()
  const { profilesQuery, profiles, keyConfigured, loading: modelSettingsLoading,
    error: modelSettingsError, ready: modelSettingsReady, defaultModelProfileId } = configuration
  const selectedModelProfileId = modelProfileId ?? defaultModelProfileId
  const generationBlocked = gate.owner === 'batch'
  const { acquire, release } = gate

  useEffect(() => {
    if (controller.formLocked) acquire('single')
    else release('single')
  }, [acquire, release, controller.formLocked])

  useEffect(() => {
    const task = controller.task
    if (!task) return
    queueMicrotask(() => {
      setSourceText(task.params.sourceText)
      setInstruction(task.params.instruction ?? '')
      setOperation(task.params.operation)
      setLanguage(task.params.language)
      setPolishStyles(task.params.polishStyles ?? ['clear'])
      if (task.modelProfileId) setModelProfileId(task.modelProfileId)
    })
  // 仅在切换历史任务时恢复表单，避免覆盖用户正在修改的参数。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller.task?.id])

  const currentParams = useMemo(() => ({
    sourceText,
    instruction,
    operation,
    language,
    polishStyles,
  }), [instruction, language, operation, polishStyles, sourceText])
  const taskSummary = useMemo(() => {
    const task = controller.task
    if (!task) return undefined
    if (task.status === 'succeeded') return controller.resultText ? '邮件文本已生成，可继续编辑或复制' : '正在读取生成结果'
    if (task.status === 'failed' || task.status === 'cancelled') return task.errorMessage || '任务没有完成，请重试'
    return 'AI 正在处理邮件内容'
  }, [controller.resultText, controller.task])

  const handleGenerate = async () => {
    if (!modelSettingsReady) {
      message.warning(modelSettingsLoading ? '正在加载模型设置，请稍候'
        : keyConfigured === false ? '请先配置自己的 DeepSeek API Key' : '模型设置加载失败，请重试')
      return
    }
    if (!gate.acquire('single')) { message.warning('当前有邮件正在处理，请等待完成'); return }
    let waiting = false
    try {
      const request = buildEmailAssistRequest(currentParams)
      const task = await controller.generate(request.params, selectedModelProfileId)
      waiting = ['pending', 'queued', 'processing'].includes(task.status)
      if (task.status === 'succeeded') message.success('邮件内容已生成')
      else if (task.status === 'failed') {
        if (task.errorCode === 'INVALID_PROVIDER_KEY') window.dispatchEvent(new Event('pixel:model-settings-changed'))
        message.error(task.errorMessage ?? '邮件生成失败')
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '邮件任务提交失败')
    } finally { if (!waiting) gate.release('single') }
  }

  const handleCopy = async () => {
    if (!controller.resultText) return
    try {
      await navigator.clipboard.writeText(controller.resultText)
      message.success('结果已复制')
    } catch {
      message.error('复制失败，请手动选择文本复制')
    }
  }

  const handleRetry = async () => {
    if (!modelSettingsReady || !gate.acquire('single')) return
    let waiting = false
    try {
      const task = await controller.retry()
      waiting = !!task && ['pending', 'queued', 'processing'].includes(task.status)
      if (task?.status === 'succeeded') message.success('邮件内容已重新生成')
      else if (task?.status === 'failed') message.error(task.errorMessage ?? '重试失败')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '任务重试失败')
    } finally { if (!waiting) gate.release('single') }
  }

  const handleNewTask = async () => {
    await controller.newTask()
    const defaults = usePreferencesStore.getState().preferences.email
    setSourceText(''); setInstruction('')
    setOperation(defaults.operation); setLanguage(defaults.language); setPolishStyles(defaults.polishStyles)
    setModelProfileId(undefined)
  }

  return (
    <div className="email-single-panel">
      <Row gutter={[20, 20]}>
        <Col xs={24} xl={12}>
          <Card title="原始邮件内容" size="small">
            <Input.TextArea
              rows={12}
              value={sourceText}
              disabled={controller.formLocked}
              onChange={(event) => setSourceText(event.target.value)}
              placeholder="粘贴需要处理的邮件内容"
            />
          </Card>
          <Card title="编写指导" size="small" style={{ marginTop: 16 }}>
            <Input.TextArea
              rows={4}
              value={instruction}
              disabled={controller.formLocked}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="告诉 AI 想要表达的重点，例如：委婉说明发货延迟"
            />
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card title="生成设置" size="small" extra={<Button size="small" disabled={controller.formLocked} onClick={() => void handleNewTask().catch(error => message.error(error instanceof Error ? error.message : '新建任务失败'))}>新建任务</Button>}>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <div>
                <div className="field-label">操作类型</div>
                <Radio.Group
                  options={TASK_TYPES}
                  value={operation}
                  disabled={controller.formLocked}
                  onChange={(event) => setOperation(event.target.value as EmailAssistOperation)}
                  optionType="button"
                />
              </div>
              <div>
                <div className="field-label">语言</div>
                <Select
                  style={{ width: 200 }}
                  value={language}
                  disabled={controller.formLocked}
                  onChange={setLanguage}
                  options={[
                    { value: 'zh', label: '中文' },
                    { value: 'en', label: 'English' },
                    { value: 'ja', label: '日本語' },
                  ]}
                />
              </div>
              {operation === 'polish' ? (
                <div>
                  <div className="field-label">润色方式（可多选）</div>
                  <Select
                    mode="multiple"
                    style={{ width: '100%' }}
                    value={polishStyles}
                    disabled={controller.formLocked}
                    onChange={setPolishStyles}
                    options={POLISH_STYLES}
                  />
                </div>
              ) : null}
              {authEnabled ? <div>
                <div className="field-label">本次使用的模型</div>
                <Space>
                  <Select style={{ width: 220 }} value={profilesQuery.data ? selectedModelProfileId : undefined}
                    placeholder="正在加载模型设置…" loading={modelSettingsLoading}
                    disabled={controller.formLocked || modelSettingsLoading || Boolean(modelSettingsError)}
                    onChange={setModelProfileId} options={profiles.map(profile => ({ value: profile.id, label: profile.label }))} />
                  <Button size="small" onClick={openModelSettings}>设置</Button>
                </Space>
              </div> : null}
              <Button
                type="primary"
                loading={controller.submitting}
                disabled={!sourceText.trim() || controller.formLocked || generationBlocked || !modelSettingsReady}
                onClick={handleGenerate}
              >
                生成
              </Button>
            </Space>
          </Card>

          <GenerationTaskStatus
            task={controller.task}
            submitting={controller.submitting}
            active={controller.active}
            polling={controller.polling}
            summary={taskSummary}
            submissionError={controller.submissionError}
            protocolError={controller.protocolError}
            pollError={controller.pollError}
            onRetry={() => void handleRetry()}
            retryDisabled={generationBlocked || !modelSettingsReady}
            onModifyParameters={controller.modifyParameters}
            onRefetch={() => void controller.refetch()}
          />

          <Card
            title="生成结果"
            size="small"
            className="email-result-card"
            extra={controller.resultText ? (
              <Space>
                <Button size="small" icon={<CopyOutlined />} onClick={handleCopy}>复制</Button>
                <Button
                  size="small"
                  icon={<RedoOutlined />}
                  loading={controller.submitting}
                  disabled={controller.formLocked || generationBlocked || !modelSettingsReady}
                  onClick={handleGenerate}
                >
                  重新生成
                </Button>
              </Space>
            ) : null}
          >
            <Input.TextArea
              rows={12}
              value={controller.resultText}
              disabled={controller.task?.status !== 'succeeded'}
              onChange={(event) => controller.setResultText(event.target.value)}
              placeholder={controller.active ? '正在生成邮件内容…' : '生成结果将在这里显示'}
            />
            {controller.savingEdit ? <span className="email-save-hint">正在保存修改稿…</span> : null}
            {controller.task?.tokenUsage ? <span className="email-save-hint">本次使用 {controller.task.tokenUsage.totalTokens} tokens</span> : null}
          </Card>
          {authEnabled ? <Card title="最近 7 天" size="small" style={{ marginTop: 16 }}>
            {controller.history.length ? <Space direction="vertical" style={{ width: '100%' }}>
              <Select style={{ width: '100%' }} value={controller.task?.id} placeholder="选择历史任务"
                options={controller.history.map(item => ({ value: item.id, label: `${new Date(item.createdAt).toLocaleString('zh-CN')} · ${TASK_TYPES.find(type => type.value === item.operation)?.label ?? item.operation} · ${item.preview ?? ''}` }))}
                onChange={id => { void controller.openTask(id).catch(error => message.error(error instanceof Error ? error.message : '历史任务读取失败')) }} />
              <Space>
                <Button size="small" onClick={() => void controller.refreshHistory()}>刷新</Button>
                {controller.history.length < controller.historyTotal ? <Button size="small" onClick={() => void controller.loadMoreHistory().catch(error => message.error(error instanceof Error ? error.message : '加载失败'))}>加载更多</Button> : null}
                <Popconfirm title="删除这条邮件任务及其内容？" onConfirm={() => controller.task && void controller.removeTask(controller.task.id).catch(error => message.error(error instanceof Error ? error.message : '删除失败'))}>
                  <Button danger size="small" disabled={!controller.task || controller.active}>删除当前任务</Button>
                </Popconfirm>
              </Space>
            </Space> : <span>暂无邮件任务</span>}
          </Card> : null}
        </Col>
      </Row>
    </div>
  )
}
