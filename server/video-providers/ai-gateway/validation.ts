/** 图生使用原图比例及档位范围；文生继续使用固定比例尺寸，均允许时长编码误差。 */
export function validH3VideoShape(
  measured: { width: number; height: number; durationSeconds: number },
  params: Record<string, unknown>, sourceDimensions: unknown,
) {
  if (![measured.width, measured.height, measured.durationSeconds, Number(params.durationSeconds)].every(value => Number.isFinite(value) && value > 0)
    || Math.abs(measured.durationSeconds - Number(params.durationSeconds)) > .5) return false
  if (!['768p', '2k'].includes(String(params.resolution))) return false
  if (params.mode === 'image_to_video') {
    const source = sourceDimensions as { width?: unknown; height?: unknown } | undefined
    if (!source || typeof source.width !== 'number' || typeof source.height !== 'number'
      || !Number.isFinite(source.width) || !Number.isFinite(source.height) || source.width <= 0 || source.height <= 0) return false
    if (Math.abs((measured.width / measured.height) / (source.width / source.height) - 1) > .04) return false
    const short = Math.min(measured.width, measured.height), long = Math.max(measured.width, measured.height)
    return params.resolution === '768p' ? Math.abs(short - 768) <= 32 : long >= 2016 && long <= 2592 && short >= 992
  }
  const sizes = params.resolution === '2k'
    ? { '1:1': [2048, 2048], '4:3': [2048, 1536], '3:4': [1536, 2048], '16:9': [2560, 1440], '9:16': [1440, 2560] }
    : { '1:1': [768, 768], '4:3': [1024, 768], '3:4': [768, 1024], '16:9': [1366, 768], '9:16': [768, 1366] }
  const expected = sizes[params.ratio as keyof typeof sizes]
  return !!expected && Math.abs(measured.width - expected[0]) <= 2 && Math.abs(measured.height - expected[1]) <= 2
}
