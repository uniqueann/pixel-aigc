import { useMemo, useState } from 'react'
import { App, Button, Card, Col, Input, Radio, Row, Select, Space } from 'antd'
import { CopyOutlined, RedoOutlined } from '@ant-design/icons'
import GenerationTaskStatus from '@/components/GenerationTaskStatus'
import { buildEmailAssistRequest } from '@/features/email-assistant/requestBuilder'
import { useEmailAssistantController } from '@/features/email-assistant/useEmailAssistantController'
import type {
  EmailAssistLanguage,
  EmailAssistOperation,
  EmailPolishStyle,
} from '@/types'

const TASK_TYPES = [
  { value: 'summarize', label: '总结' },
  { value: 'reply', label: '回复' },
  { value: 'polish', label: '润色' },
  { value: 'grammar', label: '检查语法' },
]

const POLISH_STYLES = [
  { value: 'clear', label: '提升表达清晰度' },
  { value: 'shorten', label: '缩短' },
  { value: 'lengthen', label: '增长' },
  { value: 'simplify', label: '简化' },
]

export default function EmailAssistant() {
  const { message } = App.useApp()
  const [sourceText, setSourceText] = useState('')
  const [instruction, setInstruction] = useState('')
  const [operation, setOperation] = useState<EmailAssistOperation>('reply')
  const [language, setLanguage] = useState<EmailAssistLanguage>('zh')
  const [polishStyles, setPolishStyles] = useState<EmailPolishStyle[]>(['clear'])
  const controller = useEmailAssistantController()

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
    try {
      const request = buildEmailAssistRequest(currentParams)
      await controller.generate(request.params)
      message.success('邮件任务已提交')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '邮件任务提交失败')
    }
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
    try {
      await controller.retry()
      message.success('已按原参数重新提交')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '任务重试失败')
    }
  }

  return (
    <div className="email-assistant-page">
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
          <Card title="生成设置" size="small">
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
              <Button
                type="primary"
                loading={controller.submitting}
                disabled={!sourceText.trim() || controller.formLocked}
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
                  disabled={controller.formLocked}
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
              disabled={!controller.resultText}
              onChange={(event) => controller.setResultText(event.target.value)}
              placeholder={controller.active ? '正在生成邮件内容…' : '生成结果将在这里显示'}
            />
          </Card>
        </Col>
      </Row>
    </div>
  )
}
