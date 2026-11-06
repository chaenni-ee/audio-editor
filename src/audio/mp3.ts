/** Web Worker에서 MP3로 인코딩 (화면이 멈추지 않게) */
export function encodeMp3(buf: AudioBuffer, kbps: number, onProgress: (p: number) => void): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./mp3.worker.ts', import.meta.url), { type: 'module' })
    const left = buf.getChannelData(0).slice()
    const right = (buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)).slice()
    worker.onmessage = (e: MessageEvent<{ progress: number; blob?: Blob }>) => {
      onProgress(e.data.progress)
      if (e.data.blob) {
        resolve(e.data.blob)
        worker.terminate()
      }
    }
    worker.onerror = (e) => {
      reject(e)
      worker.terminate()
    }
    worker.postMessage({ left, right, sampleRate: buf.sampleRate, kbps }, [left.buffer, right.buffer])
  })
}
