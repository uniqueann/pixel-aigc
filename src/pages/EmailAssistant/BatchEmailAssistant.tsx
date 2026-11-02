import { recommendedEmailModel, EMAIL_LANGUAGE_OPTIONS } from '@shared/email-models'
import EmailModelChoice from '@/features/email-assistant/EmailModelChoice'
import { useKnownCreditBalance } from '@/features/credits/useKnownCreditBalance'
import { openCreditRecharge } from '@/services/api/billing'
import { useEffect, useRef, useState, type TdHTMLAttributes } from 'react'
import { Alert, App, Button, Card, Descriptions, Input, Modal, Progress, Segmented, Space, Table, Tag, Upload, type TableColumnsType } from 'antd'
import {
  ArrowLeftOutlined, ArrowRightOutlined, CopyOutlined, DownloadOutlined, InboxOutlined,
  PauseOutlined, PlayCircleOutlined, RedoOutlined,
} from '@ant-design/icons'
import { authEnabled } from '@/cloud/client'
import { usePreferencesStore } from '@/features/preferences/store'
import { useUserStore } from '@/store/useUserStore'
import { trackFirstUpload } from '@/features/activation/client'
import type { EmailModelConfiguration } from '@/features/email-assistant/useEmailModelConfiguration'
import type { EmailBatchController } from '@/features/email-assistant/batch/useEmailBatchController'
import { EMAIL_BATCH_MAX_ROWS } from '@/features/email-assistant/options'
import { formatEmailBatchError, formatEmailBatchLocator } from '@/features/email-assistant/batch/labels'
import { EMAIL_BATCH_STATUS_LABELS, type EmailBatchRow, type EmailBatchStatus } from '@/features/email-assistant/batch/types'
import {
  createEmailBatchTemplate, downloadEmailCsv, exportEmailBatchCsv,
  formatEmailLanguage, formatEmailOperation, readEmailBatchFile,
} from '@/features/email-assistant/batch/csv'

interface Props {
  controller: EmailBatchController
  configuration: EmailModelConfiguration
  singleBusy: boolean
  openModelSettings: () => void
}

type BatchFilter = 'all' | 'pending' | 'failed' | 'succeeded'

const batchCellLabel = (label: string) => ({ 'data-label': label } as TdHTMLAttributes<HTMLTableCellElement>)

const STATUS_COLORS: Record<EmailBatchStatus, string> = {
  pending: 'default', processing: 'processing', succeeded: 'success',
  failed: 'error', invalid: 'warning', uncertain: 'warning',
}

const FILTER_OPTIONS = [
  { label: '全部', value: 'all' },
  { label: '待处理', value: 'pending' },
  { label: '失败', value: 'failed' },
  { label: '已完成', value: 'succeeded' },
]

