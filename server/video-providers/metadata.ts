import { createFile, type Movie } from 'mp4box'
import { VideoProviderError } from './types.js'

/** 只解析元数据，不提取样本，也不启动转码进程。 */
export function probeVideo(bytes: Uint8Array) {
  if (bytes.length < 12 || Buffer.from(bytes.subarray(4, 8)).toString() !== 'ftyp') {
    throw new VideoProviderError('VIDEO_RESULT_INVALID', '视频结果不是有效的 MP4 文件')
  }
  // 解析器可能在读到 moov 后提前就绪，因此另行验证每个顶层 box 均完整落盘。
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 0
  let hasMediaData = false
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) throw new VideoProviderError('VIDEO_RESULT_INVALID', '视频文件被截断，积分将退回')
    let size = view.getUint32(offset)
    let headerSize = 8
    if (size === 1) {
      if (offset + 16 > bytes.byteLength) throw new VideoProviderError('VIDEO_RESULT_INVALID', '视频文件被截断，积分将退回')
      size = Number(view.getBigUint64(offset + 8)); headerSize = 16
    } else if (size === 0) size = bytes.byteLength - offset
    if (!Number.isSafeInteger(size) || size < headerSize || offset + size > bytes.byteLength) throw new VideoProviderError('VIDEO_RESULT_INVALID', '视频文件不完整，积分将退回')
    if (Buffer.from(bytes.subarray(offset + 4, offset + 8)).toString() === 'mdat') hasMediaData = true
    offset += size
  }
  let movie: Movie | undefined
  let invalid = false
  const file = createFile(false)
  file.onReady = info => { movie = info }
  file.onError = () => { invalid = true }
  const buffer = Object.assign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { fileStart: 0 })
  try { file.appendBuffer(buffer); file.flush() }
  catch { invalid = true }
  const info = movie as Movie | undefined
  const track = info?.videoTracks[0]
  const audio = info?.audioTracks[0]
  const durationSeconds = track ? track.duration / track.timescale : 0
  const width = track?.video?.width ?? 0
  const height = track?.video?.height ?? 0
  if (invalid || !hasMediaData || !info?.hasMoov || !track || !width || !height || !Number.isFinite(durationSeconds)
    || durationSeconds <= 0 || durationSeconds > 20 || !/^avc[13]\./.test(track.codec)
    || (audio && !/^mp4a\.40\./.test(audio.codec))) {
    throw new VideoProviderError('VIDEO_RESULT_INVALID', '视频文件不完整或编码暂不支持，积分将退回')
  }
  return { width, height, durationSeconds, sizeBytes: bytes.byteLength, hasAudio: !!audio, videoCodec: track.codec, audioCodec: audio?.codec }
}
