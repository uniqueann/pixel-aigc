# 自由画布编辑模型（选择集 / 复制 / 拖放 / 层级）

给接手实现的 agent：这份文档是 `$impeccable shape` 的产物，覆盖自由画布（`src/pages/FreeCanvas/`）从"单节点编辑"升级到"选择集编辑"的交互与落地方案。看完就能动手，不需要再回来问设计意图。

来源：`.impeccable/critique/2026-11-16T14-11-17Z__src-pages-freecanvas-index-tsx.md` 的 P1 第 5 项。**本轮只做这一项**（P1 第 1–4 项是独立任务：layout / colorize / audit+harden）。

## 1. 已确认的三点决策

| # | 决策 | 结论 |
|---|---|---|
| 1 | 多选时右栏 | **(a)** 右栏切换为"已选 N 项"摘要，生成表单整体隐藏；不做批量生成 |
| 2 | `⌘D` 语义 | **纯复制**：不扣积分、不新增资产（复用同一 `assetId`），与"裂变"严格区分 |
| 3 | 层级 | **进本轮**：四组快捷键 + 操作条溢出菜单 |

## 2. 现状代码锚点（不要重新设计已定的部分）

- `src/editor/store/selectionSlice.ts` —— `selectedNodeIds: NodeId[]` **已经是数组**，`selectNodes` 已去重。数据结构不用改。
- `src/editor/commands/nodeCommands.ts` —— 命令都是单节点的；`UpdateNodeCommand` 已带 `previous`，可撤销。
- `src/editor/persistence/snapshot.ts` —— 4 个 `switch-on-type` 的辅助函数 + `deserializeCommand` 需要为新命令类型补分支，详见第 6 节。
- `src/features/free-canvas/FreeCanvasStage.tsx` —— `new Canvas(..., { selection: false })`、`onSelectNode(nodeId?)`、reconcile effect 假设 1 对象 ↔ 1 节点。**这是主要工作量。**
- `src/pages/FreeCanvas/index.tsx` —— `handleSelectNode(nodeId?)`、`handleTransformNode(nodeId, transform)`、`handleDelete()` 都按单节点写死。
- `src/features/free-canvas/geometry.ts` —— `findArtboardPlacement` / `calculateNodeBounds` / `placeArtboardNodes` 已能解决"放哪不重叠"，**必须复用，不要另写摆放逻辑**。

## 3. 选择模型

| 输入 | 结果 |
|---|---|
| 点节点 | 单选，替换选择集 |
| ⇧ + 点节点 | 加入/移出（toggle） |
| 空白处拖拽 | 框选，松开后替换选择集 |
| ⇧ + 空白处拖拽 | 框选后追加 |
| `⌘A` / `Ctrl+A` | 全选当前场景节点 |
| `Esc` | 清空选择集 |
| 拖任一已选节点 | 整组移动（Fabric `ActiveSelection` 原生） |
| 缩放/旋转把手 | 整组等比缩放（沿用 `uniformScaling: true`） |

框选矩形样式改为 `SELECTION_COLOR`（`#21cfa0`）+ 4% 填充，不用 Fabric 默认浅蓝。

选择集**不持久化**（保持现状）：刷新后无选中。

## 4. 键盘映射

已有：`⌘Z` / `⇧⌘Z` / `Ctrl+Y` / `Delete` / `Backspace`。新增：

| 键 | 动作 | 备注 |
|---|---|---|
| `←↑→↓` | 移动 1px（画板坐标） | 有选择集才生效；`preventDefault` 防页面滚动 |
| `⇧ + 方向键` | 移动 10px | |
| `⌘D` | 复制选择集，选中副本 | 偏移 +24/+24 |
| `⌘A` | 全选 | |
| `Esc` | 清空选择 | 注册在 `window` 冒泡阶段，让弹窗先吃掉 |
| `⌘]` / `⌘⇧]` | 上移一层 / 置顶 | |
| `⌘[` / `⌘⇧[` | 下移一层 / 置底 | |
| `⇧0` | 缩放到 100% | 刻意不用 `⌘0/⌘1`：Chrome 切标签页 |
| `⇧1` | 适合画板 | 等价现有按钮 |

统一守卫沿用 `isEditingText()`：输入框/文本域/contentEditable 内的按键全部放过。

**方向键必须合并撤销**：400ms 内无键盘事件或 `keyup` 时提交为一条记录。不合并的话按 8 次要按 8 次撤销。

