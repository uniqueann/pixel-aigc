export function relativeTime(value: string) {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000)
  return seconds < 60
    ? '刚刚'
    : seconds < 3600
      ? `${Math.floor(seconds / 60)} 分钟前`
      : seconds < 86400
        ? `${Math.floor(seconds / 3600)} 小时前`
        : `${Math.floor(seconds / 86400)} 天前`
}
