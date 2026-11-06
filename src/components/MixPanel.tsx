import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import { fmt } from '../format'

interface Props {
  mixUrl: string | null
  stale: boolean
  busy: string | null
  onRender: () => void
  onExport: (kbps: number, name: string) => void
}

export default function MixPanel({ mixUrl, stale, busy, onRender, onExport }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const ws = useRef<WaveSurfer | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [dur, setDur] = useState(0)
  const [kbps, setKbps] = useState(192)
  const [name, setName] = useState('편집본')

  useEffect(() => {
    if (!box.current || !mixUrl) return
    const w = WaveSurfer.create({
      container: box.current,
      url: mixUrl,
      height: 96,
      waveColor: '#4d7c6f',
      progressColor: '#7fd1b9',
      cursorColor: '#ffd166',
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
    })
    ws.current = w
    w.on('ready', (d) => setDur(d))
    w.on('timeupdate', setTime)
    w.on('play', () => setPlaying(true))
    w.on('pause', () => setPlaying(false))
    w.on('finish', () => setPlaying(false))
    return () => {
      w.destroy()
      ws.current = null
      setPlaying(false)
    }
  }, [mixUrl])

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>🎧 전체 미리듣기 & 내보내기</h2>
        {mixUrl && <span className="muted">{fmt(time)} / {fmt(dur)}</span>}
      </div>
      {mixUrl ? <div className="wave" ref={box} /> : <p className="muted">"합치기"를 누르면 모든 효과를 적용한 결과를 만들어서 들려줘요.</p>}
      {stale && mixUrl && <p className="warn">편집 내용이 바뀌었어요. 다시 합쳐야 최신 결과를 들을 수 있어요.</p>}
      <div className="row">
        <button className={stale || !mixUrl ? 'primary' : ''} onClick={onRender} disabled={!!busy}>
          🔄 {mixUrl ? '다시 합치기' : '합치기'}
        </button>
        <button onClick={() => ws.current?.playPause()} disabled={!mixUrl || !!busy}>
          {playing ? '⏸ 일시정지' : '▶ 재생'}
        </button>
        <span className="spacer" />
        <input className="name-input" value={name} onChange={(e) => setName(e.target.value)} aria-label="파일 이름" />
        <span className="muted">.mp3</span>
        <select value={kbps} onChange={(e) => setKbps(Number(e.target.value))} aria-label="음질">
          <option value={128}>128kbps (작은 용량)</option>
          <option value={192}>192kbps (추천)</option>
          <option value={320}>320kbps (최고 음질)</option>
        </select>
        <button className="primary" onClick={() => onExport(kbps, name.trim() || '편집본')} disabled={!!busy}>
          ⬇️ MP3 다운로드
        </button>
      </div>
      {busy && <p className="busy">{busy}</p>}
    </section>
  )
}
