import type { Source } from '../types'

/** 키를 바꾼 오디오는 다시 계산하지 않도록 보관 (메모리를 위해 최근 6개만) */
const cache = new Map<string, Promise<AudioBuffer>>()
const MAX_CACHE = 6

function run(buf: AudioBuffer, semitones: number): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pitch.worker.ts', import.meta.url), { type: 'module' })
    const left = buf.getChannelData(0).slice()
    const right = (buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)).slice()
    worker.onmessage = (e: MessageEvent<{ done?: boolean; left: Float32Array; right: Float32Array }>) => {
      if (!e.data.done) return
      const out = new AudioBuffer({ length: buf.length, numberOfChannels: 2, sampleRate: buf.sampleRate })
      out.copyToChannel(e.data.left, 0)
      out.copyToChannel(e.data.right, 1)
      worker.terminate()
      resolve(out)
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(e)
    }
    worker.postMessage({ left, right, semitones }, [left.buffer, right.buffer])
  })
}

/** 원본의 키를 semitones(반음)만큼 바꾼 버퍼. 0이면 원본 그대로. */
export function getShifted(source: Source, semitones: number): Promise<AudioBuffer> {
  if (!semitones) return Promise.resolve(source.buffer)
  const key = `${source.id}:${semitones}`
  let p = cache.get(key)
  if (p) {
    cache.delete(key)
  } else {
    p = run(source.buffer, semitones)
    p.catch(() => cache.delete(key))
  }
  cache.set(key, p)
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!)
  return p
}

export const keyLabel = (n: number) => (n === 0 ? '원키' : `${n > 0 ? '+' : ''}${n}키`)
