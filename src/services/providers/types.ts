/**
 * 这里只放前端需要感知的 Provider 抽象层类型（与后端 AIProvider 接口对齐），
 * 真正的 Provider 实现（调用通义万相 / Midjourney / 自研模型等）在后端 Worker 中，
 * 前端永远只通过 /tasks 接口提交统一参数，不直接对接任何一家模型服务商。
 * 详见 docs/architecture.md 的 Provider 抽象层章节。
 */
export interface ProviderCapabilityInfo {
  provider: string
  capability: string
  estimatedCreditsPerCall: number
  avgLatencySeconds: number
}
