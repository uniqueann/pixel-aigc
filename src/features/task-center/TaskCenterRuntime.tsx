import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { onlineManager, useQuery, useQueryClient } from '@tanstack/react-query'
import { App } from 'antd'
import { CloudError } from '@/cloud/client'
import { useUserStore } from '@/store/useUserStore'
import { useTaskStore } from '@/store/useTaskStore'
import {
  taskIsActive,
  taskToolLabels,
  type TaskCenterSummary,
  type TaskHistoryState,
  type TaskTool,
  type TaskSourceKind,
} from '@shared/task-center'
import {
  readTaskSidebar,
  readTaskSummary,
  readTaskDetail,
  sameTaskActor,
  taskCenterKeys,
  type TaskActor,
} from './client'
import {
  readReceipts,
  removeReceipt,
  TASK_CENTER_EVENT,
  type TaskCenterEvent,
  type TaskReceipt,
} from './receipts'
import { TaskCenterContext, type TaskCenterContextValue } from './context'
const TaskCenterDrawer = lazy(() =>
  import('./TaskCenterDrawer').then((module) => ({
    default: module.TaskCenterDrawer,
  })),
)

const receiptKey = (receipt: Pick<TaskReceipt, 'sourceKind' | 'requestId'>) =>
  `${receipt.sourceKind}:${receipt.requestId}`

export function TaskCenterProvider({
  children,
  onCredits,
}: {
  children: ReactNode
  onCredits: () => void
}) {
  const account = useUserStore((s) => s.account),
    userId = useUserStore((s) => s.userId)
  const owner = account?.userId === userId ? userId : undefined,
    scope = account?.runtimeScope
  const actor = useMemo(
    () => (owner && scope ? { owner, scope } : null),
    [owner, scope],
  )
  return (
    <TaskCenterSession
      key={actor ? `${actor.owner}:${actor.scope}` : 'disabled'}
      actor={actor}
      enabled={!!account?.features?.taskCenter}
      onCredits={onCredits}
    >
      {children}
    </TaskCenterSession>
  )
}

