import { useEffect, useMemo, useRef, useState } from 'react'
import { App, Alert, Button, Card, Col, Input, Popconfirm, Radio, Row, Select, Space } from 'antd'
import { useTranslation } from 'react-i18next'
import EmailModelChoice from '@/features/email-assistant/EmailModelChoice'
import { recommendedEmailModel } from '@shared/email-models'
import { useKnownCreditBalance } from '@/features/credits/useKnownCreditBalance'
import { openCreditRecharge } from '@/services/api/billing'
import { CopyOutlined, RedoOutlined } from '@ant-design/icons'
import GenerationTaskStatus from '@/components/GenerationTaskStatus'
import { translateApiError } from '@/i18n/apiErrors'
import { formatDateTime } from '@/i18n/format'
import { buildEmailAssistRequest } from '@/features/email-assistant/requestBuilder'
import type { useEmailAssistantController } from '@/features/email-assistant/useEmailAssistantController'
import { taskCenterOn } from '@/features/task-center/client'
import TaskRecoveryPanel from '@/features/task-center/TaskRecoveryPanel'
import { useTaskDraftGuard } from '@/features/task-center/useTaskDraftGuard'
import { assertRecoveryActor } from '@/features/task-center/recoveryMedia'
import { authEnabled } from '@/cloud/client'
import type { EmailGenerationGate } from '@/features/email-assistant/useEmailGenerationGate'
import type { EmailModelConfiguration } from '@/features/email-assistant/useEmailModelConfiguration'
import {
  EMAIL_LANGUAGE_OPTIONS,
  EMAIL_OPERATION_IDS,
  EMAIL_POLISH_STYLE_IDS,
  emailOperationLabel,
} from '@/features/email-assistant/options'
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
  entryOperation?: EmailAssistOperation
  entryKey?: string
  onEntryConsumed?: () => void
}