## 5. 交互规范

### 5.1 拖放导入

- `dragover` 且 `dataTransfer.types` 含 `Files` 才响应；文本拖拽、内部拖拽、弹窗打开、`importGate`/`formLocked` 时静默忽略（不弹 toast）。
- 反馈：画布出现 2px 虚线薄荷绿内框 + 中央"松开添加到画布"，底层 8% 暗化；`dragleave`/`drop` 100ms 淡出。不做逐文件预览。
- 落点：`drop` 的 `clientX/clientY` → 画板坐标，新节点以该点为中心（**不是**视口中心）。
- 防重叠：`findArtboardPlacement`；整块放不进画板才贴到画板外并 `revealBounds`。
- 多文件：串行导入，每个 +24/+24 级联，全部完成后选中所有新节点。
- 失败：逐文件 `imageFileError` 预检，失败只提示该文件，成功照常入画布；末尾汇总"已添加 2 张，1 张失败"。
- 视频文件：明确拒绝，提示"仅支持 PNG/JPG/WebP"。
- 新增 `FreeCanvasStageHandle.getCanvasPoint(clientX, clientY)`（现在只有 `getViewportCenter`）。

### 5.2 复制（`⌘D`）

- 复制节点、共享 `assetId`，`zIndex` = 当前最大值 +1，位置 +24/+24；超出画板时按 `findArtboardPlacement` 就近归位。
- 复制后选择集 = 副本（连按形成级联）。
- 生成中占位框（`type === 'generation'` 且非失败/取消）**不可复制**：按钮禁用 + tooltip"生成中的占位框不能复制"。
- 视频节点可复制。
- 文案只能是"复制"。`⌘D` 与"裂变"在节点操作条里必须视觉分开（复制在左组，裂变在右组，中间有分隔线），否则用户会以为复制不扣积分是 bug。

### 5.3 层级

- 四组快捷键见第 4 节；操作条加 `…` 溢出菜单：上移一层 / 下移一层 / 置顶 / 置底。
- 每次操作后 `zIndex` 重排为 `0..n-1`。
- 多选：整组按选择集的 `max(zIndex)`（上移/置顶）或 `min(zIndex)`（下移/置底）插入，组内相对顺序不变。
- **不做**：`⌥` 点击穿透循环、图层列表（Tier B）。

### 5.4 反馈与动效

| 时机 | 反馈 | 时长 |
|---|---|---|
| 框选 | 薄荷绿选框 + 4% 填充 | 实时 |
| 选择集变化 | 操作条切换为多选态 | 立即，无动画 |
| 方向键移动 | **无动画**（补间会让 1px 位移发飘） | 0 |
| `⌘D` | 副本直接出现并选中 | 0 |
| 层级变化 | 直接重绘 | 0 |
| 拖放悬停 | 虚线内框淡入 | 100ms |
| 全选后有过半节点在视野外 | 底部提示"N 个节点不在当前视野" | 常驻可关 |

## 6. 实现步骤（按此顺序，每步可独立验收）

### 步骤 1：批量命令 `CompositeCommand`

先解决"一次操作 = 一条撤销"的基础设施，后面所有步骤都依赖它。

- 新增 `CompositeCommand implements EditorCommand`：持有一组子命令，`execute` 顺序执行、`undo` **逆序**回滚。
- 序列化：`{ type: 'composite', id, sceneId, commands: SerializedEditorCommand[] }`。
- 同步改 5 处：`deserializeCommand`（递归）、`snapshot.ts` 的 `validateSerializedCommand`（递归校验子命令）、`collectCommandRefs`、`persistableCommand`、`hydrateSerializedCommand`（各递归一层）。
- 多选删除、多选移动、`⌘D` 都复用这个命令，**不需要再新增 `UpdateNodesCommand`**。

### 步骤 2：选择集贯通

- `FreeCanvasStageProps.onSelectNode` → `onSelectNodes(ids: NodeId[])`；`selection: true`。
- Fabric 侧：`selection:created/updated/cleared` 读 `canvas.getActiveObjects()`，映射成 node id 数组后一次性上报（**不要**每个对象上报一次）。
- reactive 同步：选中集变化时，用 `ActiveSelection` 组合对应对象；单个则 `setActiveObject`。
- `pages/FreeCanvas/index.tsx`：`handleSelectNodes`、`handleDelete`（批量，`CompositeCommand(RemoveNodeCommand…)`）、`handleTransformNode`（批量位移用 composite）。
- 守卫：`canDeleteSelected` 改为"选择集里每个节点都可删除"；含生成中占位框时整体禁用 + tooltip 指明原因。

