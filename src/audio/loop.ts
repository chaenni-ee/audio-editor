import type { Source } from '../types'
import { beatGrid, detectBpm, detectDrop, extendIntro, snapLoop, type BeatGrid } from './loop-core'

export { planIntro, type BeatGrid } from './loop-core'

const channelsOf = (b: AudioBuffer) => Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i))

/** 곡의 빠르기와 박 위치 (같은 구간은 다시 계산하지 않음) */
const gridCache = new Map<string, BeatGrid>()
export function analyzeTempo(source: Source, from: number, to: number): BeatGrid {
  const key = `${source.id}:${from.toFixed(2)}:${to.toFixed(2)}`
  let g = gridCache.get(key)
  if (!g) {
    const chs = channelsOf(source.buffer)
    const sr = source.buffer.sampleRate
    g = beatGrid(chs, sr, from, to, detectBpm(chs, sr, from, to))
    gridCache.set(key, g)
  }
  return g
}

/** 노래가 터지는 지점 (없으면 null) */
export function findDrop(source: Source, from: number, to: number) {
  return detectDrop(channelsOf(source.buffer), source.buffer.sampleRate, from, to)
}

/** 대충 고른 반복 구간을 마디에 맞춰 정확히 */
export function snapSelection(source: Source, grid: BeatGrid, start: number, end: number, minStart: number) {
  return snapLoop(channelsOf(source.buffer), source.buffer.sampleRate, grid, start, end, minStart)
}

/** 반복 구간을 repeats번 재생하도록 인트로를 늘린 새 오디오 */
export function buildExtended(source: Source, clipStart: number, clipEnd: number, loopStart: number, loopEnd: number, repeats: number): AudioBuffer {
  const b = source.buffer
  const out = extendIntro(channelsOf(b), b.sampleRate, clipStart, clipEnd, loopStart, loopEnd, repeats)
  const buf = new AudioBuffer({ length: out[0].length, numberOfChannels: out.length, sampleRate: b.sampleRate })
  out.forEach((ch, i) => buf.copyToChannel(ch, i))
  return buf
}
