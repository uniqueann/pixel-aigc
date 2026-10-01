/** 下载文件名里的日期用用户本地日历日，避免 toISOString 在 UTC 跨日。 */
export function localDateStamp(now = new Date()) {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function datedDownloadName(prefix: string, now = new Date()) {
  return `${prefix}_${localDateStamp(now)}`
}
