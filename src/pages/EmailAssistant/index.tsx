import { useState } from 'react'
import { Button, Card, Col, Input, Radio, Row, Select, Space } from 'antd'

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
  const [taskType, setTaskType] = useState('reply')

  return (
    <Row gutter={20}>
      <Col span={12}>
        <Card title="原始邮件内容" size="small">
          <Input.TextArea rows={10} placeholder="粘贴需要处理的邮件内容" />
        </Card>
        <Card title="编写指导" size="small" style={{ marginTop: 16 }}>
          <Input.TextArea rows={4} placeholder="告诉 AI 想要表达的重点，例如：委婉说明发货延迟" />
        </Card>
      </Col>
      <Col span={12}>
        <Card title="生成设置" size="small">
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <div>
              <div style={{ marginBottom: 6, color: 'var(--color-text-secondary)' }}>操作类型</div>
              <Radio.Group
                options={TASK_TYPES}
                value={taskType}
                onChange={(e) => setTaskType(e.target.value)}
                optionType="button"
              />
            </div>
            <div>
              <div style={{ marginBottom: 6, color: 'var(--color-text-secondary)' }}>语言</div>
              <Select
                style={{ width: 200 }}
                defaultValue="zh"
                options={[
                  { value: 'zh', label: '中文' },
                  { value: 'en', label: 'English' },
                  { value: 'ja', label: '日本語' },
                ]}
              />
            </div>
            {taskType === 'polish' && (
              <div>
                <div style={{ marginBottom: 6, color: 'var(--color-text-secondary)' }}>润色方式（可多选）</div>
                <Select mode="multiple" style={{ width: '100%' }} options={POLISH_STYLES} />
              </div>
            )}
            <Button type="primary">生成</Button>
          </Space>
        </Card>
        <Card title="生成结果" size="small" style={{ marginTop: 16, minHeight: 200 }}>
          {/* TODO: 接入 createTask(Capability.EmailAssist, ...) 后展示结果，支持复制/重新生成 */}
        </Card>
      </Col>
    </Row>
  )
}
