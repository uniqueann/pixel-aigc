import { Badge, Button, Tooltip } from 'antd'
import { ClockCircleOutlined, WarningOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import {
  taskIsActive,
  type TaskCenterSummary,
  type TaskTool,
} from '@shared/task-center'
import {
  localizedTaskStateLabel,
  relativeTime,
  taskToolLabel,
} from './format'
import { useTaskCenter } from './context'

export function TaskStatusDot({
  task,
}: {
  task: Pick<TaskCenterSummary, 'state' | 'partial'>
}) {
  useTranslation('taskCenter')
  const color = taskIsActive(task)
    ? 'yellow'
    : task.state === 'succeeded'
      ? 'green'
      : task.state === 'cancelled'
        ? 'gray'
        : 'red'
  return (
    <span
      className={`task-status-dot is-${color}`}
      role="img"
      aria-label={localizedTaskStateLabel(task)}
    />
  )
}
export function TaskCenterEntry({ tool }: { tool: TaskTool }) {
  const { t } = useTranslation('taskCenter')
  const center = useTaskCenter()
  return center ? (
    <Button
      size="small"
      className="task-tool-entry"
      aria-label={t('sidebar.currentToolTasks')}
      title={t('sidebar.currentToolTasks')}
      icon={<ClockCircleOutlined />}
      onClick={() => center.show(undefined, tool)}
    >
      <span className="task-tool-entry-label">
        {t('sidebar.currentToolTasks')}
      </span>
    </Button>
  ) : null
}
export function TaskCenterSidebar({ compact }: { compact: boolean }) {
  const { t } = useTranslation('taskCenter')
  const center = useTaskCenter()
  if (!center) return null
  const found = new Set(
    (center.sidebar?.items ?? []).map(
      (task) => `${task.sourceKind}:${task.requestId}`,
    ),
  )
  const pending = center.receipts.filter(
    (receipt) => !found.has(`${receipt.sourceKind}:${receipt.requestId}`),
  )
  const items = center.sidebar?.items ?? []
  const count = center.sidebar?.activeCount ?? 0
  return (
    <section
      className={`task-sidebar${compact ? ' is-compact' : ''}`}
      aria-label={t('sidebar.recentTasks')}
    >
      <Tooltip
        title={
          pending.length
            ? t('sidebar.tooltipWithPending', {
                active: count,
                pending: pending.length,
              })
            : t('sidebar.tooltip', { active: count })
        }
        placement="right"
      >
        <button
          type="button"
          className="task-sidebar-heading"
          onClick={() => center.show()}
          aria-label={
            count > 0
              ? t('sidebar.headingAriaActive', { count })
              : t('sidebar.headingAria')
          }
        >
          <div className="task-sidebar-heading-leading">
            <Badge count={count} size="small" overflowCount={99}>
              <ClockCircleOutlined />
            </Badge>
            <span className="task-sidebar-expanded task-sidebar-heading-title">
              {count > 0
                ? t('sidebar.headingTitleActive', { count })
                : t('sidebar.headingTitle')}
            </span>
          </div>
          <span className="task-sidebar-expanded task-sidebar-heading-all">
            {t('sidebar.allLink')}
          </span>
        </button>
      </Tooltip>
      <div className="task-sidebar-expanded task-sidebar-body">
        {center.error ? (
          <p className="task-read-warning">
            {items.length
              ? t('sidebar.readWarningCached')
              : t('sidebar.readWarning')}
          </p>
        ) : null}
        {center.loading && !items.length ? (
          <p className="task-empty">{t('sidebar.loading')}</p>
        ) : null}
        {items.filter(taskIsActive).map((task) => (
          <TaskSidebarRow
            key={task.taskKey}
            task={task}
            onClick={() => center.show(task)}
          />
        ))}
        {pending
          .slice(0, Math.max(0, 5 - items.filter(taskIsActive).length))
          .map((receipt) => (
            <button
              type="button"
              key={`${receipt.sourceKind}:${receipt.requestId}`}
              className="task-sidebar-row"
              onClick={() => center.show()}
            >
              <span className="task-status-dot is-gray" />
              <span className="task-sidebar-copy">
                <strong>{taskToolLabel(receipt.origin?.tool)}</strong>
                <span>{t('pending.title')}</span>
              </span>
            </button>
          ))}
        {items
          .filter((task) => !taskIsActive(task))
          .slice(
            0,
            Math.max(0, 5 - items.filter(taskIsActive).length - pending.length),
          )
          .map((task) => (
            <TaskSidebarRow
              key={task.taskKey}
              task={task}
              onClick={() => center.show(task)}
            />
          ))}
        {!center.loading &&
        !center.error &&
        !items.length &&
        !pending.length ? (
          <p className="task-empty">{t('empty')}</p>
        ) : null}
      </div>
    </section>
  )
}
function TaskSidebarRow({
  task,
  onClick,
}: {
  task: TaskCenterSummary
  onClick: () => void
}) {
  const { t } = useTranslation('taskCenter')
  return (
    <button type="button" className="task-sidebar-row" onClick={onClick}>
      <TaskStatusDot task={task} />
      <span className="task-sidebar-copy">
        <strong>
          {taskToolLabel(task.tool)}
          {task.partial ? (
            <WarningOutlined aria-label={t('sidebar.partialAvailable')} />
          ) : null}
        </strong>
        <span>
          {localizedTaskStateLabel(task)} · {task.completedCount}/
          {task.requestedCount} · {relativeTime(task.createdAt)}
        </span>
      </span>
    </button>
  )
}
