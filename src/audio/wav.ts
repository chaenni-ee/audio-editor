/** 미리듣기 파형 표시용 WAV(16bit) 변환 */
export function bufferToWav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels
  const len = buf.length
  const data = new DataView(new ArrayBuffer(44 + len * ch * 2))
  const str = (o: number, s: string) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  data.setUint32(4, 36 + len * ch * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  data.setUint32(16, 16, true)
  data.setUint16(20, 1, true)
  data.setUint16(22, ch, true)
  data.setUint32(24, buf.sampleRate, true)
  data.setUint32(28, buf.sampleRate * ch * 2, true)
  data.setUint16(32, ch * 2, true)
  data.setUint16(34, 16, true)
  str(36, 'data')
  data.setUint32(40, len * ch * 2, true)
  const chans = Array.from({ length: ch }, (_, i) => buf.getChannelData(i))
  let o = 44
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]))
      data.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      o += 2
    }
  }
  return new Blob([data], { type: 'audio/wav' })
}
