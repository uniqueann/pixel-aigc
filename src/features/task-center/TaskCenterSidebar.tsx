import { Badge, Button, Tooltip } from 'antd'
import { ClockCircleOutlined, WarningOutlined } from '@ant-design/icons'
import {
  taskIsActive,
  taskStateLabel,
  taskToolLabels,
  type TaskCenterSummary,
  type TaskTool,
} from '@shared/task-center'
import { relativeTime } from './format'
import { useTaskCenter } from './context'

export function TaskStatusDot({
  task,
}: {
  task: Pick<TaskCenterSummary, 'state' | 'partial'>
}) {
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
      aria-label={taskStateLabel(task)}
    />
  )
}
export function TaskCenterEntry({ tool }: { tool: TaskTool }) {
  const center = useTaskCenter()
  return center ? (
    <Button
      size="small"
      className="task-tool-entry"
      aria-label="当前工具任务"
      title="当前工具任务"
      icon={<ClockCircleOutlined />}
      onClick={() => center.show(undefined, tool)}
    >
      <span className="task-tool-entry-label">当前工具任务</span>
    </Button>
  ) : null
}
export function TaskCenterSidebar({ compact }: { compact: boolean }) {
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
      aria-label="近期任务"
    >
      <Tooltip
        title={`任务 · 进行中 ${count}${pending.length ? ` · 待确认 ${pending.length}` : ''}`}
        placement="right"
      >
        <button
          type="button"
          className="task-sidebar-heading"
          onClick={() => center.show()}
          aria-label={count > 0 ? `任务，进行中 ${count}，全部` : '任务，全部'}
        >
          <div className="task-sidebar-heading-leading">
            <Badge count={count} size="small" overflowCount={99}>
              <ClockCircleOutlined />
            </Badge>
            <span className="task-sidebar-expanded task-sidebar-heading-title">
              任务{count > 0 ? ` · ${count}` : ''}
            </span>
          </div>
          <span className="task-sidebar-expanded task-sidebar-heading-all">
            全部 ›
          </span>
        </button>
      </Tooltip>
      <div className="task-sidebar-expanded task-sidebar-body">
        {center.error ? (
          <p className="task-read-warning">
            无法获取最新状态{items.length ? '，已显示上次记录' : ''}
          </p>
        ) : null}
        {center.loading && !items.length ? (
          <p className="task-empty">正在读取任务…</p>
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
                <strong>
                  {receipt.origin
                    ? taskToolLabels[receipt.origin.tool]
                    : '生成任务'}
                </strong>
                <span>任务确认中</span>
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
          <p className="task-empty">暂无近期任务</p>
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
  return (
    <button type="button" className="task-sidebar-row" onClick={onClick}>
      <TaskStatusDot task={task} />
      <span className="task-sidebar-copy">
        <strong>
          {task.tool ? taskToolLabels[task.tool] : '生成任务'}
          {task.partial ? <WarningOutlined aria-label="部分结果可用" /> : null}
        </strong>
        <span>
          {taskStateLabel(task)} · {task.completedCount}/{task.requestedCount} ·{' '}
          {relativeTime(task.createdAt)}
        </span>
      </span>
    </button>
  )
}
