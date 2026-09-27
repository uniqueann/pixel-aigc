export class HttpError extends Error {
  stage?: string
  constructor(public status: number, message: string, public code = 'REQUEST_FAILED', options?: { cause?: unknown; stage?: string }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'HttpError'
    this.stage = options?.stage
  }
}

function causeText(error: unknown): string | undefined {
  if (!(error instanceof Error) || error.cause == null) return undefined
  const raw = error.cause
  const head = raw instanceof Error ? `${raw.name}: ${raw.message}` : String(raw)
  const nested = raw instanceof Error ? causeText(raw) : undefined
  return nested ? `${head} (${nested})` : head
}

export function describeError(error: unknown): { name: string; message: string; cause?: string; stage?: string } {
  const name = error instanceof Error ? error.name : '未知错误'
  const message = error instanceof Error ? error.message : String(error)
  return { name, message, cause: causeText(error), stage: error instanceof HttpError ? error.stage : undefined }
}
