# AIGC 电商工作台

电商场景的 AIGC 创作工具，包含邮件助手、图片工作站、工具箱、自由画布四大模块。
架构设计背景见 [`docs/architecture.md`](./docs/architecture.md)，图片工作站画布方案见
[`docs/canvas-interaction-plan.md`](./docs/canvas-interaction-plan.md)，统一编辑器领域架构见
[`docs/pixel-editor-architecture-v1.md`](./docs/pixel-editor-architecture-v1.md)，Stage 3 实施边界见
[`docs/stage3-editor-architecture-plan.md`](./docs/stage3-editor-architecture-plan.md)。

## 启动

```bash
npm install
npm run dev
```

当前依赖已锁定在 `package-lock.json`，请使用 Node.js 24。

## 目录结构

```
src/
├── editor/           # 编辑器领域模型、Store、Command、Asset/Generation 服务与适配器
├── features/         # 跨页面业务能力，包含图片工作站 Controller 与 FreeCanvas Fabric 渲染器
├── layouts/          # 主布局（可折叠侧边导航 + 面包屑 + 内容区）
├── router/           # 路由配置（含嵌套路由）+ meta.ts（面包屑/标题用的路径-标签映射）
├── components/        # 通用组件：空状态、错误边界、生成任务状态
├── pages/
│   ├── Dashboard/         # 工作台首页
│   ├── EmailAssistant/    # 邮件助手
│   ├── ImageWorkstation/  # 图片工作站（三栏布局，子工具为独立路由 /image-workstation/:tool）
│   ├── Toolbox/           # 工具箱（子工具为独立路由 /toolbox/:tool，抠图/水印/转比例，批量处理）
│   ├── FreeCanvas/        # 自由画布（子模式为独立路由 /canvas/:mode，文生图/文生视频）
│   └── Assets/            # 我的资产
├── store/            # zustand：任务状态、用户/积分状态
├── services/
│   ├── api/          # 与后端交互的接口封装（axios）
│   └── providers/    # 与后端 Provider 抽象层对齐的类型
├── hooks/            # useTaskPolling（含任务完成/失败的全局通知）等业务 hook
├── types/            # 全局类型（Capability 枚举等）
├── constants/        # 电商平台尺寸字典等配置数据
└── styles/           # 全局样式与设计 token（暗色主题）
```

## 已完成 / 待补充

当前已完成：

- 页面框架、嵌套路由、可折叠导航和账号设置弹层。
- 个性化支持工作台默认入口、资产布局、图片默认数量与分辨率、工具参数记忆、邮件默认选项；登录后按账号和环境同步，离线修改可重试，未登录保存在本机。详见[个性化说明](docs/personalization.md)。
- 图片工作站的蒙版涂抹、橡皮擦、局部撤销/重做、智能选区 mock、重绘描述、扩图边界和平台预设。
- `PixelProject / PixelDocument / Scene / Asset / EditorNode / GenerationJob` 领域契约。
- Editor Store、节点 Command History、Generation Lineage selectors 及核心单元测试。
- `GenerationTask → GenerationJob → Asset` 适配链路，以及图片工作站 Controller、工具注册表和请求构建器。
- 智能编辑支持上传图片、编辑提示词、1–4 个候选结果及基于候选继续生成。
- 邮件助手支持总结、回复、润色、语法检查；登录用户可在设置中加密保存自己的 DeepSeek API Key，选择模型，查看最近 7 天任务并恢复修改稿。
- FreeCanvas 空间画布、ImageNode/VideoNode 编辑、文生图/文生视频占位与结果入画布、节点裂变、图生视频、Generation Lineage、视频播放控制及 Command History。
- 自由画布支持逐张上传本地图片、从我的资产添加，并复用图片任务服务进行真实裂变；可选择模型、数量和分辨率，显示预计积分，部分成功按原始序号落位。真实失败仅手动重试，刷新续接原任务。交付与验收说明见 [自由画布真实裂变](./docs/freecanvas-real-variation.md)。
- 自由画布文生图已接通真实图片任务：无需原图，可选择模型、五种比例、数量和分辨率，并查看积分预估；结果进入画布和我的资产，支持刷新续接、手动重试与草稿恢复。详见 [自由画布真实文生图](./docs/freecanvas-real-text-to-image.md)。
- 当前项目通过 IndexedDB 自动保存，支持刷新恢复、版本化 Project JSON 导入导出、生成任务续接和多标签页编辑保护。
- Mock Gateway 可完整演示文生图、文生视频、图片裂变、图生视频、智能编辑和邮件助手异步任务流程。
- 工具箱加水印、转比例（留白、智能裁剪、本机模板）和智能抠图（三种背景、边缘精修）已可用。四项腾讯云配置齐全时，抠图走数据万象 GoodsMatting，智能裁剪走图像主体检测。
- 图片工作站的智能编辑、裂变、精修、融合和重新打光走 `image_jobs`；按实际分辨率预扣积分，并按截止前成功张数结算。消除、重绘、扩图、抠图、智能选区和主体检测走独立接口，使用服务端限流。
- 登录账号按运行环境独立维护积分余额与流水，首次进入赠送 30 分；头部显示余额，点击可查看积分明细。管理员可用 `npm run aigc:credits` 补发或调整余额。
- 「我的资产」本地图片历史按登录账号分别保存；旧版没有账号标识的本地记录保留在原 IndexedDB 中，不会显示给任一账号。当前账号已完成的云端图片任务会自动补记。匿名 Mock 模式使用独立分区。