### 步骤 3：拖放导入

见 5.1。验收：拖 2 张本地图，落在鼠标处、互不重叠、全部选中；单张失败不阻断另一张。

### 步骤 4：`⌘D` 复制

见 5.2。

### 步骤 5：方向键微调 + 撤销合并

- `historySlice` 加 `coalesceKey`：同 key 且 400ms 内的连续 `executeCommand` 合并为一条（保留首条的 undo 快照、末条的新状态）。
- 拖动 Fabric 对象时同样要走合并（一次拖拽只产生一条记录）。

### 步骤 6：层级

见 5.3。验收：三张重叠图片，选中中间一层按 `⌘]` 后顺序正确，`zIndex` 仍为 0/1/2。

### 步骤 7：多选态 UI

操作条：`已选 N 项 ｜ 复制 ｜ …（层级） ｜ 删除`，复用现有节点操作条的位置与样式（不要新增浮动层）。

右栏（决策 1a）在 ≥2 项时整块替换为：

- 标题：`已选 3 项`
- 类型分布：`3 张图片` / `2 张图片 · 1 段视频`
- 尺寸范围：`1024×1024 – 1536×1024`
- 若含生成中占位框：一行 warning"含 1 个生成中的占位框，暂不可复制/删除"
- 操作：`复制`（中性）、`删除`（danger）
- 底部提示：`按 Esc 取消选择`
- 生成表单隐藏；单选或无选时恢复现有面板

删除不弹确认框（可撤销）。

### 步骤 8：可访问性接入（与 P1-4 合并做）

- `.sr-only` 节点列表：`<ul aria-label="画布节点">`，每项一个按钮，名称/尺寸/操作可读。
- `Tab` 在节点间移动焦点，焦点节点在画布上画 2px 焦点环；`Enter` 选中、`Space` 播放/暂停视频、`Delete` 删除、方向键微调。
- 顺序按 `zIndex` 升序（与视觉叠放一致）。

## 7. 状态与边界

| 状态 | 行为 |
|---|---|
| 0 节点 | `⌘A` 无效、删除禁用、不显示操作条 |
| 选中 1 个图片 | 现有操作条不变（裂变 / 图生视频 / 删除） |
| 选中 N≥2 | 多选态（第 6 节步骤 7） |
| 含生成中占位框 | 复制/删除整体禁用，tooltip 指明是哪个节点 |
| 节点被拖到画板外 | 允许（现状）；导入/生成的新节点仍强制归位画板内 |
| 缩放 <30% | 操作条不跟随节点，固定到画布右下，避免盖住内容 |
| 100+ 节点 | 选择集变化只同步一次 store；reconcile 保持 O(n) |

## 8. 不做（anti-goals）

- 不做持久化 group/section（生成分组成组属于 P2 血缘设计）
- 不做智能对齐/吸附参考线
- 不抢浏览器保留键：`⌘+` `⌘-` `⌘0` `⌘1`
- 不让 `⌘D` 消耗积分
- 不做批量生成、`⌘C/⌘V`、图层列表、右键菜单、触摸多选（Tier B）

## 9. 测试清单

- `CompositeCommand`：execute 顺序 / undo 逆序 / 序列化往返（`snapshot.test.ts` 已有同类用例可参照）
- 选择集：框选 3 个 → 一次位移 = 一条撤销；删除 3 个 → 一次撤销全部回来
- `⌘D`：复制 2 个 → 副本与原件同 `assetId`、`zIndex` 在最上层、位置 +24；撤销后副本消失
- 方向键：连按 8 次 → 撤销一次回到原位
- 层级：置顶/置底/上移/下移在多选下的组内顺序不变
- 拖放：拒绝视频文件、单文件失败不阻断、落点被占用时自动找空位
- 生成中占位框：不可复制、不可随批量删除
- 键盘：`isEditingText` 内的方向键与 `⌘D` 不触发画布行为

## 10. 粗估

步骤 1（0.5d）→ 2（1d）→ 3（0.5d）→ 4（0.5d）→ 5（0.5d）→ 6（0.5d）→ 7（0.5d）→ 8（与 P1-4 共用 0.5d）。合计约 **4 天**，其中 1 天在 Sequence/批量命令与序列化校验。

