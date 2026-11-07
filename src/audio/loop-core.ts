/**
 * 인트로 늘리기: 구간 반복으로 앞부분을 원하는 길이만큼 늘린다.
 * AudioBuffer 없이 Float32Array 채널 데이터만으로 동작 (테스트하기 쉽도록).
 */

const mixDown = (chs: Float32Array[], from: number, to: number) => {
  const out = new Float32Array(Math.max(0, to - from))
  for (const ch of chs) for (let i = from; i < to; i++) out[i - from] += ch[i] / chs.length
  return out
}

/** 곡의 빠르기(BPM)를 추정. 소리가 세지는 순간(온셋)의 반복 간격을 찾는다. */
export function detectBpm(chs: Float32Array[], sr: number, fromSec: number, toSec: number): number {
  const from = Math.max(0, Math.floor(fromSec * sr))
  const to = Math.min(chs[0].length, Math.floor(Math.min(toSec, fromSec + 90) * sr))
  const mono = mixDown(chs, from, to)
  const hop = 512
  const frames = Math.floor(mono.length / hop)
  if (frames < 64) return 120
  const env = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let e = 0
    for (let i = f * hop; i < (f + 1) * hop; i++) e += mono[i] * mono[i]
    env[f] = Math.log(1e-9 + e)
  }
  const onset = new Float32Array(frames)
  let mean = 0
  for (let f = 1; f < frames; f++) {
    onset[f] = Math.max(0, env[f] - env[f - 1])
    mean += onset[f]
  }
  mean /= frames
  for (let f = 0; f < frames; f++) onset[f] -= mean

  const fps = sr / hop
  const lagMin = Math.floor((fps * 60) / 200)
  const lagMax = Math.ceil((fps * 60) / 55)
  const ac = (lag: number) => {
    let r = 0
    for (let f = 0; f + lag < frames; f++) r += onset[f] * onset[f + lag]
    return r / (frames - lag)
  }
  let best = 0
  let bestScore = -Infinity
  const scores: number[] = []
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const bpm = (60 * fps) / lag
    // 사람이 느끼는 빠르기(약 120 BPM 근처)를 조금 더 선호
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.6) ** 2)
    const s = (ac(lag) + 0.5 * ac(lag * 2)) * prior
    scores[lag] = s
    if (s > bestScore) {
      bestScore = s
      best = lag
    }
  }
  // 포물선 보간으로 소수점 단위까지
  const a = scores[best - 1] ?? bestScore
  const c = scores[best + 1] ?? bestScore
  const denom = a - 2 * bestScore + c
  const lag = best + (denom !== 0 ? (0.5 * (a - c)) / denom : 0)
  return Math.round(((60 * fps) / lag) * 10) / 10
}

/** 온셋(소리가 세지는 정도) 곡선 */
function onsetEnvelope(chs: Float32Array[], from: number, to: number, hop: number) {
  const mono = mixDown(chs, from, to)
  const frames = Math.floor(mono.length / hop)
  const env = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let e = 0
    for (let i = f * hop; i < (f + 1) * hop; i++) e += mono[i] * mono[i]
    env[f] = Math.log(1e-9 + e)
  }
  const onset = new Float32Array(frames)
  for (let f = 1; f < frames; f++) onset[f] = Math.max(0, env[f] - env[f - 1])
  return onset
}

export interface BeatGrid {
  bpm: number
  /** 박이 떨어지는 기준 시각(초). 이 시각 + k × (60/bpm) 마다 박이 있다 */
  phase: number
}

/** 대략의 BPM을 ±2% 안에서 정밀하게 다듬고, 박이 떨어지는 위치까지 찾는다 */
export function beatGrid(chs: Float32Array[], sr: number, fromSec: number, toSec: number, roughBpm: number): BeatGrid {
  const from = Math.max(0, Math.floor(fromSec * sr))
  const to = Math.min(chs[0].length, Math.floor(Math.min(toSec, fromSec + 90) * sr))
  const hop = 128
  const onset = onsetEnvelope(chs, from, to, hop)
  const fps = sr / hop
  let best = { bpm: roughBpm, phase: fromSec, score: -Infinity }
  for (let bpm = roughBpm * 0.98; bpm <= roughBpm * 1.02; bpm += 0.02) {
    const P = (60 / bpm) * fps
    for (let p = 0; p < P; p++) {
      let sc = 0
      for (let k = p; k < onset.length; k += P) sc += onset[Math.round(k)] ?? 0
      if (sc > best.score) best = { bpm, phase: fromSec + p / fps, score: sc }
    }
  }
  return { bpm: Math.round(best.bpm * 100) / 100, phase: best.phase }
}

/**
 * 사람이 대충 정한 반복 구간을 박자에 맞춘다.
 * - 끝(보통 노래가 터지는 지점 = 마디의 첫 박)을 가장 가까운 박으로
 * - 시작은 끝에서 마디(4박) 단위로 거꾸로 세어서 → 진짜 마디 경계에 맞춰진다
 * - 끝은 이음새 소리가 가장 닮은 지점으로 ±25ms 미세 조정
 */
export function snapLoop(chs: Float32Array[], sr: number, grid: BeatGrid, userStart: number, userEnd: number, minStart: number) {
  const beat = 60 / grid.bpm
  const bar = beat * 4
  const end = grid.phase + Math.round((userEnd - grid.phase) / beat) * beat
  let bars = Math.max(1, Math.round((end - userStart) / bar))
  while (bars > 1 && end - bars * bar < minStart - 1e-6) bars -= 1
  const start = Math.max(minStart, end - bars * bar)
  return { start, end: refineLoopEnd(chs, sr, start, end), bars }
}

