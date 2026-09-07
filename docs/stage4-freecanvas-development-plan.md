# Stage 4 FreeCanvas 开发计划

> 状态：Stage 4.1、4.2、4.3 已实现；下一阶段从 Stage 4.4 开始。
> 更新时间：2026-09-08

## 1. Stage 4 目标

Stage 4 把 Editor Core 的领域实体和生成任务真正接入空间画布。用户需要能够在同一个 FreeCanvas 中发起生成、看到任务占位、安排结果位置，并继续编辑生成出来的图片或视频。

完整闭环为：

```text
用户参数
  → GenerationTask
  → GenerationJob
  → 画布占位节点
  → Asset
  → ImageNode / VideoNode
  → 选择、变换、删除、撤销与重做
```

Stage 4 不实现多轨时间线、视频剪辑、音频波形和最终合成渲染。这些能力需要等到产品出现明确的多片段编排需求后再进入 Timeline 阶段。

## 2. 阶段拆分

| 阶段 | 内容 | 状态 |
|---|---|---|
| 4.1 | Fabric 空间画布、选择、移动、缩放、旋转、删除、视口控制与 Command History | 已完成 |
| 4.2 | 文生图参数、异步占位、多结果入画布、失败重试与位置保留 | 已完成 |
| 4.3 | VideoNode 渲染、文生视频任务、播放控制和媒体通用生成链路 | 已完成 |
| 4.4 | 从已有 Asset 发起 Variation 与 Image-to-Video，补齐 Generation Lineage 入口 | 待开发 |
| 4.5 | Project JSON 保存、恢复、版本迁移和自动保存 | 待开发 |
| 4.6 | Stage 4 集成验收、性能与错误恢复收口 | 待开发 |

## 3. Stage 4.3 交付范围

### 3.1 VideoNode 画布能力

- 支持由 `VideoAsset` 创建 `VideoNode`，并通过 HTML Video + Fabric Image 渲染视频帧。
- 视频节点与图片节点共享移动、缩放、旋转、选择、删除及 Command History。
- 选中视频后，画布工具栏提供播放/暂停和静音/取消静音。
- 双击视频可快速切换播放状态。
- 播放时使用 `requestAnimationFrame` 驱动 Fabric 重绘；全部视频暂停后停止刷新。
- 节点删除、URL 替换或画布卸载时，终止加载、暂停播放并释放媒体资源。
- 支持浏览器能够解码的 MP4/WebM URL；解码或播放失败通过统一画布错误入口反馈。

### 3.2 文生视频业务闭环

- 输入参数为提示词、画面比例和视频时长。
- MVP 每次只生成一段视频，时长提供 5 秒和 10 秒两个选项。
- 提交后在当前视口中心插入 `GenerationNode`；生成期间允许移动占位。
- 任务完成后执行一次 `ResolveGenerationCommand`，原子替换为 `VideoAsset + VideoNode`。
- 最终视频沿用占位节点的位置和尺寸。
- 失败后可按原参数和当前位置重试，也可清除占位后修改参数。
- 生成成功的整次替换只占一条历史记录，撤销移除节点，重做恢复节点；Asset 继续保留在 Registry 中。

### 3.3 生成控制器通用化

原有 FreeCanvas Controller 仅接受文生图参数。Stage 4.3 将入口改为媒体请求：

```ts
interface CanvasGenerationRequest {
  capability: Capability.TextToImage | Capability.TextToVideo
  requestId: string
  params: TextToImageTaskParams | TextToVideoTaskParams
}
```

Controller 负责统一提交、轮询、任务恢复、失败重试、占位管理和结果替换。能力差异只保留在请求构建器和 Asset/Node 适配阶段，页面与 Provider 不直接耦合。

## 4. 数据约束

文生视频请求参数：

```ts
interface TextToVideoTaskParams {
  prompt: string
  size: { width: number; height: number }
  durationSeconds: number
  count: 1
}
```

后端任务成功后返回一个视频 URL。`taskAdapter` 根据 `Capability.TextToVideo` 创建 `VideoAsset`，写入请求尺寸和时长；Controller 再创建引用该 Asset 的 `VideoNode`。Provider 名称和模型参数仍由后端决定，不进入画布领域模型。

## 5. 状态与并发规则

1. FreeCanvas 当前只允许一个活动生成任务，活动任务完成或退出参数锁定后才能提交下一次生成。
2. 占位节点不写入 Command History，避免异步轮询阶段污染用户撤销栈。
3. 生成结果替换必须由一条 Command 完成，不能逐个结果创建多条撤销记录。
4. 轮询结果按 `taskId + status + updatedAt` 去重，同一个成功结果只解析一次。
5. 视频加载与任务轮询相互独立；视频解码失败不会破坏已经写入的 Asset 和 Node 数据。
6. Mock Gateway 返回本地确定性 MP4，供离线开发和浏览器验收使用；生产环境仍消费后端返回的对象存储 URL。

## 6. Stage 4.3 验收标准

- 文生图原有多结果生成、重试和历史功能无回归。
- 文生视频页面可填写提示词、比例和 5/10 秒时长并提交。
- 任务排队或处理中显示可移动占位，成功后占位变为一个 VideoNode。
- VideoAsset 保存正确的 MIME 类型、尺寸、时长和 Generation 关联。
- 视频可播放、暂停、静音、移动、缩放、旋转、删除、撤销和重做。
- 删除或卸载视频后不再继续播放或请求画布重绘。
- 请求构建器、Task Adapter、Mock Gateway 和 Controller 闭环测试通过。
- `npm test`、`npm run lint`、`npm run build` 通过，并完成浏览器端完整流程验证。

## 7. Stage 4.4 入口

Stage 4.3 完成后，下一轮围绕已有资产继续创作：

- 图片节点发起 Variation，生成结果作为新的 ImageAsset/ImageNode 放到原节点附近。
- 图片节点发起 Image-to-Video，复用 Stage 4.3 的视频占位、VideoAsset 和 VideoNode 能力。
- 生成请求记录输入 Asset ID 和 `parentGenerationId`，形成可查询的 Generation Lineage。
- 先提供选中节点后的明确操作入口，不提前建设复杂节点图或完整版本树 UI。