function formatEmailError(error: unknown, fallback: string) {
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

export default function SingleEmailAssistant({ controller, configuration, gate, entryOperation, entryKey, onEntryConsumed }: Props) {
  const { t } = useTranslation(['email', 'common'])
  const { message } = App.useApp()
  const [sourceText, setSourceText] = useState('')
  const [instruction, setInstruction] = useState('')
  const [operation, setOperation] = useState<EmailAssistOperation>(() => entryOperation ?? usePreferencesStore.getState().preferences.email.operation)
  const [language, setLanguage] = useState<EmailAssistLanguage>(() => usePreferencesStore.getState().preferences.email.language)
  const [polishStyles, setPolishStyles] = useState<EmailPolishStyle[]>(() => usePreferencesStore.getState().preferences.email.polishStyles)
  const [modelProfileId, setModelProfileId] = useState<string>()
  const { profiles, loading: modelSettingsLoading,
    error: modelSettingsError, ready: modelSettingsReady, defaultModelProfileId } = configuration
  const selectedModelProfileId = modelProfileId ?? defaultModelProfileId ?? recommendedEmailModel(language)
  const selectedProfile = profiles.find(model => model.id === selectedModelProfileId)
  const balance = useKnownCreditBalance()
  const modelReady = modelSettingsReady && (!authEnabled || Boolean(selectedProfile?.available))
  const insufficient = balance != null && balance < (selectedProfile?.credits ?? 0)
  const generationBlocked = gate.owner === 'batch'
  const { acquire, release } = gate
  const handledEntry = useRef(entryOperation ? entryKey : undefined)
  const { newTask, formLocked } = controller
  const confirmRecovery = useTaskDraftGuard({
    dirty: Boolean(sourceText.trim() || instruction.trim() || controller.resultText),
    reason: t('email:single.confirmLeaveUnsaved'),
    beforeLeave: controller.flushEdit,
  })

  const operationOptions = useMemo(
    () => EMAIL_OPERATION_IDS.map(value => ({ value, label: t(`email:operations.${value}`) })),
    [t],
  )
  const languageOptions = useMemo(
    () => EMAIL_LANGUAGE_OPTIONS.map(item => ({ value: item.value, label: t(`email:languages.${item.value}`) })),
    [t],
  )
  const polishStyleOptions = useMemo(
    () => EMAIL_POLISH_STYLE_IDS.map(value => ({ value, label: t(`email:polishStyles.${value}`) })),
    [t],
  )

  useEffect(() => {
    if (!entryOperation || !entryKey) return
    let active = true
    queueMicrotask(() => {
      if (!active) return
      if (handledEntry.current === entryKey) { onEntryConsumed?.(); return }
      handledEntry.current = entryKey
      if (formLocked || gate.owner) {
        message.warning(t('email:single.messages.busyCannotSwitch'))
        onEntryConsumed?.(); return
      }
      void newTask().then(() => {
        if (!active) return
        const defaults = usePreferencesStore.getState().preferences.email
        setSourceText(''); setInstruction(''); setOperation(entryOperation)
        setLanguage(defaults.language); setPolishStyles(defaults.polishStyles); setModelProfileId(undefined)
        onEntryConsumed?.()
      }).catch(reason => { if (active) message.error(formatEmailError(reason, t('email:single.messages.cannotStartNew'))) })
    })
    return () => { active = false }
  }, [entryOperation, entryKey, formLocked, gate.owner, message, newTask, onEntryConsumed, t])

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
    if (task.status === 'succeeded') return controller.resultText ? t('email:single.status.succeededReady') : t('email:single.status.readingResult')
    if (task.status === 'failed' || task.status === 'cancelled') {
      return task.errorMessage || task.errorCode
        ? translateApiError({
            code: task.errorCode,
            message: task.errorMessage,
            requestId: task.requestId,
            fallback: t('email:single.status.failedFallback'),
          })
        : t('email:single.status.failedFallback')
    }
    return t('email:single.status.processing')
  }, [controller.resultText, controller.task, t])

  const handleGenerate = async () => {
    if (!modelReady) {
      message.warning(
        modelSettingsLoading
          ? t('email:single.messages.loadingModelSettings')
          : translateApiError({
              message: selectedProfile?.unavailableReason ?? undefined,
              fallback: t('email:single.messages.modelSettingsLoadFailed'),
            }),
      )
      return
    }
    if (insufficient) { openCreditRecharge(); return }
    if (!gate.acquire('single')) { message.warning(t('email:single.messages.gateBusy')); return }
    let waiting = false
    try {
      const request = buildEmailAssistRequest(currentParams)
      const task = await controller.generate(request.params, selectedModelProfileId, selectedProfile?.priceVersion)
      waiting = ['pending', 'queued', 'processing'].includes(task.status)
      if (task.status === 'succeeded') { if (!taskCenterOn()) message.success(t('email:single.messages.generated')) }
      else if (task.status === 'failed') {
        if (['PROVIDER_AUTH', 'MODEL_UNAVAILABLE'].includes(task.errorCode ?? '')) window.dispatchEvent(new Event('pixel:model-settings-changed'))
        if (!taskCenterOn()) {
          message.error(translateApiError({
            code: task.errorCode,
            message: task.errorMessage,
            requestId: task.requestId,
            fallback: t('email:single.messages.generateFailed'),
          }))
        }
      }
    } catch (error) {
      message.error(formatEmailError(error, t('email:single.messages.submitFailed')))
    } finally { if (!waiting) gate.release('single') }
  }

  const handleCopy = async () => {
    if (!controller.resultText) return
    try {
      await navigator.clipboard.writeText(controller.resultText)
      message.success(t('email:single.messages.copied'))
    } catch {
      message.error(t('email:single.messages.copyFailed'))
    }
  }

  const handleRetry = async () => {
    if (!modelReady || insufficient || !gate.acquire('single')) return
    let waiting = false
    try {
      const task = controller.task ? await controller.generate(controller.task.params, selectedModelProfileId, selectedProfile?.priceVersion) : undefined
      waiting = !!task && ['pending', 'queued', 'processing'].includes(task.status)
      if (task?.status === 'succeeded') { if (!taskCenterOn()) message.success(t('email:single.messages.regenerated')) }
      else if (task?.status === 'failed' && !taskCenterOn()) {
        message.error(translateApiError({
          code: task.errorCode,
          message: task.errorMessage,
          requestId: task.requestId,
          fallback: t('email:single.messages.retryFailed'),
        }))
      }
    } catch (error) {
      message.error(formatEmailError(error, t('email:single.messages.taskRetryFailed')))
    } finally { if (!waiting) gate.release('single') }
  }

  const handleNewTask = async () => {
    if (!await confirmRecovery(t('email:single.confirmNewTask'))) return
    await controller.newTask()
    const defaults = usePreferencesStore.getState().preferences.email
    setSourceText(''); setInstruction('')
    setOperation(defaults.operation); setLanguage(defaults.language); setPolishStyles(defaults.polishStyles)
    setModelProfileId(undefined)
  }

  const taskBillingSuffix = controller.task?.billingState === 'refunded'
    ? t('email:single.billingRefundedSuffix')
    : controller.task?.billingState === 'reserved'
      ? t('email:single.billingReservedSuffix', { credits: controller.task.creditsReserved })
      : ''

  return (
    <>
    <TaskRecoveryPanel tools={['email-assist']} blockedReason={controller.formLocked || generationBlocked ? t('email:single.recovery.blockedReason') : undefined} onLoadParameters={async (prepared, detail, context) => {
      const params = prepared.params
      if (typeof params.sourceText !== 'string' || !EMAIL_OPERATION_IDS.some(value => value === params.operation) || !EMAIL_LANGUAGE_OPTIONS.some(item => item.value === params.language)) throw new Error(t('email:single.recovery.incompleteParams'))
      if (params.instruction !== undefined && typeof params.instruction !== 'string') throw new Error(t('email:single.recovery.invalidInstruction'))
      if (!await confirmRecovery(t('email:single.recovery.confirmLoadParams'))) return false
      if (!await controller.flushEdit()) throw new Error(t('email:single.recovery.saveEditBeforeLoadFailed'))
      assertRecoveryActor(context.actor, context.signal)
      await controller.newTask()
      assertRecoveryActor(context.actor, context.signal)
      setSourceText(params.sourceText); setInstruction(typeof params.instruction === 'string' ? params.instruction : '')
      setOperation(params.operation as EmailAssistOperation); setLanguage(params.language as EmailAssistLanguage)
      setPolishStyles(Array.isArray(params.polishStyles) ? params.polishStyles.filter((value): value is EmailPolishStyle => EMAIL_POLISH_STYLE_IDS.some(id => id === value)) : ['clear'])
      setModelProfileId(detail.task.modelProfileId ?? undefined)
    }} />
    <div className="email-single-panel">
      {controller.uncertain ? <Alert type="warning" showIcon message={t('email:single.uncertainAlert')}
        action={<Button loading={controller.submitting} onClick={() => void controller.recoverSubmission().catch(error => message.error(formatEmailError(error, t('email:single.messages.queryFailed'))))}>{t('email:single.recoverSubmission')}</Button>} /> : null}
      <Row gutter={[20, 20]}>
        <Col xs={24} xl={12}>
          <Card title={<h2 className="email-card-title">{t('email:single.sourceTitle')}</h2>} size="small">
            <Input.TextArea
              aria-label={t('email:single.sourceTitle')}
              rows={12}
              value={sourceText}
              disabled={controller.formLocked}
              onChange={(event) => setSourceText(event.target.value)}
              placeholder={t('email:single.sourcePlaceholder')}
            />
          </Card>
          <Card title={<h2 className="email-card-title">{t('email:single.instructionTitle')}</h2>} size="small" style={{ marginTop: 16 }}>
            <Input.TextArea
              aria-label={t('email:single.instructionTitle')}
              rows={4}
              value={instruction}
              disabled={controller.formLocked}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder={t('email:single.instructionPlaceholder')}
            />
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card title={<h2 className="email-card-title">{t('email:single.settingsTitle')}</h2>} size="small" extra={<Button size="small"
            disabled={controller.formLocked || (!sourceText.trim() && !instruction.trim() && !controller.resultText)}
            onClick={() => void handleNewTask().catch(error => message.error(formatEmailError(error, t('email:single.messages.newTaskFailed'))))}>{t('email:single.newTask')}</Button>}>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <div>
                <div className="field-label">{t('email:single.operationLabel')}</div>
                <Radio.Group
                  options={operationOptions}
                  value={operation}
                  disabled={controller.formLocked}
                  onChange={(event) => setOperation(event.target.value as EmailAssistOperation)}
                  optionType="button"
                />
              </div>
              <div>
                <div className="field-label">{t('email:single.languageLabel')}</div>
                <Select
                  style={{ width: 200 }}
                  value={language}
                  disabled={controller.formLocked}
                  onChange={setLanguage}
                  options={languageOptions}
                />
              </div>
              {operation === 'polish' ? (
                <div>
                  <div className="field-label">{t('email:single.polishStylesLabel')}</div>
                  <Select
                    mode="multiple"
                    style={{ width: '100%' }}
                    value={polishStyles}
                    disabled={controller.formLocked}
                    onChange={setPolishStyles}
                    options={polishStyleOptions}
                  />
                </div>
              ) : null}
              {authEnabled ? <div>
                <div className="field-label">{t('email:single.modelLabel')}</div>
                <EmailModelChoice configuration={configuration} value={selectedModelProfileId} language={language}
                  disabled={controller.formLocked || Boolean(modelSettingsError)} onChange={setModelProfileId} />
              </div> : null}
              {authEnabled ? <div>{t('email:single.billingSummary', {
                credits: selectedProfile?.credits ?? '—',
                balance: balance ?? t('email:single.balanceLoading'),
              })}
                {insufficient ? <Button type="link" onClick={openCreditRecharge}>{t('email:single.rechargeCredits')}</Button> : null}
                <div className="email-save-hint">{t('email:single.billingHint')}</div>
              </div> : null}
              <Button
                data-task-generate
                type="primary"
                loading={controller.submitting}
                disabled={!sourceText.trim() || controller.formLocked || generationBlocked || !modelReady}
                onClick={handleGenerate}
              >
                {t('email:single.generate')}
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
            retryDisabled={generationBlocked || !modelReady}
            onModifyParameters={controller.modifyParameters}
            onRefetch={() => void controller.refetch()}
          />

          <Card
            title={<h2 className="email-card-title">{t('email:single.resultTitle')}</h2>}
            size="small"
            className="email-result-card"
            extra={controller.resultText ? (
              <Space>
                <Button size="small" icon={<CopyOutlined />} onClick={handleCopy}>{t('common:actions.copy')}</Button>
                <Button
                  size="small"
                  icon={<RedoOutlined />}
                  loading={controller.submitting}
                  disabled={controller.formLocked || generationBlocked || !modelReady}
                  onClick={handleGenerate}
                >
                  {t('email:single.regenerate')}
                </Button>
              </Space>
            ) : null}
          >
            <Input.TextArea
              aria-label={t('email:single.resultTitle')}
              rows={12}
              value={controller.resultText}
              disabled={controller.task?.status !== 'succeeded'}
              onChange={(event) => controller.setResultText(event.target.value)}
              placeholder={controller.active ? t('email:single.resultGeneratingPlaceholder') : t('email:single.resultPlaceholder')}
            />
            {controller.savingEdit ? <span className="email-save-hint">{t('email:single.savingEdit')}</span> : null}
            {controller.task ? <span className="email-save-hint">{t('email:single.taskCostSummary', {
              model: profiles.find(model => model.id === controller.task?.modelProfileId)?.label ?? t('email:single.legacyModel'),
              credits: controller.task.creditsCost,
              billingSuffix: taskBillingSuffix,
            })}</span> : null}
            {controller.task?.tokenUsage ? <span className="email-save-hint">{t('email:single.tokenUsage', { tokens: controller.task.tokenUsage.totalTokens })}</span> : null}
          </Card>
          {authEnabled ? <Card title={<h2 className="email-card-title">{t('email:single.recentTitle')}</h2>} size="small" style={{ marginTop: 16 }}>
            {controller.history.length ? <Space direction="vertical" style={{ width: '100%' }}>
              <Select style={{ width: '100%' }} value={controller.task?.id} placeholder={t('email:single.historyPlaceholder')}
                options={controller.history.map(item => ({
                  value: item.id,
                  label: `${formatDateTime(item.createdAt)} · ${item.operation ? emailOperationLabel(item.operation) : ''} · ${item.preview ?? ''}`,
                }))}
                onChange={id => { void controller.openTask(id).catch(error => message.error(formatEmailError(error, t('email:single.messages.historyLoadFailed')))) }} />
              <Space>
                <Button size="small" onClick={() => void controller.refreshHistory()}>{t('email:single.refreshHistory')}</Button>
                {controller.history.length < controller.historyTotal ? <Button size="small" onClick={() => void controller.loadMoreHistory().catch(error => message.error(formatEmailError(error, t('email:single.messages.historyLoadMoreFailed'))))}>{t('common:actions.loadMore')}</Button> : null}
                <Popconfirm title={t('email:single.deleteConfirm')} onConfirm={() => controller.task && void controller.removeTask(controller.task.id).catch(error => message.error(formatEmailError(error, t('email:single.messages.deleteFailed'))))}>
                  <Button danger size="small" disabled={!controller.task || controller.active}>{t('email:single.deleteTask')}</Button>
                </Popconfirm>
              </Space>
            </Space> : <span>{t('email:single.emptyHistory')}</span>}
          </Card> : null}
        </Col>
      </Row>
    </div>
    </>
  )
}
