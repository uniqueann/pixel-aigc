/** 目标环境完成迁移与真实服务验收后再开放入口。 */
export const ecommerceSuiteEnabled = () => process.env.ECOMMERCE_SUITE_ENABLED === 'true'
