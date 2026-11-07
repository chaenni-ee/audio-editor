import { shiftPitch } from './pitch-core'

self.onmessage = (e: MessageEvent<{ left: Float32Array; right: Float32Array; semitones: number }>) => {
  const { left, right, semitones } = e.data
  const out = shiftPitch(left, right, semitones, (progress) => self.postMessage({ progress }))
  self.postMessage({ done: true, left: out.left, right: out.right }, { transfer: [out.left.buffer, out.right.buffer] })
}