export default function BatchEmailAssistant({ controller, configuration, singleBusy, openModelSettings }: Props) {
  const { message, modal } = App.useApp()
  const [pickedModel, setPickedModel] = useState<string>()
  const balance = useKnownCreditBalance()
  const [reading, setReading] = useState(false)
  const [importError, setImportError] = useState<string>()
  const [selectedId, setSelectedId] = useState<string>()
  const [templateOpen, setTemplateOpen] = useState(false)
  const [showImporter, setShowImporter] = useState(true)
  const [filter, setFilter] = useState<BatchFilter>('all')
  const importEpoch = useRef(0)
  useEffect(() => () => { ++importEpoch.current }, [])
  const counts = controller.rows.reduce((result, row) => ({ ...result, [row.status]: result[row.status] + 1 }),
    { pending: 0, processing: 0, succeeded: 0, failed: 0, invalid: 0, uncertain: 0 })
  const validCount = controller.rows.length - counts.invalid
  const hasRows = controller.rows.length > 0
  const showResultColumn = controller.rows.some(row => row.resultText)
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
  const filteredRows = filter === 'all' ? controller.rows : controller.rows.filter(row => row.status === filter)
  const etaMinutes = counts.pending

  const confirmRun = (retry = false) => {
    if (!modelId || !profile || cannotGenerate) return
    if (balance != null && balance < profile.credits) { openCreditRecharge(); return }
    const count = retry ? counts.failed : counts.pending
    const eta = count > 0 ? `按每小时 60 条估算，至少约 ${count} 分钟。` : ''
    Modal.confirm({ title: retry ? '确认重试失败邮件' : '确认批量生成',
      content: `${profile.label}，每次成功 ${profile.credits} 积分；本次 ${count} 条，预计 ${count * profile.credits} 积分。${eta}${balance != null ? `当前余额预计可完成 ${Math.floor(balance / profile.credits)} 条。` : ''}失败返还，余额不足时暂停。`,
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
    if (controller.rows.length) {
      const confirmed = await new Promise<boolean>(resolve => {
        modal.confirm({
          title: '替换当前批次？',
          content: `当前 ${controller.rows.length} 条邮件将被替换，且无法恢复。`,
          okText: '替换', cancelText: '取消', okButtonProps: { danger: true },
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        })
      })
      if (!confirmed) return Upload.LIST_IGNORE
    }
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
      setFilter('all')
      setShowImporter(false)
      setTemplateOpen(false)
      // 新文件导入后，旧的「撤销清空」不应再覆盖当前批次。
      message.destroy()
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

  const clearBatch = () => {
    if (!hasRows) return
    const previous = { rows: controller.rows, fileName: controller.fileName }
    modal.confirm({
      title: '清空当前批次？',
      content: `将移除 ${previous.rows.length} 条邮件${counts.succeeded ? `，其中 ${counts.succeeded} 条已生成结果` : ''}，且无法恢复。`,
      okText: '清空', cancelText: '取消', okButtonProps: { danger: true },
      onOk: () => {
        try {
          controller.load([])
          setImportError(undefined)
          setSelectedId(undefined)
          setFilter('all')
          setShowImporter(true)
          message.open({
            type: 'info', duration: 5,
            content: <span>已清空 {previous.rows.length} 条邮件
              <Button type="link" size="small" onClick={() => {
                try {
                  controller.load(previous.rows, previous.fileName)
                  setShowImporter(false)
                  message.destroy()
                } catch (error) {
                  message.error(error instanceof Error ? error.message : '撤销失败')
                }
              }}>撤销</Button>
            </span>,
          })
        } catch (error) {
          message.error(error instanceof Error ? error.message : '清空失败')
        }
      },
    })
  }

  const columns: TableColumnsType<EmailBatchRow> = [
    { title: '序号', width: '6%', onCell: () => batchCellLabel('序号'), render: (_, row) => sequenceOf(row) },
    { title: '状态', width: '12%', onCell: () => batchCellLabel('状态'), render: (_, row) => <div className="email-batch-status">
      <Tag color={STATUS_COLORS[row.status]}>{EMAIL_BATCH_STATUS_LABELS[row.status]}</Tag>
      {row.errorMessage ? <p className="email-batch-row-error">{issueText(row)}</p> : null}
    </div> },
    { title: '原始邮件内容', width: showResultColumn ? '24%' : '34%', onCell: () => batchCellLabel('原始邮件内容'), render: (_, row) => <span className="email-batch-cell">{row.original['原始邮件内容'] || '—'}</span> },
    { title: '编写指导', width: showResultColumn ? '12%' : '14%', onCell: () => batchCellLabel('编写指导'), render: (_, row) => <span className="email-batch-cell">{row.original['编写指导'] || '—'}</span> },
    { title: '生成设置', width: showResultColumn ? '12%' : '14%', onCell: () => batchCellLabel('生成设置'), render: (_, row) => <span className="email-batch-cell">{row.params ? formatEmailOperation(row.params) : row.original['生成设置'] || '—'}</span> },
    { title: '语言', width: showResultColumn ? '8%' : '10%', onCell: () => batchCellLabel('语言'), render: (_, row) => row.params ? formatEmailLanguage(row.params) : row.original['语言'] || '—' },
    ...(showResultColumn ? [{ title: '生成结果', width: '16%', onCell: () => batchCellLabel('生成结果'), render: (_: unknown, row: EmailBatchRow) => <span className="email-batch-cell">{row.resultText || '—'}</span> }] : []),
    { title: '操作', width: '10%', onCell: () => batchCellLabel('操作'), render: (_, row) => <div className="email-batch-row-actions">
      <Button type="link" size="small" onClick={() => setSelectedId(row.id)}>详情</Button>
      <Button type="link" size="small" disabled={!row.resultText} onClick={() => void copyResult(row)}>复制</Button>
    </div> },
  ]

  return <div className="email-batch-panel">
    {hasRows ? <div className="email-batch-summary">
      <div className="email-batch-summary-head">
        <div className="email-batch-summary-copy">
          <strong title={controller.fileName}>{controller.fileName ?? '当前批次'}</strong>
          <p role="status" aria-live="polite">共 {controller.rows.length} 条 · 待处理 {counts.pending} · 生成中 {counts.processing} · 成功 {counts.succeeded} · 失败 {counts.failed} · 填写错误 {counts.invalid} · 待确认 {counts.uncertain}</p>
          {etaMinutes ? <span>按每小时 60 条估算，至少约 {etaMinutes} 分钟</span> : null}
        </div>
        <Space wrap className="email-batch-summary-actions">
          {controller.busy && !controller.recovering ? <Button icon={<PauseOutlined />} disabled={controller.runState === 'pausing'}
            onClick={controller.pause}>{controller.runState === 'pausing' ? '正在暂停…' : '暂停'}</Button>
            : <Button type="primary" icon={<PlayCircleOutlined />} disabled={cannotGenerate || !counts.pending}
              onClick={() => confirmRun()}>
              {controller.runState === 'paused' ? '继续生成' : '生成'}{counts.pending ? ` ${counts.pending} 条` : ''}
            </Button>}
          {counts.failed ? <Button icon={<RedoOutlined />} disabled={cannotGenerate}
            onClick={() => confirmRun(true)}>重试失败项</Button> : null}
          {controller.unresolved ? <Button loading={controller.recovering} disabled={controller.busy && !controller.recovering}
            onClick={() => handleAction(controller.recover())}>重新查询原任务</Button> : null}
          <Button disabled={locked || reading} onClick={clearBatch}>清空批次</Button>
          <Button icon={<DownloadOutlined />} disabled={reading} onClick={() => {
            downloadEmailCsv(exportEmailBatchCsv(controller.rows), `${controller.fileName?.replace(/\.csv$/i, '') ?? '批量邮件'}-生成结果.csv`)
          }}>导出 CSV</Button>
        </Space>
      </div>
      <Progress percent={validCount ? Math.round((counts.succeeded + counts.failed) / validCount * 100) : 0}
        showInfo={false} size="small" status={controller.busy ? 'active' : 'normal'} />
    </div> : null}

    <Card className="email-batch-import-card" size="small" title={<h2 className="email-card-title">导入邮件</h2>}
      extra={<Space wrap size={8}>
        <Button size="small" icon={<DownloadOutlined />}
          onClick={() => downloadEmailCsv(createEmailBatchTemplate(), '邮件助手-批量模板.csv')}>下载模板</Button>
        <Button type="text" size="small" aria-expanded={templateOpen}
          onClick={() => setTemplateOpen(value => !value)}>{templateOpen ? '收起模板说明' : '查看模板说明'}</Button>
      </Space>}>
      {hasRows && !showImporter ? <div className="email-batch-import-compact">
        <span>当前文件：{controller.fileName}</span>
        <span>共 {controller.rows.length} 条</span>
        <Button size="small" onClick={() => setShowImporter(true)}>替换文件</Button>
      </div> : <>
        <Upload.Dragger accept=".csv,text/csv" maxCount={1} multiple={false} showUploadList={false}
          disabled={locked || reading} beforeUpload={importFile}>
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">{reading ? '正在读取 CSV…' : '点击或拖入 CSV 文件'}</p>
          <p className="ant-upload-hint">CSV UTF-8 格式，最多 {EMAIL_BATCH_MAX_ROWS} 条邮件，文件不超过 5 MB</p>
        </Upload.Dragger>
        <p className="email-batch-hint">批次数据保留在当前页面，切换标签页不会丢失；刷新或离开页面将中断生成，请及时导出结果。</p>
        <p className="email-batch-hint">每次按顺序生成一封，每小时最多提交 60 条。已提交邮件在最近 7 天历史中可查询。</p>
        {hasRows ? <Button type="link" size="small" onClick={() => setShowImporter(false)}>保留当前文件</Button> : null}
      </>}
      <div className="email-batch-template-body" hidden={!templateOpen}>
        <table className="email-batch-template-table">
          <thead><tr><th>列名</th><th>填写规则</th></tr></thead>
          <tbody>
            <tr><td>原始邮件内容</td><td>必填，最多 10,000 字符，支持换行、逗号和引号。</td></tr>
            <tr><td>编写指导</td><td>可空，最多 1,000 字符。</td></tr>
            <tr><td>生成设置</td><td>总结、回复、检查语法、润色；润色可组合方式。</td></tr>
            <tr><td>语言</td><td>中文、英语、日语、法语、德语、西班牙语、葡萄牙语、意大利语。</td></tr>
          </tbody>
        </table>
        <ul className="email-batch-template-notes">
          <li>生成设置列填操作类型：总结、回复、检查语法、润色；例如“润色：提升表达清晰度+缩短”。可选方式还包括“增长”“简化”。设置或语言留空时使用导入时的<Button type="link" size="small" onClick={openModelSettings}
            className="email-batch-inline-link">个人默认值</Button>；仅填写“润色”时使用默认润色方式。</li>
          <li>语言：{EMAIL_LANGUAGE_OPTIONS.map(item => `${item.label}（${item.value}）`).join('、')}。</li>
        </ul>
      </div>
      {authEnabled ? <div className="email-batch-model"><EmailModelChoice configuration={configuration} value={modelId} language={language}
        disabled={locked || Boolean(controller.modelProfileId)} onChange={setPickedModel} /></div>
        : !profile ? <p className="email-batch-hint">本地模式不连接模型服务，批量生成不可用；仍可导入、预览和导出 CSV。</p> : null}
      {controller.modelProfileId ? <p className="email-batch-hint">本批次已固定使用所选模型，开始处理后不可更改。</p> : null}
      {authEnabled && mixed && !modelId ? <Alert type="info" message="包含多种语言，请手动指定统一模型，或拆分为单一语种批次" /> : null}
      <p className="email-batch-hint">有效邮件 {validCount} 条{profile ? ` · 待处理预计 ${remainingCost} 积分 · 已实扣 ${charged} 积分` : ''}</p>
      {authEnabled ? <p className="email-batch-hint">当前余额 {balance ?? '读取中'}{balance != null && profile ? `，按此单价可完成 ${Math.floor(balance / profile.credits)} 条` : ''}
        <Button type="link" size="small" onClick={openCreditRecharge}>充值积分</Button></p> : null}
      {importError ? <Alert type="error" showIcon message="CSV 导入失败" description={importError} /> : null}
    </Card>

    <Card size="small" title={<h2 className="email-card-title">批量结果</h2>}>
      {singleBusy ? <Alert type="info" showIcon message="单个邮件正在处理，完成后可开始批量生成" className="email-batch-alert" /> : null}
      {invalidLocators.length ? <Alert type="warning" showIcon className="email-batch-alert"
        message={`${invalidLocators.join('、')}填写错误，只生成有效行；请修正 CSV 后重新上传。`} /> : null}
      {controller.pauseMessage ? <Alert type="warning" showIcon message={controller.pauseMessage} className="email-batch-alert" /> : null}
      {hasRows ? <>
        <div className="email-batch-filter">
          <Segmented size="small" value={filter} onChange={value => setFilter(value as BatchFilter)} options={FILTER_OPTIONS} />
          <span className="email-batch-filter-hint">显示 {filteredRows.length} / {controller.rows.length} 条</span>
        </div>
        <Table<EmailBatchRow> className="email-batch-table" rowKey="id" size="small" tableLayout="fixed"
          dataSource={filteredRows}
          pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true }}
          locale={{ emptyText: filter === 'all' ? '导入 CSV 后，可在这里预览邮件并生成' : '没有符合条件的邮件' }} columns={columns} />
      </> : <div className="email-batch-empty"><InboxOutlined aria-hidden /><span>导入 CSV 后，可在这里预览邮件并生成</span></div>}
    </Card>

    <Modal title={selected ? formatEmailBatchLocator(selectedIndex + 1, selected.recordNumber) : ''} open={!!selected} onCancel={() => setSelectedId(undefined)}
      width="min(760px, calc(100vw - 32px))" footer={<div className="email-batch-detail-footer">
        <Space>
          <Button icon={<ArrowLeftOutlined />} disabled={selectedIndex <= 0}
            onClick={() => setSelectedId(controller.rows[selectedIndex - 1]?.id)}>上一条</Button>
          <Button icon={<ArrowRightOutlined />} disabled={selectedIndex < 0 || selectedIndex >= controller.rows.length - 1}
            onClick={() => setSelectedId(controller.rows[selectedIndex + 1]?.id)}>下一条</Button>
        </Space>
        {selected?.resultText ? <Button icon={<CopyOutlined />} onClick={() => void copyResult(selected)}>复制生成结果</Button> : null}
      </div>}>
      {selected ? <Space direction="vertical" size={16} className="email-batch-detail">
        <Descriptions size="small" column={1} items={[
          { key: 'operation', label: '生效设置', children: selected.params ? formatEmailOperation(selected.params) : selected.original['生成设置'] || '—' },
          { key: 'language', label: '生效语言', children: selected.params ? formatEmailLanguage(selected.params) : selected.original['语言'] || '—' },
          { key: 'cost', label: '实际扣减积分', children: selected.creditsCost ?? '—' },
          { key: 'model', label: '使用模型', children: configuration.profiles.find(model => model.id === selected.modelProfileId)?.label ?? '—' },
          { key: 'status', label: '状态', children: EMAIL_BATCH_STATUS_LABELS[selected.status] },
        ]} />
        <label className="email-batch-detail-field"><span>原始邮件内容<small>只读</small></span><Input.TextArea className="email-batch-detail-readonly" aria-label="原始邮件内容（只读）" readOnly rows={5} value={selected.original['原始邮件内容']} /></label>
        <label className="email-batch-detail-field"><span>编写指导<small>只读</small></span><Input.TextArea className="email-batch-detail-readonly" aria-label="编写指导（只读）" readOnly rows={2} value={selected.original['编写指导']} /></label>
        <label className="email-batch-detail-field"><span>生成结果<small>只读</small></span><Input.TextArea className="email-batch-detail-readonly" aria-label="生成结果（只读）" readOnly rows={8} value={selected.resultText ?? ''} placeholder="生成结果将在这里显示" /></label>
        {selected.errorMessage ? <Alert type="warning" showIcon message={issueText(selected)} /> : null}
      </Space> : null}
    </Modal>
  </div>
}
