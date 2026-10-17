# 阶段二本地验收记录

实现基线：`8a5971b`，2026-10-17。功能与启用顺序见[阶段二说明](../../../ecommerce-suite-phase-two.md)。

| 层次 | 证据 | 能证明的范围 |
| --- | --- | --- |
| 本地检查 | [gates.json](gates.json) | 当前源码测试、类型、构建、lint、合同与文档链接校验 |
| 独立 PostgreSQL | [postgres.json](postgres.json) | 本机空白 PostgreSQL 18.4、实际 `aigc_api` 角色、迁移、RLS、费用预扣／结算、并发结果幂等及原任务保留；图片供应商与对象存储为测试替身 |
| 数据库 advisors | [advisors.json](advisors.json) | 本机独立库检查，新增套图实体无告警；其他既有对象的结果单独保留，不代表生产数据库检查 |
| 浏览器 | [browser.json](browser.json) | 页面组件使用合成 HTTP 数据验证向导、确认费用、候选选用、刷新不重提、深浅主题和窄屏；不证明真实登录、R2 或供应商可用 |

截图中的沙发是本地绘制的合成测试图，商品名称、模型、身份与费用均为测试数据，不能计入九个真实商品样本。

- [宽屏浅色](workspace-light-1440.png)、[宽屏深色](workspace-dark-1440.png)
- [900px 正常文档流](workspace-900.png)、[390px 预览](workspace-390.png)、[390px 操作区](workspace-390-bottom.png)

当前真实样本仍为 **0/9**；目标环境数据库迁移、R2 实体上传与签名恢复、真实供应商和实际用户账本均未执行。`ECOMMERCE_SUITE_ENABLED` 默认关闭，完成目标环境验证后才可启用。本阶段没有整套维护器，不承诺整套关页继续派发。

EC-R01～05、R16～18 的相关路径已有本地覆盖；EC-R06／08 的单槽位子集验证不能替代第三阶段的整套并发与调度验收。恢复 ZIP 目前可导出，导入与完整图层恢复仍在第四阶段。
