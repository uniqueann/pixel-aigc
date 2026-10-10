import { recommendedEmailModel, EMAIL_LANGUAGE_OPTIONS } from '@shared/email-models'
import EmailModelChoice from '@/features/email-assistant/EmailModelChoice'
import { useKnownCreditBalance } from '@/features/credits/useKnownCreditBalance'
import { openCreditRecharge } from '@/services/api/billing'
import { useEffect, useRef, useState, type TdHTMLAttributes } from 'react'
import { Alert, App, Button, Card, Descriptions, Image, Input, Modal, Progress, Space, Table, Tag, Upload } from 'antd'
import { CopyOutlined, DownloadOutlined, InboxOutlined, PauseOutlined, PlayCircleOutlined, RedoOutlined } from '@ant-design/icons'
import { usePreferencesStore } from '@/features/preferences/store'
import { useUserStore } from '@/store/useUserStore'
import { trackFirstUpload } from '@/features/activation/client'
import type { EmailModelConfiguration } from '@/features/email-assistant/useEmailModelConfiguration'
import type { EmailBatchController } from '@/features/email-assistant/batch/useEmailBatchController'
import { EMAIL_BATCH_HEADERS, EMAIL_BATCH_MAX_ROWS } from '@/features/email-assistant/options'
import { formatEmailBatchError, formatEmailBatchLocator } from '@/features/email-assistant/batch/labels'
import { EMAIL_BATCH_STATUS_LABELS, type EmailBatchRow, type EmailBatchStatus } from '@/features/email-assistant/batch/types'
import {
  createEmailBatchTemplate, downloadEmailCsv, exportEmailBatchCsv,
  formatEmailLanguage, formatEmailOperation, readEmailBatchFile,
} from '@/features/email-assistant/batch/csv'
import templatePreview from '@/features/email-assistant/batch/template-preview.png'

interface Props {
  controller: EmailBatchController
  configuration: EmailModelConfiguration
  singleBusy: boolean
  openModelSettings: () => void
}

const batchCellLabel = (label: string) => ({ 'data-label': label } as TdHTMLAttributes<HTMLTableCellElement>)

const STATUS_COLORS: Record<EmailBatchStatus, string> = {
  pending: 'default', processing: 'processing', succeeded: 'success',
  failed: 'error', invalid: 'warning', uncertain: 'warning',
}

