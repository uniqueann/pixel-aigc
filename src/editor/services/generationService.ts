import { createTask, type CreateTaskPayload } from '@/services/api/task'
import type { GenerationTask } from '@/types'
import type { Asset, AssetId, GenerationId, GenerationJob } from '@/editor/types'
import { adaptGenerationTask, type TaskAdapterOptions } from '@/editor/adapters/taskAdapter'

export interface GenerationRegistry {
  registerAsset: (asset: Asset) => void
  registerGeneration: (generation: GenerationJob) => void
}

type CreateTask = <TParams>(payload: CreateTaskPayload<TParams>) => Promise<GenerationTask<TParams>>

export class GenerationService {
  constructor(
    private readonly registry: GenerationRegistry,
    private readonly createTaskRequest: CreateTask = createTask,
  ) {}

  async submit<TParams>(
    payload: CreateTaskPayload<TParams>,
    options: TaskAdapterOptions & { inputAssetIds: AssetId[] },
  ) {
    const task = await this.createTaskRequest(payload)
    const adapted = this.reconcile(task, options)
    return { task, ...adapted }
  }

  reconcile<TParams>(task: GenerationTask<TParams>, options: TaskAdapterOptions) {
    const adapted = adaptGenerationTask(task, options)
    const existing = new Set(options.existingAssets?.map(asset => asset.id) ?? [])
    this.registry.registerGeneration(options.deferAssets ? { ...adapted.generation, outputAssetIds: adapted.assets.filter(asset => existing.has(asset.id)).map(asset => asset.id) } : adapted.generation)
    if (!options.deferAssets) adapted.assets.forEach((asset) => this.registry.registerAsset(asset))
    return adapted
  }
}

export type { AssetId, GenerationId }
