import type { Clip, Source } from '../types'

export const SAMPLE_RATE = 44100
export const DROP_PAUSE = 0.25
export const MIN_START_VOLUME = 0.05
/** 자동화 이벤트끼리 겹치지 않게 두는 여유 */
const EPS = 0.002

export interface Placed {
  clip: Clip
  source: Source
  /** 결과물 타임라인에서의 시작 시각 */
  at: number
  dur: number
  /** 앞/뒤 클립과 겹치는 길이 */
  xIn: number
  xOut: number
}

export const clipDuration = (c: Clip) => Math.max(0, c.end - c.start)

/** 클립을 타임라인에 배치. 크로스페이드만큼 앞 클립과 겹친다. */
export function layout(clips: Clip[], sources: Map<string, Source>) {
  const placed: Placed[] = []
  let t = 0
  for (const clip of clips) {
    const source = sources.get(clip.sourceId)
    if (!source) continue
    const dur = clipDuration(clip)
    if (dur <= 0) continue
    const prev = placed[placed.length - 1]
    const xIn = prev ? Math.max(0, Math.min(clip.crossfade, dur / 2, prev.dur / 2)) : 0
    if (prev) prev.xOut = xIn
    const at = Math.max(0, t - xIn)
    placed.push({ clip, source, at, dur, xIn, xOut: 0 })
    t = at + dur
  }
  return { placed, total: t }
}

/** 등전력(equal-power) 곡선: 크로스페이드 구간에서 볼륨이 꺼지지 않게 해준다. */
function curve(fadeIn: boolean, n = 256) {
  const c = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const p = i / (n - 1)
    c[i] = fadeIn ? Math.sin((p * Math.PI) / 2) : Math.cos((p * Math.PI) / 2)
  }
  return c
}

/** 클라이맥스 직전까지 도달하는 볼륨. 여기서 100%로 한 번에 뛰어서 '팡' 하는 느낌이 난다. */
export const PRE_DROP_VOLUME = 0.65

/** 시작 볼륨에서 PRE_DROP_VOLUME까지 dB 기준으로 일정하게 커지는 곡선 (자연스러운 크레센도) */
function crescendo(from: number, n = 256) {
  const c = new Float32Array(n)
  const f = Math.max(MIN_START_VOLUME, Math.min(1, from))
  const to = Math.max(f, PRE_DROP_VOLUME)
  for (let i = 0; i < n; i++) c[i] = f * Math.pow(to / f, i / (n - 1))
  return c
}

function schedule(ctx: BaseAudioContext, p: Placed, out: AudioNode) {
  const { clip, at, dur } = p
  const src = ctx.createBufferSource()
  src.buffer = p.source.buffer

  let node: AudioNode = src
  const bu = clip.buildUp
  const climax = Math.max(0.5, Math.min(bu.climaxAt, dur))

  if (bu.enabled && bu.muffle) {
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.Q.value = 0.7
    if (bu.mode === 'hold') {
      // 클라이맥스 전까지 먹먹한 소리를 유지하다가 한 번에 선명하게
      lp.frequency.setValueAtTime(700, at)
      lp.frequency.setValueAtTime(20000, at + climax)
    } else {
      lp.frequency.setValueAtTime(500, at)
      lp.frequency.exponentialRampToValueAtTime(20000, at + climax)
    }
    node.connect(lp)
    node = lp
  }
  if (bu.enabled && bu.bassBoost) {
    const ls = ctx.createBiquadFilter()
    ls.type = 'lowshelf'
    ls.frequency.value = 150
    ls.gain.setValueAtTime(0, at)
    ls.gain.setValueAtTime(6, at + climax)
    node.connect(ls)
    node = ls
  }
  if (bu.enabled) {
    const g = ctx.createGain()
    const pause = bu.pauseBeforeDrop && climax > DROP_PAUSE * 3 ? DROP_PAUSE : 0
    if (bu.mode === 'hold') g.gain.setValueAtTime(Math.max(MIN_START_VOLUME, Math.min(1, bu.startVolume)), at)
    else g.gain.setValueCurveAtTime(crescendo(bu.startVolume), at, climax - pause)
    if (pause) g.gain.setValueAtTime(0, at + climax - pause + EPS)
    g.gain.setValueAtTime(1, at + climax + EPS)
    node.connect(g)
    node = g
  }

  // 페이드 인/아웃 + 크로스페이드
  const fade = ctx.createGain()
  let fin = Math.max(clip.fadeIn, p.xIn)
  let fout = Math.max(clip.fadeOut, p.xOut)
  if (fin + fout > dur - EPS * 2) {
    const k = (dur - EPS * 2) / (fin + fout)
    fin *= k
    fout *= k
  }
  if (fin > 0.001) fade.gain.setValueCurveAtTime(curve(true), at, fin)
  if (fout > 0.001) fade.gain.setValueCurveAtTime(curve(false), at + dur - fout, fout)
  node.connect(fade)

  const vol = ctx.createGain()
  vol.gain.value = clip.gain
  fade.connect(vol)
  vol.connect(out)

  src.start(at, clip.start, dur)
}

/** 모든 클립을 하나의 오디오로 합친다. */
export async function renderMix(clips: Clip[], sources: Map<string, Source>): Promise<AudioBuffer | null> {
  const { placed, total } = layout(clips, sources)
  if (!placed.length || total <= 0) return null
  const ctx = new OfflineAudioContext(2, Math.ceil(total * SAMPLE_RATE), SAMPLE_RATE)
  // 볼륨을 올리거나 저음을 키웠을 때 소리가 깨지지 않도록 하는 안전 리미터
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -1
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.003
  limiter.release.value = 0.1
  limiter.connect(ctx.destination)
  for (const p of placed) schedule(ctx, p, limiter)
  return ctx.startRendering()
}