export default function BatchEmailAssistant({ controller, configuration, singleBusy, openModelSettings }: Props) {
  const { message } = App.useApp()
  const [pickedModel, setPickedModel] = useState<string>()
  const balance = useKnownCreditBalance()
  const [reading, setReading] = useState(false)
  const [importError, setImportError] = useState<string>()
  const [selectedId, setSelectedId] = useState<string>()
  const importEpoch = useRef(0)
  useEffect(() => () => { ++importEpoch.current }, [])
  const counts = controller.rows.reduce((result, row) => ({ ...result, [row.status]: result[row.status] + 1 }),
    { pending: 0, processing: 0, succeeded: 0, failed: 0, invalid: 0, uncertain: 0 })
  const validCount = controller.rows.length - counts.invalid
  const selectedIndex = controller.rows.findIndex(row => row.id === selectedId)
  const selected = selectedIndex >= 0 ? controller.rows[selectedIndex] : undefined
  const sequenceOf = (row: EmailBatchRow) => controller.rows.findIndex(item => item.id === row.id) + 1
  const issueText = (row: EmailBatchRow) => row.errorMessage ? formatEmailBatchError(sequenceOf(row), row.recordNumber, row.errorMessage) : ''
  const invalidLocators = controller.rows.flatMap((row, index) => row.status === 'invalid'
    ? [formatEmailBatchLocator(index + 1, row.recordNumber)] : [])
  const locked = controller.busy || controller.unresolved
  const languages = [...new Set(controller.rows.flatMap(row => row.params ? [row.params.language] : []))]
  const mixed = languages.length > 1
  const language = languages.length === 1 ? languages[0] : undefined
  const modelId = controller.modelProfileId ?? pickedModel ?? configuration.defaultModelProfileId
    ?? (!mixed ? recommendedEmailModel(language ?? usePreferencesStore.getState().preferences.email.language) : undefined)
  const profile = configuration.profiles.find(model => model.id === modelId)
  const cannotGenerate = locked || reading || singleBusy || !configuration.ready || !profile?.available || !modelId
  const remainingCost = counts.pending * (profile?.credits ?? 0)
  const charged = controller.rows.reduce((sum, row) => sum + (row.creditsCost ?? 0), 0)
  const confirmRun = (retry = false) => {
    if (!modelId || !profile || cannotGenerate) return
    if (balance != null && balance < profile.credits) { openCreditRecharge(); return }
    const count = retry ? counts.failed : counts.pending
    Modal.confirm({ title: retry ? '确认重试失败邮件' : '确认批量生成',
      content: `${profile.label}，每次成功 ${profile.credits} 积分；本次 ${count} 条，预计 ${count * profile.credits} 积分。${balance != null ? `当前余额预计可完成 ${Math.floor(balance / profile.credits)} 条。` : ''}失败返还，余额不足时暂停。`,
      okText: '确认生成', cancelText: '取消',
      // start()/retry() 的 promise 要等整批跑完才 resolve；这里不能返回它，
      // 否则确认框会一直 loading 盖住页面，挡住「暂停」按钮。
      onOk: () => {
        handleAction(retry ? controller.retry(modelId, undefined, profile.priceVersion) : controller.start(modelId, profile.priceVersion))
      },
    })
  }

  const importFile = async (file: File) => {
    if (locked) return Upload.LIST_IGNORE
    const owner = useUserStore.getState().userId
    const epoch = ++importEpoch.current
    setReading(true)
    setImportError(undefined)
    try {
      const rows = await readEmailBatchFile(file, usePreferencesStore.getState().preferences.email)
      if (epoch !== importEpoch.current) return Upload.LIST_IGNORE
      controller.load(rows, file.name)
      if (rows.some(row => row.status === 'pending')) trackFirstUpload(owner, 'email-batch')
      setSelectedId(undefined)
      message.success(`已导入 ${rows.length} 条邮件，其中 ${rows.filter(row => row.status === 'pending').length} 条可生成`)
    } catch (error) {
      if (epoch === importEpoch.current) setImportError(error instanceof Error ? error.message : 'CSV 导入失败')
    } finally {
      if (epoch === importEpoch.current) setReading(false)
    }
    return Upload.LIST_IGNORE
  }

  const copyResult = async (row: EmailBatchRow) => {
    if (!row.resultText) return
    try { await navigator.clipboard.writeText(row.resultText); message.success('结果已复制') }
    catch { message.error('复制失败，请打开详情手动选择文本复制') }
  }
  const handleAction = (action: Promise<void>) => {
    void action.catch(error => message.error(error instanceof Error ? error.message : '批量操作失败'))
  }

  return <div className="email-batch-panel">
    <div className="email-batch-import-grid">
      <Card title="CSV 模板" size="small" extra={<Button size="small" icon={<DownloadOutlined />}
        onClick={() => downloadEmailCsv(createEmailBatchTemplate(), '邮件助手-批量模板.csv')}>下载模板</Button>}>
        <p className="email-batch-hint">按模板四列填写，每行处理一封邮件。模板不含示例邮件。</p>
        <Image src={templatePreview} alt={`CSV 模板列名：${EMAIL_BATCH_HEADERS.join('、')}`} width="100%" />
        <ul className="email-batch-template-notes">
          <li>原始邮件内容必填，最多 10,000 字符；编写指导可空，最多 1,000 字符。</li>
          <li>生成设置列填操作类型：总结、回复、检查语法、润色；例如“润色：提升表达清晰度+缩短”。可选方式还包括“增长”“简化”。</li>
          <li>语言：{EMAIL_LANGUAGE_OPTIONS.map(item => `${item.label}（${item.value}）`).join('、')}。</li>
          <li>设置或语言留空时使用导入时的<Button type="link" size="small" onClick={openModelSettings}
            style={{ padding: '0 2px', height: 'auto', fontSize: 'inherit', verticalAlign: 'baseline' }}>个人默认值</Button>；仅填写“润色”时使用默认润色方式。</li>
        </ul>
      </Card>
      <Card title="导入邮件" size="small">
        <Upload.Dragger accept=".csv,text/csv" maxCount={1} multiple={false} showUploadList={false}
          disabled={locked || reading} beforeUpload={importFile}>
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">{reading ? '正在读取 CSV…' : '点击或拖入 CSV 文件'}</p>
          <p className="ant-upload-hint">CSV UTF-8 格式，最多 {EMAIL_BATCH_MAX_ROWS} 条邮件，文件不超过 5 MB</p>
        </Upload.Dragger>
        {controller.fileName ? <p className="email-batch-hint">当前文件：{controller.fileName}。上传新文件会替换本批次。</p> : null}
        <p className="email-batch-hint">批次保留在当前页面。切换单个／批量不会丢失；刷新或离开邮件页会停止后续生成，请及时导出。</p>
        <p className="email-batch-hint">每次按顺序生成一封，每小时最多提交 60 条。已提交邮件在最近 7 天历史中可查询。</p>
        <div className="email-batch-model"><EmailModelChoice configuration={configuration} value={modelId} language={language}
          disabled={locked || Boolean(controller.modelProfileId)} onChange={setPickedModel} /></div>
        {controller.modelProfileId ? <p className="email-batch-hint">本批次已固定使用同一型号，开始后不可更改。</p> : null}
        {mixed && !modelId ? <Alert type="info" message="混合语种请手动选择统一模型，也可拆成不同语种的批次" /> : null}
        <p className="email-batch-hint">有效邮件 {validCount} 条 · 待处理预计 {remainingCost} 积分 · 已实扣 {charged} 积分</p>
        <p className="email-batch-hint">当前余额 {balance ?? '读取中'}{balance != null && profile ? `，按此单价可完成 ${Math.floor(balance / profile.credits)} 条` : ''}
          <Button type="link" size="small" onClick={openCreditRecharge}>充值积分</Button></p>
        {importError ? <Alert type="error" showIcon message="CSV 导入失败" description={importError} /> : null}
      </Card>
    </div>

    <Card title="批量结果" size="small">
      <div className="email-batch-actions">
        <Space wrap>
          {controller.busy && !controller.recovering ? <Button icon={<PauseOutlined />} disabled={controller.runState === 'pausing'}
            onClick={controller.pause}>{controller.runState === 'pausing' ? '正在暂停…' : '暂停'}</Button>
            : <Button type="primary" icon={<PlayCircleOutlined />} disabled={cannotGenerate || !counts.pending}
              onClick={() => confirmRun()}>
              {controller.runState === 'paused' ? '继续生成' : '生成'}{counts.pending ? ` ${counts.pending} 条` : ''}
            </Button>}
          <Button icon={<RedoOutlined />} disabled={cannotGenerate || !counts.failed}
            onClick={() => confirmRun(true)}>重试失败项</Button>
          {controller.unresolved ? <Button loading={controller.recovering} disabled={controller.busy && !controller.recovering}
            onClick={() => handleAction(controller.recover())}>重新查询原任务</Button> : null}
        </Space>
        <Space wrap>
          <Button disabled={locked || reading || !controller.rows.length} onClick={() => {
            controller.load([]); setImportError(undefined); setSelectedId(undefined)
          }}>清空批次</Button>
          <Button icon={<DownloadOutlined />} disabled={!controller.rows.length || reading} onClick={() => {
            downloadEmailCsv(exportEmailBatchCsv(controller.rows), `${controller.fileName?.replace(/\.csv$/i, '') ?? '批量邮件'}-生成结果.csv`)
          }}>导出 CSV</Button>
        </Space>
      </div>
      {singleBusy ? <Alert type="info" showIcon message="单个邮件正在处理，完成后可开始批量生成" className="email-batch-alert" /> : null}
      {invalidLocators.length ? <Alert type="warning" showIcon className="email-batch-alert"
        message={`${invalidLocators.join('、')}填写错误，只生成有效行；请修正 CSV 后重新上传。`} /> : null}
      {controller.pauseMessage ? <Alert type="warning" showIcon message={controller.pauseMessage} className="email-batch-alert" /> : null}
      {controller.rows.length ? <div className="email-batch-progress">
        <p role="status" aria-live="polite">共 {controller.rows.length} 条 · 待处理 {counts.pending} · 生成中 {counts.processing} · 成功 {counts.succeeded} · 失败 {counts.failed} · 填写错误 {counts.invalid} · 待确认 {counts.uncertain}</p>
        <Progress percent={validCount ? Math.round((counts.succeeded + counts.failed) / validCount * 100) : 0}
          status={controller.busy ? 'active' : 'normal'} />
      </div> : null}
      <Table<EmailBatchRow> className="email-batch-table" rowKey="id" size="small" tableLayout="fixed"
        dataSource={controller.rows}
        pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true }}
        locale={{ emptyText: '上传 CSV 后，可在这里预览邮件并生成' }} columns={[
          { title: '序号', width: '7%', onCell: () => batchCellLabel('序号'), render: (_, row) => sequenceOf(row) },
          { title: '原始邮件内容', width: '15%', onCell: () => batchCellLabel('原始邮件内容'), render: (_, row) => <span className="email-batch-cell">{row.original['原始邮件内容'] || '—'}</span> },
          { title: '编写指导', width: '12%', onCell: () => batchCellLabel('编写指导'), render: (_, row) => <span className="email-batch-cell">{row.original['编写指导'] || '—'}</span> },
          { title: '生成设置', width: '14%', onCell: () => batchCellLabel('生成设置'), render: (_, row) => <span className="email-batch-cell">{row.params ? formatEmailOperation(row.params) : row.original['生成设置'] || '—'}</span> },
          { title: '语言', width: '8%', onCell: () => batchCellLabel('语言'), render: (_, row) => row.params ? formatEmailLanguage(row.params) : row.original['语言'] || '—' },
          { title: '生成结果', width: '14%', onCell: () => batchCellLabel('生成结果'), render: (_, row) => <span className="email-batch-cell">{row.resultText || '—'}</span> },
          { title: '状态', width: '22%', onCell: () => batchCellLabel('状态'), render: (_, row) => <div className="email-batch-status">
            <Tag color={STATUS_COLORS[row.status]}>{EMAIL_BATCH_STATUS_LABELS[row.status]}</Tag>
            {row.errorMessage ? <p className="email-batch-row-error">{issueText(row)}</p> : null}
          </div> },
          { title: '操作', width: '8%', onCell: () => batchCellLabel('操作'), render: (_, row) => <Space size={0} wrap className="email-batch-row-actions">
            <Button type="link" size="small" onClick={() => setSelectedId(row.id)}>详情</Button>
            <Button type="link" size="small" disabled={!row.resultText} onClick={() => void copyResult(row)}>复制</Button>
          </Space> },
        ]} />
    </Card>

    <Modal title={selected ? formatEmailBatchLocator(selectedIndex + 1, selected.recordNumber) : ''} open={!!selected} onCancel={() => setSelectedId(undefined)}
      width="min(760px, calc(100vw - 32px))" footer={selected?.resultText ? <Button icon={<CopyOutlined />} onClick={() => void copyResult(selected)}>复制生成结果</Button> : null}>
      {selected ? <Space direction="vertical" size={16} className="email-batch-detail">
        <Descriptions size="small" column={1} items={[
          { key: 'operation', label: '生效设置', children: selected.params ? formatEmailOperation(selected.params) : selected.original['生成设置'] || '—' },
          { key: 'language', label: '生效语言', children: selected.params ? formatEmailLanguage(selected.params) : selected.original['语言'] || '—' },
          { key: 'cost', label: '实际扣减积分', children: selected.creditsCost ?? '—' },
          { key: 'model', label: '使用模型', children: configuration.profiles.find(model => model.id === selected.modelProfileId)?.label ?? '—' },
          { key: 'status', label: '状态', children: EMAIL_BATCH_STATUS_LABELS[selected.status] },
        ]} />
        <label>原始邮件内容<Input.TextArea readOnly rows={5} value={selected.original['原始邮件内容']} /></label>
        <label>编写指导<Input.TextArea readOnly rows={2} value={selected.original['编写指导']} /></label>
        <label>生成结果<Input.TextArea readOnly rows={8} value={selected.resultText ?? ''} placeholder="生成结果将在这里显示" /></label>
        {selected.errorMessage ? <Alert type="warning" showIcon message={issueText(selected)} /> : null}
      </Space> : null}
    </Modal>
  </div>
}