当前待补充：

- 自由画布的文生视频和图生视频仍以 Mock 流程演示；转比例再到加水印还没有流水线入口。
- 云端项目仅保存图片、布局与表单草稿，完整生成历史和血缘通过本地存档及 JSON 保留；云端完整生成历史与跨账号协作尚未实现。

## 积分与同步接口限流

图片任务每张按供应商实际分辨率扣分：1K 为 2 分、2K 为 3 分、4K 为 5 分。提交时预扣全部请求张数，成功后只保留成功张数的费用；失败和超时退款，超时后交付的结果免费。积分账户按 `local`、`preview`、`production` 分开。登录后点击头部「积分 {n}」可查看本人流水。

管理补发、把余额设为 0（测 402）以及恢复示例：

```bash
AIGC_ADMIN_OPERATOR=管理员 npm run aigc:credits -- 用户UUID production 100 补发单号 补发原因
AIGC_ADMIN_OPERATOR=管理员 npm run aigc:credits -- --set 0 用户UUID production set-zero-1 测试余额不足
AIGC_ADMIN_OPERATOR=管理员 npm run aigc:credits -- --set 100 用户UUID production restore-100-1 恢复测试余额
AIGC_ADMIN_OPERATOR=管理员 npm run aigc:credits -- --amount -20 用户UUID production deduct-20-1 压低余额
```

`--set` / `--amount` 走 `aigc.adjust_credits`，写入 `adjust` 流水，余额不会低于 0；同一幂等键重复执行不会再改余额。查看用法：`npm run aigc:credits -- --help`。

消除、重绘和扩图共用每人每小时 20 次、同时 2 次的服务端额度；抠图、智能选区和主体检测共用每人每小时 60 次、同时 3 次的额度。超额返回 429。

提交前运行：

```bash
npm test
npm run build
npm run lint
```

GitHub Actions 在拉取请求和 `main` 推送时用 Node 24 执行同一套检查；lint 不允许警告。

## 后端与云同步

认证、`aigc` schema、R2 和 Vercel 配置见 [后端基础设施说明](docs/backend-foundation.md)。默认保留本地模式；外部配置完成后启用 `VITE_CLOUD_MODE=enabled`。

Google 授权页的应用名称、Logo、公开政策与后续自定义 Auth 域名方案见 [Auth 域名与 Google 品牌配置](docs/auth-domain-branding.md)。
