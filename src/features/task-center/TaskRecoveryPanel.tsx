import { useContext, useEffect, useRef, useState } from 'react'
import { UNSAFE_LocationContext } from 'react-router-dom'
import { Alert, App, Button, Image, Popover, Space, Spin, Tag, Tooltip } from 'antd'
import {
  ClockCircleOutlined,
  CloseOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import VideoPlayer from '@/components/VideoPlayer'
import type { TaskCenterDetail, TaskCenterMedia, TaskTool } from '@shared/task-center'
import { taskBillingLabel, taskStateLabel, taskToolLabels } from '@shared/task-center'
import { useRecoveredTask } from './useRecoveredTask'
import { useTaskCenter } from './context'
import { assertRecoveryActor, prepareRecoveryParameters, readRecoveryImage, type PreparedRecoveryParameters } from './recoveryMedia'
import type { TaskActor } from './client'
import { useUserStore } from '@/store/useUserStore'

export interface RecoveryActionContext { actor: TaskActor; signal: AbortSignal }
interface Props {
  tools: readonly TaskTool[]
  projectId?: string
  onUseImage?: (result: TaskCenterMedia, image: Awaited<ReturnType<typeof readRecoveryImage>>, detail: TaskCenterDetail, context: RecoveryActionContext) => Promise<void> | void
  onLoadParameters?: (prepared: PreparedRecoveryParameters, detail: TaskCenterDetail, context: RecoveryActionContext) => Promise<void | boolean> | void | boolean
  onAddResult?: (result: TaskCenterMedia, detail: TaskCenterDetail, context: RecoveryActionContext) => Promise<void> | void
  blockedReason?: string
  onObserve?: (detail: TaskCenterDetail, context: RecoveryActionContext) => Promise<void>
}

export default function TaskRecoveryPanel(props: Props) {
  const location = useContext(UNSAFE_LocationContext)
  const owner = useUserStore(state => state.userId), scope = useUserStore(state => state.account?.runtimeScope)
  if (!location || !new URLSearchParams(location.location.search).has('task')) return null
  return <RecoveryPanelContent key={`${owner}:${scope}:${location.location.pathname}:${new URLSearchParams(location.location.search).get('task')}`} {...props}/>
}

function RecoveryPanelContent({ tools, projectId, onUseImage, onLoadParameters, onAddResult, blockedReason, onObserve }: Props) {
  const recovery = useRecoveredTask(tools, projectId), center = useTaskCenter()
  const { message } = App.useApp()
  const [busy, setBusy] = useState(false), [actionError, setActionError] = useState<string>()
  const controller = useRef<AbortController>()
  const version = `${recovery.actor?.owner}:${recovery.actor?.scope}:${recovery.identity?.taskKey}`
  useEffect(() => { const request = new AbortController(); controller.current = request; return () => request.abort() }, [version])
  useEffect(() => {
    if (!recovery.data || !recovery.actor || !onObserve || !controller.current) return
    const context = { actor: recovery.actor, signal: controller.current.signal }
    void onObserve(recovery.data, context).catch(error => { if (!context.signal.aborted) setActionError(error instanceof Error ? error.message : '原任务恢复失败，可继续查看结果') })
  }, [recovery.data, onObserve, recovery.actor])

  if (!recovery.present) return null

  if (recovery.invalid) {
    return (
      <div className="task-recovery-panel task-recovery-banner">
        <Alert
          type="error"
          showIcon
          message="任务链接无效或已过期"
          action={<Button size="small" type="text" onClick={recovery.close}>关闭</Button>}
          style={{ width: '100%' }}
        />
      </div>
    )
  }

  if (!recovery.enabled) {
    return (
      <div className="task-recovery-panel task-recovery-banner">
        <Alert
          type="info"
          showIcon
          message="任务恢复服务暂不可用，请确认已登录"
          action={<Button size="small" type="text" onClick={recovery.close}>关闭</Button>}
          style={{ width: '100%' }}
        />
      </div>
    )
  }

  if (recovery.loading) {
    return (
      <div className="task-recovery-panel task-recovery-banner is-loading">
        <Spin size="small" />
        <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>正在读取历史任务…</span>
      </div>
    )
  }

  if (recovery.error) {
    return (
      <div className="task-recovery-panel task-recovery-banner">
        <Alert
          type="warning"
          showIcon
          message="任务详情加载失败，请重试"
          description={recovery.error instanceof Error ? recovery.error.message : undefined}
          action={
            <Space size="small">
              <Button size="small" onClick={recovery.refresh}>重新读取</Button>
              <Button size="small" type="text" onClick={recovery.close}>关闭</Button>
            </Space>
          }
          style={{ width: '100%' }}
        />
      </div>
    )
  }

  const detail = recovery.data
  if (!detail) return null

  const run = async (operation: (context: RecoveryActionContext) => Promise<void>) => {
    if (!recovery.actor || !controller.current || blockedReason || busy) return
    const context = { actor: recovery.actor, signal: controller.current.signal }
    setBusy(true); setActionError(undefined)
    try { await operation(context); assertRecoveryActor(context.actor, context.signal) }
    catch (error) {
      if (!context.signal.aborted) {
        setActionError(error instanceof Error ? error.message : '操作失败')
        message.error(error instanceof Error ? error.message : '操作失败')
      }
    }
    finally { if (!context.signal.aborted) setBusy(false) }
  }

  const medias = detail.results.filter((result): result is TaskCenterMedia => result.kind !== 'text')
  const textResults = detail.results.filter(result => result.kind === 'text')

  const loadParameters = () => void run(async context => {
    if (!detail || !onLoadParameters) return
    const prepared = await prepareRecoveryParameters(detail, context.actor, context.signal)
    const applied = await onLoadParameters(prepared, detail, context)
    assertRecoveryActor(context.actor, context.signal)
    if (applied !== false) {
      requestAnimationFrame(() => {
        if (!context.signal.aborted) {
          const button = document.querySelector<HTMLElement>('[data-task-generate]')
          button?.scrollIntoView({ block: 'center', behavior: 'smooth' })
          button?.focus()
        }
      })
      message.success('已恢复原任务参数，可微调后生成')
    }
  })

  const applyMedia = (result: TaskCenterMedia) => void run(async context => {
    if (!onUseImage || result.kind !== 'image') return
    const measured = await readRecoveryImage(result, context.actor, context.signal)
    await onUseImage(result, measured, detail, context)
  })

  const addResult = (result: TaskCenterMedia) => void run(async context => {
    if (!onAddResult) return
    await onAddResult(result, detail, context)
  })

  const toolName = detail.task.tool ? (taskToolLabels[detail.task.tool] ?? detail.task.tool) : '历史任务'

  return (
    <div className="task-recovery-panel task-recovery-banner" role="region" aria-label="历史任务恢复">
      <div className="task-recovery-banner-main">
        <div className="task-recovery-banner-left">
          <ClockCircleOutlined className="task-recovery-banner-icon" />
          <span className="task-recovery-banner-title">
            历史任务：<strong>{toolName}</strong>
          </span>
          <Tag
            bordered={false}
            color={detail.task.state === 'succeeded' ? 'success' : detail.task.state === 'failed' ? 'error' : 'default'}
            style={{ margin: 0, fontSize: 12, lineHeight: '20px', padding: '0 6px' }}
          >
            {taskStateLabel(detail.task)}
          </Tag>
          {medias.length > 0 ? (
            <span className="task-recovery-meta-tag">{medias.length} 张结果</span>
          ) : null}
          {taskBillingLabel(detail.task) ? (
            <span className="task-recovery-meta-tag">{taskBillingLabel(detail.task)}</span>
          ) : null}
          {detail.task.origin?.entry === 'canvas' && detail.task.origin.sceneId !== undefined ? (
            <span className="task-recovery-meta-tag">原场景：{detail.task.origin.sceneId}</span>
          ) : null}
        </div>

        <div className="task-recovery-banner-actions">
          {onLoadParameters ? (
            <Tooltip title={!detail.params ? '此任务未保存参数记录' : undefined}>
              <Button
                size="small"
                type="primary"
                disabled={!detail.params || !!blockedReason}
                loading={busy}
                onClick={loadParameters}
              >
                恢复原参数
              </Button>
            </Tooltip>
          ) : null}

          {medias.length === 1 ? (
            <div className="task-recovery-single-media">
              {medias[0].availability === 'available' ? (
                <Popover
                  content={
                    <div style={{ textAlign: 'center' }}>
                      {medias[0].kind === 'video' ? (
                        <VideoPlayer
                          reference={{
                            objectKey: medias[0].objectKey,
                            url: medias[0].url,
                            expiresAt: Date.parse(medias[0].urlExpiresAt),
                            retentionExpiresAt: detail.task.resultExpiresAt ?? undefined,
                          }}
                          ownerId={recovery.actor?.owner}
                        />
                      ) : (
                        <Image
                          src={medias[0].url}
                          alt="原任务结果"
                          width={140}
                          height={140}
                          style={{ objectFit: 'contain', borderRadius: 4 }}
                        />
                      )}
                    </div>
                  }
                  placement="bottom"
                >
                  <img
                    src={medias[0].url}
                    alt="原任务结果"
                    className="task-recovery-thumb-single"
                  />
                </Popover>
              ) : null}
              {onUseImage && medias[0].kind === 'image' && medias[0].availability === 'available' ? (
                <Button
                  size="small"
                  disabled={!!blockedReason}
                  loading={busy}
                  onClick={() => applyMedia(medias[0])}
                >
                  基于此图继续编辑
                </Button>
              ) : null}
              {onAddResult && medias[0].availability === 'available' ? (
                <Button
                  size="small"
                  disabled={!!blockedReason}
                  loading={busy}
                  onClick={() => addResult(medias[0])}
                >
                  添加到画板
                </Button>
              ) : null}
            </div>
          ) : medias.length > 1 ? (
            <div className="task-recovery-media-strip">
              {medias.map(result => (
                <Popover
                  key={`${result.ordinal}:${result.objectKey}`}
                  placement="bottom"
                  content={
                    <div style={{ textAlign: 'center', maxWidth: 180 }}>
                      {result.availability !== 'available' ? (
                        <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                          结果 {result.ordinal + 1}：{result.availability === 'expired' ? '已过期' : '暂不可读取'}
                        </p>
                      ) : (
                        <>
                          {result.kind === 'video' ? (
                            <VideoPlayer
                              reference={{
                                objectKey: result.objectKey,
                                url: result.url,
                                expiresAt: Date.parse(result.urlExpiresAt),
                                retentionExpiresAt: detail.task.resultExpiresAt ?? undefined,
                              }}
                              ownerId={recovery.actor?.owner}
                            />
                          ) : (
                            <Image
                              src={result.url}
                              alt={`结果 ${result.ordinal + 1}`}
                              width={140}
                              height={140}
                              style={{ objectFit: 'contain', borderRadius: 4 }}
                            />
                          )}
                          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {onUseImage && result.kind === 'image' ? (
                              <Button
                                size="small"
                                type="primary"
                                disabled={!!blockedReason}
                                loading={busy}
                                onClick={() => applyMedia(result)}
                              >
                                基于此图继续编辑
                              </Button>
                            ) : null}
                            {onAddResult ? (
                              <Button
                                size="small"
                                disabled={!!blockedReason}
                                loading={busy}
                                onClick={() => addResult(result)}
                              >
                                添加到画板
                              </Button>
                            ) : null}
                          </div>
                        </>
                      )}
                    </div>
                  }
                >
                  <div
                    className="task-recovery-thumb-item"
                    role="button"
                    tabIndex={0}
                    title={`结果 ${result.ordinal + 1}（点击查看及选用）`}
                  >
                    <img src={result.url} alt={`结果 ${result.ordinal + 1}`} />
                    <span className="task-recovery-thumb-index">{result.ordinal + 1}</span>
                  </div>
                </Popover>
              ))}
            </div>
          ) : null}

          {textResults.map((result, index) => (
            <Button
              key={index}
              size="small"
              onClick={() => void run(async context => {
                assertRecoveryActor(context.actor, context.signal)
                await navigator.clipboard.writeText(result.editedText ?? result.text)
                message.success('结果已复制')
              })}
            >
              复制结果
            </Button>
          ))}

          <Button
            size="small"
            onClick={() => center?.show(detail.task)}
            title="查看完整详情及下载"
          >
            查看详情
          </Button>

          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={recovery.refresh}
            title="重新读取任务"
          />

          <Button
            size="small"
            type="text"
            className="task-recovery-banner-close"
            icon={<CloseOutlined />}
            onClick={recovery.close}
            disabled={busy}
            title="退出历史恢复并返回编辑"
          >
            退出恢复
          </Button>
        </div>
      </div>

      {detail.errorMessage ? (
        <Alert type="warning" showIcon message={detail.errorMessage} style={{ margin: 0 }} />
      ) : null}
      {blockedReason ? (
        <Alert type="info" showIcon message={blockedReason} style={{ margin: 0 }} />
      ) : null}
      {actionError ? (
        <Alert
          type="warning"
          showIcon
          closable
          onClose={() => setActionError(undefined)}
          message={actionError}
          style={{ margin: 0 }}
        />
      ) : null}
    </div>
  )
}