function TaskCenterSession({
  actor,
  enabled,
  children,
  onCredits,
}: {
  actor: TaskActor | null
  enabled: boolean
  children: ReactNode
  onCredits: () => void
}) {
  const online = useSyncExternalStore(
    (callback) => onlineManager.subscribe(callback),
    () => onlineManager.isOnline(),
    () => true,
  )
  const client = useQueryClient(),
    { notification, message } = App.useApp()
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState<TaskCenterSummary | null>(null),
    [tool, setTool] = useState<TaskTool>(),
    [state, setState] = useState<TaskHistoryState>('all')
  const [receipts, setReceipts] = useState(() =>
    actor ? readReceipts(actor) : [],
  )
  const alive = useRef(true),
    watchAbort = useRef<AbortController>(),
    watchBusy = useRef(false),
    watchPosition = useRef(0),
    storageWarned = useRef(false)
  const initiated = useRef(new Set<string>())
  const watched = useRef(
    new Map<string, { sourceKind: TaskSourceKind; requestId: string }>(),
  )
  const routed = useRef(
    new Map<string, { sourceKind: TaskSourceKind; requestId: string; sourceId: string }>(),
  )
  const observations = useRef(
    new Map<string, { active: boolean; version: string | null }>(),
  )
  const summaries = useRef(new Map<string, TaskCenterSummary>())
  const notified = useRef(new Set<string>()),
    selectedRef = useRef(selected)
  useEffect(() => {
    selectedRef.current = selected
  }, [selected])
  const current = () => !!actor && alive.current && sameTaskActor(actor)
  const refresh = () => {
    if (actor && current())
      void client.invalidateQueries({ queryKey: taskCenterKeys.root(actor) })
  }
  const observe = (task: TaskCenterSummary) => {
    if (!current()) return
    const previous = observations.current.get(task.taskKey),
      version = task.outcomeVersion,
      active = taskIsActive(task)
    const started = initiated.current.has(receiptKey(task))
    if (
      version &&
      !task.seen &&
      !task.dismissed &&
      (previous?.active ||
        started ||
        (previous?.version && previous.version !== version))
    ) {
      const key = `${task.taskKey}:${version}`
      if (!notified.current.has(key)) {
        notified.current.add(key)
        if (notified.current.size > 500)
          notified.current.delete(notified.current.values().next().value!)
        const viewing = [...routed.current.values()].some(
          (entry) => entry.sourceKind === task.sourceKind && entry.sourceId === task.sourceId,
        )
        if (selectedRef.current?.taskKey !== task.taskKey && !viewing) {
          const title = task.tool ? taskToolLabels[task.tool] : '任务'
          const announce =
            task.state === 'succeeded'
              ? notification.success
              : notification.error
          announce({
            key: `task-center:${actor!.owner}:${actor!.scope}:${key}`,
            message:
              task.state === 'succeeded'
                ? `${title}${task.partial ? '部分完成' : '已完成'}`
                : `${title}${task.state === 'expired' ? '已超时' : '失败'}`,
            description: '可在任务详情中查看结果和积分状态',
            onClick: () => {
              if (current()) {
                setSelected(task)
                setOpen(true)
              }
            },
          })
        }
      }
    }
    observations.current.set(task.taskKey, { active, version })
    summaries.current.set(task.taskKey, task)
    while (observations.current.size > 200) {
      const first = observations.current.keys().next().value!
      observations.current.delete(first)
      summaries.current.delete(first)
    }
    if (active) watched.current.set(receiptKey(task), task)
    else {
      watched.current.delete(receiptKey(task))
      initiated.current.delete(receiptKey(task))
    }
    if (actor) {
      client.setQueryData(taskCenterKeys.summary(actor, task.sourceKind, task.requestId), task)
      removeReceipt(actor, task.sourceKind, task.requestId)
      setReceipts(readReceipts(actor))
    }
    if (
      selectedRef.current?.taskKey === task.taskKey &&
      (selectedRef.current.outcomeVersion !== version ||
        selectedRef.current.completedCount !== task.completedCount)
    ) {
      setSelected(task)
      void client.invalidateQueries({
        queryKey: taskCenterKeys.detail(actor!, task.taskKey),
      })
    }
  }
  const failures = useRef(0)
  const query = useQuery({
    queryKey: actor
      ? taskCenterKeys.sidebar(actor)
      : ['task-center', 'disabled'],
    enabled: !!actor && enabled,
    retry: false,
    queryFn: async ({ signal }) => {
      try {
        const data = await readTaskSidebar(actor!, signal)
        if (!current())
          throw new CloudError(401, '账号已切换', 'ACCOUNT_CHANGED')
        failures.current = 0
        return data
      } catch (error) {
        if (!signal.aborted) failures.current++
        throw error
      }
    },
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchIntervalInBackground: false,
    refetchInterval: (q) =>
      q.state.error
        ? [8000, 16000, 30000, 60000][
            Math.min(Math.max(failures.current - 1, 0), 3)
          ]
        : q.state.data?.activeCount || receipts.length || watched.current.size
          ? 8000
          : 30000,
  })
  const observeRef = useRef(observe)
  useEffect(() => {
    observeRef.current = observe
  })
  useEffect(() => {
    if (!enabled || !actor || !query.data || !current()) return
    query.data.items.forEach((task) => observeRef.current(task))
    if (watchBusy.current || document.hidden) return
    const pending = readReceipts(actor)
    const entries = new Map([
      ...watched.current,
      ...pending.map((r) => [receiptKey(r), r] as const),
      ...routed.current,
    ])
    const visible = new Set(query.data.items.map(receiptKey))
    const waiting = [...entries.values()].filter(
      (r) => !visible.has(receiptKey(r)),
    )
    const offset = watchPosition.current % Math.max(1, waiting.length)
    const todo = [...waiting.slice(offset), ...waiting.slice(0, offset)].slice(
      0,
      50,
    )
    watchPosition.current += todo.length
    if (!todo.length) return
    watchBusy.current = true
    const abort = new AbortController()
    watchAbort.current = abort
    let index = 0
    const worker = async () => {
      while (index < todo.length && !abort.signal.aborted) {
        const entry = todo[index++]
        try {
          const result = await readTaskSummary(
            actor,
            entry.sourceKind,
            entry.requestId,
            abort.signal,
          )
          if (current()) observeRef.current(result)
        } catch {
          /* 未找到或网络失败只保留待确认，不触发生成。 */
        }
      }
    }
    void Promise.all([worker(), worker()]).finally(() => {
      watchBusy.current = false
    })
    // 查询快照到达时启动一轮观察；统一协调器始终读取最新闭包。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.dataUpdatedAt, enabled, actor?.owner, actor?.scope])
  useEffect(() => {
    alive.current = true
    const notificationKeys = notified.current
    const handler = (event: Event) => {
      if (!actor || !enabled || !sameTaskActor(actor)) return
      const data = (event as CustomEvent<TaskCenterEvent>).detail
      if (data.actor && (data.actor.owner !== actor.owner || data.actor.scope !== actor.scope)) return
      if (data.type === 'storage-error' && !storageWarned.current) {
        storageWarned.current = true
        message.warning('提交凭据未能保存在本机，刷新后可从近期任务查找')
      }
      if (
        data.receipt &&
        data.receipt.owner === actor.owner &&
        data.receipt.scope === actor.scope
      ) {
        initiated.current.add(receiptKey(data.receipt))
        watched.current.set(receiptKey(data.receipt), data.receipt)
        setReceipts(readReceipts(actor))
      }
      if (data.type === 'observed' && data.sourceId && data.sourceKind) {
        const key = `${data.sourceKind}:${data.sourceId}`
        if (data.viewing !== undefined && data.requestId) {
          const entry = { sourceKind: data.sourceKind, sourceId: data.sourceId, requestId: data.requestId }
          if (data.viewing) routed.current.set(receiptKey(entry), entry)
          else routed.current.delete(receiptKey(entry))
          if (!data.viewing) return
        }
        if (data.active)
          observations.current.set(key, {
            active: true,
            version: observations.current.get(key)?.version ?? null,
          })
        if (data.requestId) {
          const entry = {
            sourceKind: data.sourceKind,
            requestId: data.requestId,
          }
          if (data.viewing === undefined) watched.current.set(receiptKey(entry), entry)
        }
        const known = summaries.current.get(key)
        if (known) {
          if (taskIsActive(known)) watched.current.set(receiptKey(known), known)
          if (taskIsActive(known) === !!data.active && data.viewing === undefined) return
        } else if (!data.requestId && !watchBusy.current) {
          watchBusy.current = true
          const abort = new AbortController()
          watchAbort.current = abort
          void readTaskDetail(
            actor,
            data.sourceKind,
            data.sourceId,
            abort.signal,
          )
            .then((value) => {
              if (current()) observeRef.current(value.task)
            })
            .catch(() => undefined)
            .finally(() => {
              watchBusy.current = false
            })
        }
      }
      refresh()
    }
    window.addEventListener(TASK_CENTER_EVENT, handler)
    return () => {
      alive.current = false
      watchAbort.current?.abort()
      window.removeEventListener(TASK_CENTER_EVENT, handler)
      if (actor) {
        void client.cancelQueries({ queryKey: taskCenterKeys.root(actor) })
        client.removeQueries({ queryKey: taskCenterKeys.root(actor) })
        if (!sameTaskActor(actor)) {
          void client.cancelQueries({
            queryKey: ['task', actor.owner, actor.scope],
          })
          client.removeQueries({
            queryKey: ['task', actor.owner, actor.scope],
          })
        }
      }
      if (actor)
        for (const key of notificationKeys)
          notification.destroy(
            `task-center:${actor.owner}:${actor.scope}:${key}`,
          )
      const expected = actor ? `${actor.owner}:${actor.scope}` : null
      if (
        (!actor || !sameTaskActor(actor)) &&
        useTaskStore.getState().owner === expected
      )
        useTaskStore.getState().resetOwner(null)
    }
    // 会话以账号与环境为 key；事件处理通过最新观察器协调。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor?.owner, actor?.scope, enabled])
  const unavailable =
    query.error instanceof CloudError &&
    query.error.code === 'TASK_CENTER_DISABLED'
  useEffect(() => {
    if (unavailable && actor && sameTaskActor(actor)) {
      const account = useUserStore.getState().account!
      useUserStore.getState().setAccount({
        ...account,
        features: { ...account.features, taskCenter: false },
      })
    }
  }, [unavailable, actor])
  const value: TaskCenterContextValue | null =
    actor && enabled && !unavailable
      ? {
          actor,
          sidebar: query.data,
          loading: query.isPending,
          error:
            query.error ??
            (!online
              ? new CloudError(0, '网络已断开，保留上次快照', 'OFFLINE')
              : null),
          receipts,
          open,
          selected,
          tool,
          state,
          show: (task, filter) => {
            setSelected(task ?? null)
            setTool(filter)
            if (!open) setState('all')
            setOpen(true)
          },
          close: () => {
            setOpen(false)
            setSelected(null)
          },
          filter: (nextTool, nextState) => {
            setTool(nextTool)
            setState(nextState)
            setSelected(null)
          },
          refresh,
          forget: (receipt) => {
            removeReceipt(actor, receipt.sourceKind, receipt.requestId)
            watched.current.delete(receiptKey(receipt))
            setReceipts(readReceipts(actor))
            refresh()
          },
          credits: () => {
            setOpen(false)
            setSelected(null)
            onCredits()
          },
        }
      : null
  return (
    <TaskCenterContext.Provider value={value}>
      {children}
      {actor && enabled && !unavailable && open ? (
        <Suspense fallback={null}>
          <TaskCenterDrawer />
        </Suspense>
      ) : null}
    </TaskCenterContext.Provider>
  )
}
