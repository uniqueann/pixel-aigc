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

当前依赖已锁定在 `package-lock.json`，建议使用 Node.js 20 或更高版本。

## 目录结构

```
src/
├── editor/           # 编辑器领域模型、Store、Command、Asset/Generation 服务与适配器
├── features/         # 跨页面业务能力，包含图片工作站 Controller 与 FreeCanvas Fabric 渲染器
├── layouts/          # 主布局（可折叠侧边导航 + 面包屑 + 内容区）
├── router/           # 路由配置（含嵌套路由）+ meta.ts（面包屑/标题用的路径-标签映射）
├── components/        # 通用组件：EmptyState、ErrorBoundary
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
- 图片工作站的蒙版涂抹、橡皮擦、局部撤销/重做、智能选区 mock、重绘描述、扩图边界和平台预设。
- `PixelProject / PixelDocument / Scene / Asset / EditorNode / GenerationJob` 领域契约。
- Editor Store、节点 Command History、Generation Lineage selectors 及核心单元测试。
- `GenerationTask → GenerationJob → Asset` 适配链路，以及图片工作站 Controller、工具注册表和请求构建器。
- 生成结果注册为 Asset，并可作为下一次图片编辑任务的输入继续生成。
- FreeCanvas 空间画布、ImageNode 渲染与单选变换、缩放平移、快捷键和 Command History 接入。

当前待补充：

- 自由画布的实际生成、VideoNode、Variation/Image-to-Video 和生成结果自动入画布。
- 图片工作站当前使用内置示例图片，真实文件上传和对象存储直传尚未接入。
- 智能选区仍使用前端 mock；真实 AI Provider、登录鉴权、任务队列、限流和积分结算需要后端支持。
- Project JSON 保存恢复、自动保存和远端项目持久化尚未实现。

提交前运行：

```bash
npm test
npm run build
npm run lint
```
