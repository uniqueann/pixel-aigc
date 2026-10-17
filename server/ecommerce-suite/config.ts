/** 目标环境完成迁移与真实服务验收后再开放入口。 */
export const ecommerceSuiteEnabled = () => process.env.ECOMMERCE_SUITE_ENABLED === 'true'
export const ecommerceSuiteExportEnabled = () => ecommerceSuiteEnabled() && process.env.ECOMMERCE_SUITE_EXPORT_ENABLED === 'true'
export const ecommerceSuiteDispatchReady = () => ecommerceSuiteEnabled()
  && process.env.ECOMMERCE_SUITE_MAINTENANCE_ENABLED === 'true'
  && process.env.IMAGE_MAINTENANCE_ENABLED === 'true'
  && process.env.IMAGE_BACKGROUND_SUBMIT_ENABLED === 'true'
