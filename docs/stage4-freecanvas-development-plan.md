# Stage 4 FreeCanvas 开发计划

> 状态：Stage 4.1 至 4.5 已实现；下一阶段从 Stage 4.6 开始。
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
| 4.4 | 从已有 Asset 发起 Variation 与 Image-to-Video，补齐 Generation Lineage 入口 | 已完成 |
| 4.5 | Project JSON 保存、恢复、版本迁移和自动保存 | 已完成 |
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

## 7. Stage 4.4 交付范围

### 7.1 基于节点继续生成

- 选中 `ImageNode` 时，在节点上方显示“裂变”和“生成视频”浮动操作条。
- 点击操作后，右侧栏切换为派生生成表单并展示源 Asset；顶部文生图/文生视频路由保持不变。
- Variation 支持可选变化描述和 1–4 个结果，默认生成 4 张。
- Image-to-Video 复用 `Capability.TextToVideo`，通过 `sourceImageUrl` 区分，支持必填动态描述和 5/10 秒时长。
- 派生请求使用源 Asset 的 URL 和固有尺寸；节点旋转、缩放和透明度不烘焙到输入图片。

### 7.2 排布与历史

- 提交时根据源节点旋转后的包围盒，在其右侧预留结果位置，固定间距为 32。
- 结果显示尺寸与源节点相同；两个结果水平排列，三个或四个结果按两列网格排列。
- 源节点之后移动或删除不影响已预留的占位、任务和结果。
- 用户移动占位后，最终结果继续沿用移动后的位置和尺寸。
- 同一任务的全部结果仍由一条 `ResolveGenerationCommand` 写入，支持整批撤销和重做。

### 7.3 Generation Lineage

- `inputAssetIds` 记录源 Asset，是内容血缘的权威关系。
- 源 Asset 来自生成任务时，`parentGenerationId` 记录其直接父 Generation。
- `retryOfGenerationId` 单独记录自动或手动重试关系，不占用内容父代字段。
- 输出 Asset 的 `generationId` 指向实际产生该结果的 Generation。

### 7.4 失败恢复

- 每个派生生成周期在 `failed` 或成功但无结果时自动重试一次。
- 自动重试创建新的 `requestId`，复用原参数、Lineage 和当前占位位置。
- 第二次仍失败时保留失败占位，可手动再次重试或修改参数；手动重试开启新的周期。
- `cancelled`、提交网络错误和轮询网络错误不会创建新的自动重试任务。
- 空结果会在本地转为失败 Generation，避免画布占位显示错误状态。

## 8. Stage 4.5 交付范围

### 8.1 项目快照与本地保存

- `ProjectSnapshot` 以独立 `schemaVersion` 保存 `PixelProject`、画布生成草稿和任务恢复记录；Fabric 对象、Command History 和播放状态不进入快照。
- 当前项目写入 IndexedDB，普通修改采用 500 毫秒防抖；提交意图、后端任务绑定和结果应用属于立即保存点。
- 页面启动时先恢复项目再挂载业务路由，选择和撤销/重做历史重置，视频恢复为暂停状态。
- 保留远端 URL、站内资源路径和已有 Data URL；拒绝 `blob:` 与不可恢复的 Data URL。
- 主编辑页面持有浏览器编辑锁，第二个标签页进入保护页，避免同时覆盖同一项目。

### 8.2 导入导出与恢复

- 顶部项目栏提供项目命名、保存状态、立即保存、JSON 导入导出和新建空白项目。
- 导入支持当前快照和旧裸 `PixelProject`；导入前校验场景、节点、Asset、Generation、Lineage、媒体地址和恢复记录的引用完整性。
- 损坏存档或未来 schema 不覆盖当前数据，并提供下载原始数据、重试读取和重新开始入口。
- 用户主动清空、新建或导入的空白画布在刷新后保持为空，不再补入示例图。

### 8.3 Generation 续接

- 每次提交先持久化请求和 `requestId`，刷新后查询原 `backendTaskId`，不自动创建新任务。
- 任务号尚未确认时由用户使用原幂等键继续；Mock Gateway 同样持久化任务并保证重复键返回原任务。
- 成功结果记录 `applied`，结果被撤销或删除后刷新不会重新插回画布。
- 派生任务的自动重试额度、父子关系和 `retryOfGenerationId` 一起恢复；刷新不会重置额度。
- 轮询失败保留节点和任务，媒体加载失败保留节点与 Asset，并提供重新查询、放弃占位或重新加载媒体入口。
- 项目切换或控制器卸载后到达的旧异步响应不得写入新项目。

### 8.4 验收结果

- 快照、迁移、自动保存、存储失败、任务刷新恢复、幂等提交、自动重试预算和 Mock 任务持久化均有自动化测试。
- 浏览器验证覆盖草稿刷新、生成任务跨刷新完成、占位位置保留、撤销结果不复现、空白项目恢复、JSON 往返和多标签页保护。
- `npm test`、`npm run lint`、`npm run build` 通过。

## 9. Stage 4.6 入口

下一轮进行 Stage 4 完整集成验收、性能测量与错误恢复收口，重点检查大画布、多媒体节点、长 Generation 历史和持续自动保存下的交互稳定性。