## 11. 实现记录（as built，2026-11）

实际落地与上文方案的差异，改动此文件时以此为准：

1. **批量命令只加了一个 `CompositeCommand`**：`src/editor/commands/nodeCommands.ts`，序列化类型 `{ type: 'composite', sceneId, commands[] }`。`snapshot.ts` 的 4 个辅助函数 + `deserializeCommand` 各加一层递归，并给 `validateSerializedCommand` 加了嵌套深度上限 4。多选删除、多选移动、`⌘D`、层级调整全部复用它，没有新增 `UpdateNodesCommand`。
2. **撤销合并没有改 `historySlice`**：`UpdateNodeCommand.execute` 改为"仅在未提供 `previous` 时抓取当前状态"，于是方向键可以边按边直写 `updateNode`，停顿 400ms 后用**起始快照**提交一条命令。副作用是占位框拖动也进命令栈（原来看板里的 P3 不一致一并修掉）。
3. **`⌘D` 用 `offsetPlacementToAvoidOverlap`，不用 `findArtboardPlacement`**：后者在画板放不下时会缩小节点，导致副本尺寸变化。复制一律保持原尺寸，只做 +24 级联避让。
4. **多选框描边在 `selection:created/updated` 里统一上色**：Fabric 的框选是由 canvas 自己创建 ActiveSelection 的，`applySelection` 里的样式对框选不生效，因此抽出 `styleActiveSelection()` 在事件里调用，同时给组内成员兜底同色描边。
5. **快捷键最终值**：`⌘D` 复制、`⌘A` 全选、`Esc` 取消选择（派生面板打开时先关闭面板）、`⌘] / ⌘[`（含 ⇧）层级、`Delete/Backspace` 删除、`⇧0` 100%、`⇧1` 适合画板、方向键 ±1 / ⇧±10。方向键与 `⇧0/⇧1` 只在画布有焦点时生效（`stage` 是可聚焦的 `role="application"`），避免抢走页面滚动。
6. **画布运行时镜像改为 React state**：选中视频的暂停/静音、损坏节点集合、媒体加载错误数都从 ref 镜像到 state。原因不是设计，而是 `react-hooks/refs` 禁止渲染期读 ref；行为不变。
7. **可访问性入口**：`<ul class="free-canvas-node-list">`（视觉隐藏）+ 每节点一个按钮，按 `zIndex` 升序；聚焦时用 `.free-canvas-focus-ring` 在画布上画虚线框并把节点带进视口；Enter/Space 选中、Delete 删除。画布本身 `aria-hidden`，容器承担 `role="application"`。
8. **测试**：`src/editor/commands/composite.test.ts`（执行顺序/逆序回滚/序列化往返/预置 previous）、`src/features/free-canvas/zOrder.test.ts`（四向层级、组内顺序、空洞压缩、无变化返回 undefined）。两处源码契约测试同步到新实现。

已知未做（Tier B，按原计划留下）：`⌘C/⌘V`、`⌥` 点击穿透、图层列表、对齐参考线、右键菜单、批量生成、触摸多选。

## 12. 面板结构（layout 任务，同一页面的后续改动需遵守）

右栏从"单列可滚卡片"改成"滚动参数区 + 常驻操作区"，两个面板（`GenerationPanel` / `DerivedGenerationPanel`）结构一致：

```tsx
<aside className="free-canvas-generation-panel">
  <div className="free-canvas-panel-body">   {/* 唯一滚动容器 */}
    …标题、描述、提示词、比例、数量…
    <details className="free-canvas-advanced"> {/* 模型/分辨率/扩写/视频设置 */} </details>
    …状态说明、任务状态、结果条…
  </div>
  {showForm && <div className="free-canvas-panel-footer">
    <CreditQuoteNotice /> <CreditActionButton data-task-generate /> <CreditSettlementHint /> <CreditBalanceNotice />
  </div>}
</aside>
```

- 新增字段一律放进 `free-canvas-panel-body`；新增"执行/付费"类按钮一律放进 `free-canvas-panel-footer`，否则主按钮会重新被挤出首屏。
- 面板本身 `overflow: hidden`，窄屏（≤720px）下恢复 `overflow: visible` 且操作区不再 sticky，靠整页滚动。
- 状态提示统一走 `CanvasNoticeBar`：默认只露出优先级最高的一条，其余折叠成"还有 N 项提示"。不要再往页面里加整行 `Alert`——那是首屏被吃掉的原因。

