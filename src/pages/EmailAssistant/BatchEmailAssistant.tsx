import { recommendedEmailModel, EMAIL_LANGUAGE_OPTIONS } from '@shared/email-models'
import EmailModelChoice from '@/features/email-assistant/EmailModelChoice'
import { useKnownCreditBalance } from '@/features/credits/useKnownCreditBalance'
import { openCreditRecharge } from '@/services/api/billing'
import { useEffect, useMemo, useRef, useState, type TdHTMLAttributes } from 'react'
import { Alert, App, Button, Card, Descriptions, Input, Modal, Progress, Segmented, Space, Table, Tag, Upload, type TableColumnsType } from 'antd'
import {
  ArrowLeftOutlined, ArrowRightOutlined, CopyOutlined, DownloadOutlined, InboxOutlined,
  PauseOutlined, PlayCircleOutlined, RedoOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { authEnabled } from '@/cloud/client'
import { translateApiError } from '@/i18n/apiErrors'
import { formatMegabytes } from '@/i18n/format'
import { usePreferencesStore } from '@/features/preferences/store'
import { useUserStore } from '@/store/useUserStore'
import { trackFirstUpload } from '@/features/activation/client'
import type { EmailModelConfiguration } from '@/features/email-assistant/useEmailModelConfiguration'
import type { EmailBatchController } from '@/features/email-assistant/batch/useEmailBatchController'
import { EMAIL_BATCH_HEADER_KEYS, EMAIL_BATCH_MAX_BYTES, EMAIL_BATCH_MAX_ROWS } from '@/features/email-assistant/options'
import { formatEmailBatchError, formatEmailBatchLocator } from '@/features/email-assistant/batch/labels'
import { emailBatchStatusLabel, type EmailBatchRow, type EmailBatchStatus } from '@/features/email-assistant/batch/types'
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
type BatchColKey = 'index' | 'status' | 'source' | 'instruction' | 'settings' | 'language' | 'result' | 'actions'

type BatchCellAttrs = TdHTMLAttributes<HTMLTableCellElement> & { 'data-col': BatchColKey; 'data-label': string }
const batchCellProps = (col: BatchColKey, label: string): BatchCellAttrs => ({ 'data-col': col, 'data-label': label })

const STATUS_COLORS: Record<EmailBatchStatus, string> = {
  pending: 'default', processing: 'processing', succeeded: 'success',
  failed: 'error', invalid: 'warning', uncertain: 'warning',
}

function formatBatchError(error: unknown, fallback: string) {
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

export default function BatchEmailAssistant({ controller, configuration, singleBusy, openModelSettings }: Props) {
  const { t } = useTranslation(['email', 'common'])
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
  const issueText = (row: EmailBatchRow) => {
    if (!row.errorMessage && !row.errorCode) return ''
    const detail = row.errorCode
      ? translateApiError({
          code: row.errorCode,
          message: row.errorMessage,
          fallback: t('email:runner.errors.generateFailed'),
        })
      : row.errorMessage!
    return formatEmailBatchError(sequenceOf(row), row.recordNumber, detail)
  }
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

  const filterOptions = useMemo(
    () => [
      { label: t('email:batch.filters.all'), value: 'all' },
      { label: t('email:batch.filters.pending'), value: 'pending' },
      { label: t('email:batch.filters.failed'), value: 'failed' },
      { label: t('email:batch.filters.succeeded'), value: 'succeeded' },
    ],
    [t],
  )

  const languageGuideText = useMemo(
    () => EMAIL_LANGUAGE_OPTIONS
      .map(item => t('email:batch.guide.languageOptionItem', { label: t(`email:languages.${item.value}`), code: item.value }))
      .join(t('email:batch.guide.languageSeparator')),
    [t],
  )

  const confirmRun = (retry = false) => {
    if (!modelId || !profile || cannotGenerate) return
    if (balance != null && balance < profile.credits) { openCreditRecharge(); return }
    const count = retry ? counts.failed : counts.pending
    const eta = count > 0 ? t('email:batch.confirmRun.eta', { count }) : ''
    const balanceNote = balance != null
      ? t('email:batch.confirmRun.balanceNote', { completable: Math.floor(balance / profile.credits) })
      : ''
    Modal.confirm({
      title: retry ? t('email:batch.confirmRun.retryTitle') : t('email:batch.confirmRun.startTitle'),
      content: t('email:batch.confirmRun.content', {
        model: profile.label,
        creditsPerRun: profile.credits,
        count,
        estimatedCredits: count * profile.credits,
        eta,
        balanceNote,
      }),
      okText: t('email:batch.confirmRun.ok'),
      cancelText: t('common:actions.cancel'),
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
          title: t('email:batch.replaceConfirm.title'),
          content: t('email:batch.replaceConfirm.content', { count: controller.rows.length }),
          okText: t('common:actions.replace'),
          cancelText: t('common:actions.cancel'),
          okButtonProps: { danger: true },
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
      message.success(t('email:batch.messages.imported', {
        total: rows.length,
        valid: rows.filter(row => row.status === 'pending').length,
      }))
    } catch (error) {
      if (epoch === importEpoch.current) setImportError(formatBatchError(error, t('email:batch.messages.importFailed')))
    } finally {
      if (epoch === importEpoch.current) setReading(false)
    }
    return Upload.LIST_IGNORE
  }

  const copyResult = async (row: EmailBatchRow) => {
    if (!row.resultText) return
    try { await navigator.clipboard.writeText(row.resultText); message.success(t('email:batch.messages.copied')) }
    catch { message.error(t('email:batch.messages.copyFailed')) }
  }
  const handleAction = (action: Promise<void>) => {
    void action.catch(error => message.error(formatBatchError(error, t('email:batch.messages.actionFailed'))))
  }

  const clearBatch = () => {
    if (!hasRows) return
    const previous = { rows: controller.rows, fileName: controller.fileName }
    const succeededNote = counts.succeeded ? t('email:batch.clearConfirm.succeededNote', { count: counts.succeeded }) : ''
    modal.confirm({
      title: t('email:batch.clearConfirm.title'),
      content: t('email:batch.clearConfirm.content', { total: previous.rows.length, succeededNote }),
      okText: t('email:batch.clearConfirm.ok'),
      cancelText: t('common:actions.cancel'),
      okButtonProps: { danger: true },
      onOk: () => {
        try {
          controller.load([])
          setImportError(undefined)
          setSelectedId(undefined)
          setFilter('all')
          setShowImporter(true)
          message.open({
            type: 'info', duration: 5,
            content: <span>{t('email:batch.messages.cleared', { count: previous.rows.length })}
              <Button type="link" size="small" onClick={() => {
                try {
                  controller.load(previous.rows, previous.fileName)
                  setShowImporter(false)
                  message.destroy()
                } catch (error) {
                  message.error(formatBatchError(error, t('email:batch.messages.undoFailed')))
                }
              }}>{t('common:actions.undo')}</Button>
            </span>,
          })
        } catch (error) {
          message.error(formatBatchError(error, t('email:batch.messages.clearFailed')))
        }
      },
    })
  }

  const indexColLabel = t('email:batch.columns.index')
  const statusColLabel = t('email:batch.columns.status')
  const sourceColLabel = t('email:csv.headers.source')
  const instructionColLabel = t('email:csv.headers.instruction')
  const settingsColLabel = t('email:csv.headers.settings')
  const languageColLabel = t('email:csv.headers.language')
  const resultColLabel = t('email:batch.columns.result')
  const actionsColLabel = t('email:batch.columns.actions')

  const columns: TableColumnsType<EmailBatchRow> = [
    { title: indexColLabel, width: '6%', onCell: () => batchCellProps('index', indexColLabel), render: (_, row) => sequenceOf(row) },
    { title: statusColLabel, width: '12%', onCell: () => batchCellProps('status', statusColLabel), render: (_, row) => <div className="email-batch-status">
      <Tag color={STATUS_COLORS[row.status]}>{emailBatchStatusLabel(row.status)}</Tag>
      {row.errorMessage ? <p className="email-batch-row-error">{issueText(row)}</p> : null}
    </div> },
    { title: sourceColLabel, width: showResultColumn ? '24%' : '34%', onCell: () => batchCellProps('source', sourceColLabel), render: (_, row) => <span className="email-batch-cell">{row.original[EMAIL_BATCH_HEADER_KEYS.source] || '—'}</span> },
    { title: instructionColLabel, width: showResultColumn ? '12%' : '14%', onCell: () => batchCellProps('instruction', instructionColLabel), render: (_, row) => <span className="email-batch-cell">{row.original[EMAIL_BATCH_HEADER_KEYS.instruction] || '—'}</span> },
    { title: settingsColLabel, width: showResultColumn ? '12%' : '14%', onCell: () => batchCellProps('settings', settingsColLabel), render: (_, row) => <span className="email-batch-cell">{row.params ? formatEmailOperation(row.params) : row.original[EMAIL_BATCH_HEADER_KEYS.settings] || '—'}</span> },
    { title: languageColLabel, width: showResultColumn ? '8%' : '10%', onCell: () => batchCellProps('language', languageColLabel), render: (_, row) => row.params ? formatEmailLanguage(row.params) : row.original[EMAIL_BATCH_HEADER_KEYS.language] || '—' },
    ...(showResultColumn ? [{ title: resultColLabel, width: '16%', onCell: () => batchCellProps('result', resultColLabel), render: (_: unknown, row: EmailBatchRow) => <span className="email-batch-cell">{row.resultText || '—'}</span> }] : []),
    { title: actionsColLabel, width: '10%', onCell: () => batchCellProps('actions', actionsColLabel), render: (_, row) => <div className="email-batch-row-actions">
      <Button type="link" size="small" onClick={() => setSelectedId(row.id)}>{t('email:batch.actions.details')}</Button>
      <Button type="link" size="small" disabled={!row.resultText} onClick={() => void copyResult(row)}>{t('common:actions.copy')}</Button>
    </div> },
  ]

  return <div className="email-batch-panel">
    {hasRows ? <div className="email-batch-summary">
      <div className="email-batch-summary-head">
        <div className="email-batch-summary-copy">
          <strong title={controller.fileName}>{controller.fileName ?? t('email:batch.summary.defaultTitle')}</strong>
          <p role="status" aria-live="polite">{t('email:batch.summary.counts', {
            total: controller.rows.length,
            pending: counts.pending,
            processing: counts.processing,
            succeeded: counts.succeeded,
            failed: counts.failed,
            invalid: counts.invalid,
            uncertain: counts.uncertain,
          })}</p>
          {etaMinutes ? <span>{t('email:batch.summary.eta', { minutes: etaMinutes })}</span> : null}
        </div>
        <Space wrap className="email-batch-summary-actions">
          {controller.busy && !controller.recovering ? <Button icon={<PauseOutlined />} disabled={controller.runState === 'pausing'}
            onClick={controller.pause}>{controller.runState === 'pausing' ? t('email:batch.actions.pausing') : t('email:batch.actions.pause')}</Button>
            : <Button type="primary" icon={<PlayCircleOutlined />} disabled={cannotGenerate || !counts.pending}
              onClick={() => confirmRun()}>
              {controller.runState === 'paused' ? t('email:batch.actions.resume') : t('email:batch.actions.generate')}{counts.pending ? t('email:batch.actions.pendingCountSuffix', { count: counts.pending }) : ''}
            </Button>}
          {counts.failed ? <Button icon={<RedoOutlined />} disabled={cannotGenerate}
            onClick={() => confirmRun(true)}>{t('email:batch.actions.retryFailed')}</Button> : null}
          {controller.unresolved ? <Button loading={controller.recovering} disabled={controller.busy && !controller.recovering}
            onClick={() => handleAction(controller.recover())}>{t('email:batch.actions.recover')}</Button> : null}
          <Button disabled={locked || reading} onClick={clearBatch}>{t('email:batch.actions.clearBatch')}</Button>
          <Button icon={<DownloadOutlined />} disabled={reading} onClick={() => {
            const name = controller.fileName?.replace(/\.csv$/i, '') ?? t('email:batch.files.defaultPrefix')
            downloadEmailCsv(exportEmailBatchCsv(controller.rows), t('email:batch.files.exportName', { name }))
          }}>{t('email:batch.actions.exportCsv')}</Button>
        </Space>
      </div>
      <Progress percent={validCount ? Math.round((counts.succeeded + counts.failed) / validCount * 100) : 0}
        showInfo={false} size="small" status={controller.busy ? 'active' : 'normal'} />
    </div> : null}

    <Card className="email-batch-import-card" size="small" title={<h2 className="email-card-title">{t('email:batch.importCard.title')}</h2>}
      extra={<Space wrap size={8}>
        <Button size="small" icon={<DownloadOutlined />}
          onClick={() => downloadEmailCsv(createEmailBatchTemplate(), t('email:batch.files.templateName'))}>{t('email:batch.actions.downloadTemplate')}</Button>
        <Button type="text" size="small" aria-expanded={templateOpen}
          onClick={() => setTemplateOpen(value => !value)}>{templateOpen ? t('email:batch.importCard.hideGuide') : t('email:batch.importCard.showGuide')}</Button>
      </Space>}>
      {hasRows && !showImporter ? <div className="email-batch-import-compact">
        <span>{t('email:batch.importCard.currentFile', { name: controller.fileName ?? '' })}</span>
        <span>{t('email:batch.importCard.rowCount', { count: controller.rows.length })}</span>
        <Button size="small" onClick={() => setShowImporter(true)}>{t('email:batch.actions.replaceFile')}</Button>
      </div> : <>
        <Upload.Dragger accept=".csv,text/csv" maxCount={1} multiple={false} showUploadList={false}
          disabled={locked || reading} beforeUpload={importFile}>
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">{reading ? t('email:batch.importCard.readingCsv') : t('email:batch.importCard.uploadText')}</p>
          <p className="ant-upload-hint">{t('email:batch.importCard.uploadHint', {
            maxRows: EMAIL_BATCH_MAX_ROWS,
            maxSize: formatMegabytes(EMAIL_BATCH_MAX_BYTES),
          })}</p>
        </Upload.Dragger>
        <p className="email-batch-hint">{t('email:batch.importCard.retentionHint')}</p>
        <p className="email-batch-hint">{t('email:batch.importCard.rateHint')}</p>
        {hasRows ? <Button type="link" size="small" onClick={() => setShowImporter(false)}>{t('email:batch.actions.keepCurrentFile')}</Button> : null}
      </>}
      <div className="email-batch-template-body" hidden={!templateOpen}>
        <table className="email-batch-template-table">
          <thead><tr><th>{t('email:batch.guide.colHeader')}</th><th>{t('email:batch.guide.rulesHeader')}</th></tr></thead>
          <tbody>
            <tr><td>{sourceColLabel}</td><td>{t('email:batch.guide.sourceRule')}</td></tr>
            <tr><td>{instructionColLabel}</td><td>{t('email:batch.guide.instructionRule')}</td></tr>
            <tr><td>{settingsColLabel}</td><td>{t('email:batch.guide.settingsRule')}</td></tr>
            <tr><td>{languageColLabel}</td><td>{t('email:batch.guide.languageRule')}</td></tr>
          </tbody>
        </table>
        <ul className="email-batch-template-notes">
          <li>{t('email:batch.guide.settingsNotePrefix')}<Button type="link" size="small" onClick={openModelSettings}
            className="email-batch-inline-link">{t('email:batch.guide.personalDefaults')}</Button>{t('email:batch.guide.settingsNoteSuffix')}</li>
          <li>{t('email:batch.guide.languageNote', { options: languageGuideText })}</li>
        </ul>
      </div>
      {authEnabled ? <div className="email-batch-model"><EmailModelChoice configuration={configuration} value={modelId} language={language}
        disabled={locked || Boolean(controller.modelProfileId)} onChange={setPickedModel} /></div>
        : !profile ? <p className="email-batch-hint">{t('email:batch.importCard.localModeHint')}</p> : null}
      {controller.modelProfileId ? <p className="email-batch-hint">{t('email:batch.importCard.modelLockedHint')}</p> : null}
      {authEnabled && mixed && !modelId ? <Alert type="info" message={t('email:batch.importCard.mixedLanguageAlert')} /> : null}
      <p className="email-batch-hint">{t('email:batch.importCard.validSummary', {
        count: validCount,
        costPart: profile ? t('email:batch.importCard.validCostPart', { remaining: remainingCost, charged }) : '',
      })}</p>
      {authEnabled ? <p className="email-batch-hint">{t('email:batch.importCard.balanceLine', {
        balance: balance ?? t('email:single.balanceLoading'),
        completablePart: balance != null && profile
          ? t('email:batch.importCard.completablePart', { count: Math.floor(balance / profile.credits) })
          : '',
      })}
        <Button type="link" size="small" onClick={openCreditRecharge}>{t('email:single.rechargeCredits')}</Button></p> : null}
      {importError ? <Alert type="error" showIcon message={t('email:batch.messages.importFailed')} description={importError} /> : null}
    </Card>

    <Card size="small" title={<h2 className="email-card-title">{t('email:batch.resultCard.title')}</h2>}>
      {singleBusy ? <Alert type="info" showIcon message={t('email:batch.alerts.singleBusy')} className="email-batch-alert" /> : null}
      {invalidLocators.length ? <Alert type="warning" showIcon className="email-batch-alert"
        message={t('email:batch.alerts.invalidRows', { locators: invalidLocators.join(t('email:batch.guide.languageSeparator')) })} /> : null}
      {controller.pauseMessage ? <Alert type="warning" showIcon message={controller.pauseMessage} className="email-batch-alert" /> : null}
      {hasRows ? <>
        <div className="email-batch-filter">
          <Segmented size="small" value={filter} onChange={value => setFilter(value as BatchFilter)} options={filterOptions} />
          <span className="email-batch-filter-hint">{t('email:batch.filterCount', { shown: filteredRows.length, total: controller.rows.length })}</span>
        </div>
        <Table<EmailBatchRow> className="email-batch-table" rowKey="id" size="small" tableLayout="fixed"
          dataSource={filteredRows}
          pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true }}
          locale={{ emptyText: filter === 'all' ? t('email:batch.emptyAll') : t('email:batch.emptyFiltered') }} columns={columns} />
      </> : <div className="email-batch-empty"><InboxOutlined aria-hidden /><span>{t('email:batch.emptyAll')}</span></div>}
    </Card>

    <Modal title={selected ? formatEmailBatchLocator(selectedIndex + 1, selected.recordNumber) : ''} open={!!selected} onCancel={() => setSelectedId(undefined)}
      width="min(760px, calc(100vw - 32px))" footer={<div className="email-batch-detail-footer">
        <Space>
          <Button icon={<ArrowLeftOutlined />} disabled={selectedIndex <= 0}
            onClick={() => setSelectedId(controller.rows[selectedIndex - 1]?.id)}>{t('email:batch.detail.prev')}</Button>
          <Button icon={<ArrowRightOutlined />} disabled={selectedIndex < 0 || selectedIndex >= controller.rows.length - 1}
            onClick={() => setSelectedId(controller.rows[selectedIndex + 1]?.id)}>{t('email:batch.detail.next')}</Button>
        </Space>
        {selected?.resultText ? <Button icon={<CopyOutlined />} onClick={() => void copyResult(selected)}>{t('email:batch.detail.copyResult')}</Button> : null}
      </div>}>
      {selected ? <Space direction="vertical" size={16} className="email-batch-detail">
        <Descriptions size="small" column={1} items={[
          { key: 'operation', label: t('email:batch.detail.effectiveSettings'), children: selected.params ? formatEmailOperation(selected.params) : selected.original[EMAIL_BATCH_HEADER_KEYS.settings] || '—' },
          { key: 'language', label: t('email:batch.detail.effectiveLanguage'), children: selected.params ? formatEmailLanguage(selected.params) : selected.original[EMAIL_BATCH_HEADER_KEYS.language] || '—' },
          { key: 'cost', label: t('email:batch.detail.creditsCost'), children: selected.creditsCost ?? '—' },
          { key: 'model', label: t('email:batch.detail.model'), children: configuration.profiles.find(model => model.id === selected.modelProfileId)?.label ?? '—' },
          { key: 'status', label: t('email:batch.detail.status'), children: emailBatchStatusLabel(selected.status) },
        ]} />
        <label className="email-batch-detail-field"><span>{sourceColLabel}<small>{t('email:batch.detail.readonly')}</small></span><Input.TextArea className="email-batch-detail-readonly" aria-label={t('email:batch.detail.sourceReadonlyAria')} readOnly rows={5} value={selected.original[EMAIL_BATCH_HEADER_KEYS.source]} /></label>
        <label className="email-batch-detail-field"><span>{instructionColLabel}<small>{t('email:batch.detail.readonly')}</small></span><Input.TextArea className="email-batch-detail-readonly" aria-label={t('email:batch.detail.instructionReadonlyAria')} readOnly rows={2} value={selected.original[EMAIL_BATCH_HEADER_KEYS.instruction]} /></label>
        <label className="email-batch-detail-field"><span>{resultColLabel}<small>{t('email:batch.detail.readonly')}</small></span><Input.TextArea className="email-batch-detail-readonly" aria-label={t('email:batch.detail.resultReadonlyAria')} readOnly rows={8} value={selected.resultText ?? ''} placeholder={t('email:single.resultPlaceholder')} /></label>
        {selected.errorMessage ? <Alert type="warning" showIcon message={issueText(selected)} /> : null}
      </Space> : null}
    </Modal>
  </div>
}
