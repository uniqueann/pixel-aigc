# AIGC 电商工作台

电商场景的 AIGC 创作工具，包含邮件助手、图片工作站、工具箱、自由画布四大模块。
架构设计背景见 [`docs/architecture.md`](./docs/architecture.md)。

## 启动

```bash
npm install
npm run dev
```

> 脚手架在无网络环境下生成，依赖尚未安装，本地拉取后即可跑起来。

## 目录结构

```
src/
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

当前是页面骨架 + 类型契约，尚未接入真实后端。后续按 `docs/architecture.md` 第 7 节的清单继续细化各模块交互与后端实现。