/**
 * 반복 구간 끝을 ±searchSec 안에서 미세 조정.
 * "구간 시작 직전의 소리"와 "구간 끝 직전의 소리"가 가장 닮은 지점을 고른다.
 * (이음새에서 구간 끝 직전 소리 → 구간 시작으로 넘어가므로)
 */
export function refineLoopEnd(chs: Float32Array[], sr: number, startSec: number, endSec: number, searchSec = 0.025): number {
  const ds = 4
  const s = Math.floor(startSec * sr)
  const e = Math.floor(endSec * sr)
  const D = Math.floor((searchSec * sr) / ds)
  const W = Math.min(Math.floor((0.5 * sr) / ds), Math.floor(s / ds) - 1, Math.floor((e - s) / ds / 2) - D)
  if (W < 256) return endSec
  const get = (i: number) => {
    let v = 0
    for (const ch of chs) v += ch[i] ?? 0
    return v
  }
  const a = new Float32Array(W)
  for (let i = 0; i < W; i++) a[i] = get(s - (W - i) * ds)
  let best = 0
  let bestScore = -Infinity
  for (let d = -D; d <= D; d++) {
    let num = 0
    let nb = 0
    for (let i = 0; i < W; i++) {
      const b = get(e + (d - (W - i)) * ds)
      num += a[i] * b
      nb += b * b
    }
    const score = nb > 0 ? num / Math.sqrt(nb) : -Infinity
    if (score > bestScore) {
      bestScore = score
      best = d
    }
  }
  return (e + best * ds) / sr
}

/** 원하는 인트로 길이를 맞추려면 반복 구간을 몇 번 재생해야 하는지 */
export function planIntro(clipStart: number, loopStart: number, loopEnd: number, target: number) {
  const before = loopStart - clipStart
  const loopLen = loopEnd - loopStart
  const repeats = Math.max(1, Math.round((target - before) / loopLen))
  return { repeats, introLen: before + repeats * loopLen }
}

/**
 * [clipStart, clipEnd] 구간을 잘라 반복 구간을 repeats번 재생하도록 늘린 채널 데이터.
 * 이음새는 짧게 겹쳐서(raised-cosine) 끊김 없이 이어 붙인다.
 */
export function extendIntro(
  chs: Float32Array[],
  sr: number,
  clipStart: number,
  clipEnd: number,
  loopStart: number,
  loopEnd: number,
  repeats: number,
  xfSec = 0.05,
): Float32Array[] {
  const len = chs[0].length
  const s0 = Math.round(clipStart * sr)
  const ls = Math.round(loopStart * sr)
  const le = Math.round(loopEnd * sr)
  const e0 = Math.min(len, Math.round(clipEnd * sr))
  const L = le - ls
  // 이음새는 구간 끝 "직전"에서 겹친다: 구간 뒤(본곡)의 소리가 섞여 들어오지 않도록
  const X = Math.max(0, Math.min(Math.round(xfSec * sr), Math.floor(L / 4), ls - s0, ls))
  const micro = Math.min(Math.round(0.004 * sr), Math.floor(L / 4))
  const outLen = le - s0 + (repeats - 1) * L + (e0 - le)
  return chs.map((src) => {
    const out = new Float32Array(outLen)
    let o = 0
    out.set(src.subarray(s0, le), o)
    o += le - s0
    for (let r = 1; r < repeats; r++) {
      if (X >= 32) {
        // 구간 끝 직전 소리는 줄이고, 구간 시작 직전 소리는 키워서 자연스럽게 이어 붙인다
        for (let t = 0; t < X; t++) {
          const g = 0.5 - 0.5 * Math.cos((Math.PI * t) / X)
          out[o - X + t] = src[le - X + t] * (1 - g) + src[ls - X + t] * g
        }
      } else {
        // 구간이 곡 맨 앞에서 시작하면 겹칠 소리가 없으니 아주 짧게 줄였다 키운다
        for (let t = 0; t < micro; t++) out[o - micro + t] *= 1 - t / micro
      }
      out.set(src.subarray(ls, le), o)
      if (X < 32) for (let t = 0; t < micro; t++) out[o + t] *= t / micro
      o += L
    }
    out.set(src.subarray(le, e0), o)
    return out
  })
}

/**
 * 노래가 "터지는" 지점 찾기: 직후 몇 초가 직전 몇 초보다 확 커지는 순간.
 * 뚜렷한 지점이 없으면 null.
 */
export function detectDrop(chs: Float32Array[], sr: number, fromSec: number, toSec: number): number | null {
  const from = Math.max(0, Math.floor(fromSec * sr))
  const to = Math.min(chs[0].length, Math.floor(toSec * sr))
  const hop = Math.floor(sr * 0.1)
  const n = Math.floor((to - from) / hop)
  if (n < 60) return null
  const rms = new Float32Array(n)
  let max = 0
  for (let f = 0; f < n; f++) {
    let e = 0
    for (const ch of chs) for (let i = from + f * hop; i < from + (f + 1) * hop; i++) e += ch[i] * ch[i]
    rms[f] = Math.sqrt(e / (hop * chs.length))
    max = Math.max(max, rms[f])
  }
  const W = 30 // 앞뒤 3초씩 비교
  const limit = Math.min(n - W, Math.floor(n * 0.7))
  let best = -1
  let bestScore = 0
  for (let f = W; f < limit; f++) {
    let before = 0
    let after = 0
    for (let k = 1; k <= W; k++) {
      before += rms[f - k]
      after += rms[f + k - 1]
    }
    if (after / W < max * 0.3) continue
    const score = after / (before + 1e-6)
    if (score > bestScore) {
      bestScore = score
      best = f
    }
  }
  return best >= 0 && bestScore >= 1.6 ? fromSec + (best * hop) / sr : null
}