实测（headless Chrome，深浅两套主题）：1440×900 生成按钮底边 863px（修复前 1044px，需滚动）；1366×768 为 731px；1440×760 为 723px；画布高度从 562px 增至 706px；两条模型配置告警合并为一行 ~44px。

## 13. 画布配色（colorize 任务）

fabric 画不出 CSS 变量，所以画布配色靠 `src/features/free-canvas/canvasTheme.ts` 把令牌读成值交给 canvas：

| 令牌 | 深色 | 浅色 | 用途 |
|---|---|---|---|
| `--color-canvas` | `#3a3a3e` | `#e5e7eb` | 画布工作区底色 |
| `--color-artboard` | `#f7f7f5` | `#ffffff` | 画板纸面（"成片预览"，不随主题反转） |
| `--color-artboard-stroke` | `#d6d6d2` | `#cbd5e1` | 画板描边 |
| `--color-canvas-accent` | `#0f9973` | `#0a6b52` | 选中框/控制点/框选 |

- `useCanvasPalette()` 监听 `<html data-theme>` 变化，**不刷新页面**就地重绘：画布底色、纸面、选中色立即跟随；占位框（生成中/失败/损坏图）整体重建以换新配色。
- 选中色的取值约束：同时压在纸面（≈`#f7f7f5`）和画布（`#3a3a3e` / `#e5e7eb`）上都要 ≥3:1。实测深色 3.36/3.14，浅色 6.49/5.24。
- **占位框配色不跟随主题**：它们画在纸面上（纸面两套主题都接近白色），保持深底亮字；只有"生成中"的边框固定用亮薄荷绿 `#21cfa0`（它压在自己的深绿底上）。这是整个画布唯一允许的硬编码强调色，有源码契约测试守着。
- 新增 `src/features/free-canvas/canvasTheme.test.ts`：令牌读取、缺失回退、两套主题都定义画板/画布令牌、舞台不再硬编码 `#303035`。

## 14. polish 收口记录

检测器（DOM 叠加，深浅两套主题）从 **8 条 / 8 条** 降到 **0 / 0**。逐条处理：

| 发现 | 处理 |
|---|---|
| 禁用页签文字 1.8:1 | 不再把能力状态塞进禁用页签：页签照常可切，落地后用 `VideoAvailabilityNotice` 说明原因并可重试（禁用页签既读不清，也点不进去看不到为什么） |
| 提示词 placeholder 1.8:1 | `--color-text-secondary` + `opacity: 1` 覆盖 antd 默认灰 |
| 字数统计 2.6:1 | `span.ant-input-data-count` 改 `--color-text-secondary` |
| 比例标签 4.4:1（11px） | 12px + `--color-text-secondary-strong` |
| 高级设置摘要 4.2:1 | 同上 |
| 面板底部提示 2.6:1 | `--color-text-muted` → `--color-text-secondary` |
| 报价区链接 4.1:1（antd 蓝） | 面板内 `.ant-btn-link` 改 `--color-accent-text` |
| 卡片套卡片（`details` 在面板里） | 高级设置去掉边框/底色，改成上下两条分隔线 |
| 未选中页签 4.4:1 | 页签未选中态用 `--color-text-secondary-strong` |

其他顺带修的：

- **操作提示** `11px + opacity .62`（约 2.6:1）→ 12px 实色，仍保留"首次交互后淡出"。
- **手机端视口**：首次挂载在窄屏（≤720px）且画板放不下时，按画板重排；窗口/方向明显变小（>20%）时延迟 140ms 在稳定尺寸上重排。修复"桌面 65% 缩放带到手机上，画板一半在屏外"。窄屏留白从 64px 收到 24px，手机画板占比从 17% 提到 22–25%。
- **触控目标**：手机端工具条 42×44（保持单行），节点操作 36px。
- **默认项目名** `自由画布` → `未命名画布`，面包屑不再出现"自由画布 / 自由画布"。
- **节点操作条** "图生视频 · 加载失败" 的灰字去掉，原因留在 tooltip。
- `CanvasAssetPicker` 缩略图改为 `useMemo` 生成 object URL（不再命令式给 `<img>` 赋 src，也没有空 src 的首帧）。
