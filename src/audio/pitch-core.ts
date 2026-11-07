import { SimpleFilter, SoundTouch } from 'soundtouchjs'

/**
 * 템포는 그대로 두고 음높이만 semitones(반음) 만큼 바꾼다.
 * 입력과 같은 길이의 채널 데이터를 돌려준다.
 */
export function shiftPitch(left: Float32Array, right: Float32Array, semitones: number, onProgress?: (p: number) => void) {
  const len = left.length
  const st = new SoundTouch()
  st.pitchSemitones = semitones
  // 끝부분이 처리 파이프라인에 남아 잘리지 않도록 뒤에 무음을 덧붙여 읽게 한다
  const padded = len + 44100
  const source = {
    extract(target: Float32Array, numFrames: number, position: number) {
      const n = Math.max(0, Math.min(numFrames, padded - position))
      for (let i = 0; i < n; i++) {
        const k = position + i
        target[i * 2] = k < len ? left[k] : 0
        target[i * 2 + 1] = k < len ? right[k] : 0
      }
      return n
    },
  }
  const filter = new SimpleFilter(source, st)
  const outL = new Float32Array(len)
  const outR = new Float32Array(len)
  const chunk = 8192
  const buf = new Float32Array(chunk * 2)
  let written = 0
  let lastReport = 0
  while (written < len) {
    const n = filter.extract(buf, chunk)
    if (n === 0) break
    const take = Math.min(n, len - written)
    for (let i = 0; i < take; i++) {
      outL[written + i] = buf[i * 2]
      outR[written + i] = buf[i * 2 + 1]
    }
    written += take
    if (onProgress && written - lastReport > 44100 * 5) {
      lastReport = written
      onProgress(written / len)
    }
  }
  return { left: outL, right: outR }
}
