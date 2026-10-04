import { useEffect, useState, useSyncExternalStore } from 'react'
import { createTask, findTaskByRequest, getTask } from '@/services/api/task'
import { useTaskStore } from '@/store/useTaskStore'
import type { EmailGenerationGate } from '../useEmailGenerationGate'
import { createEmailBatchRunner } from './runner'

export function useEmailBatchController(gate: EmailGenerationGate) {
  const [runner] = useState(() => createEmailBatchRunner({
    submit: (request, signal) => createTask(request, { signal }), find: findTaskByRequest, get: getTask,
    acquire: () => gate.acquire('batch'), release: () => gate.release('batch'),
    onTask: task => useTaskStore.getState().upsertTask(task),
    onInvalidKey: () => window.dispatchEvent(new Event('pixel:model-settings-changed')),
  }))
  const state = useSyncExternalStore(runner.subscribe, runner.getSnapshot)
  useEffect(() => {
    // 开发环境严格模式会执行一次清理后再挂载，需要重新连接同一队列。
    runner.activate()
    return () => runner.dispose()
  }, [runner])
  return {
    ...state, ...runner,
    busy: state.runState === 'running' || state.runState === 'pausing' || state.recovering,
    unresolved: state.rows.some(row => row.status === 'uncertain'),
  }
}

export type EmailBatchController = ReturnType<typeof useEmailBatchController>
