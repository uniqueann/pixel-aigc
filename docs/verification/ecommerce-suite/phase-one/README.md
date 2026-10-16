# 电商套图阶段一证据

基线 `55e6040`，契约版本 1。关联[阶段一契约](../../../ecommerce-suite-phase-one-contract.md)、[故障矩阵](../../../ecommerce-suite-failure-matrix.md)、[数据库设计](../../../ecommerce-suite-database-contract.md)。

| 文件 | 用途 | 证据边界 |
| --- | --- | --- |
| [contract-fixtures.json](contract-fixtures.json) | 项目、资产、报价、版本、草稿、桥接、预检的合法协议样例 | 全部身份、对象键、规格、模型与费用均为合成；没有真实对象或调用 |
| [sample-plan.json](sample-plan.json) | 三子类九个真实商品的采集清单 | 当前收到 0 个，全部待提供；不是九份已验收商品 |
| [local-checks.json](local-checks.json) | 可重复执行的本地结构、模板、文件与归档校验 | 不证明鉴权、RLS、事务、后台调度、供应商或收费通过 |
| [gates.json](gates.json) | 273 个测试文件／1,834 项测试、构建、lint 与合同检查结果 | 记录源码校验值和提示项；只证明本地门槛，真实素材仍为 0／9 |

从仓库根目录运行：

```bash
npm run check:ecommerce-suite:phase-one
npx vitest run shared/ecommerce-suite.test.ts
```

显式更新本地证据报告：

```bash
npm run check:ecommerce-suite:phase-one -- --write-report
```

报告标记 `contractChecksPassed` 与 `realSampleGatePassed`，真实素材未齐时后者为 false；脚本通过仅代表合同基线可校验。阶段二新增实际 HTTP／PostgreSQL 证据后另建阶段目录，不能覆盖本记录伪装成阶段一已经实现服务。

后续每份实际运行记录至少包括：验证编号、Git 提交／工作区基线、环境、实际账号范围的脱敏身份、输入样本 ID、模型／规格、原请求与任务、预扣／结算／退还事实、版本与对象身份、实际下载文件、结果及未覆盖项。公开记录不保存原私有商品图字节、签名地址、密钥或令牌。
