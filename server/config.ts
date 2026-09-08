export function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`缺少服务端环境变量 ${name}`)
  return value
}
