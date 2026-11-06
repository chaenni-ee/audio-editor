import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin, { type Region } from 'wavesurfer.js/dist/plugins/regions.esm.js'
import type { BuildUp, Clip, Source } from '../types'
import { clipDuration } from '../audio/render'
import { fmt } from '../format'

interface Props {
  clip: Clip
  source: Source
  isFirst: boolean
  onChange: (patch: Partial<Clip>, key?: string) => void
  onSplit: (at: number) => void
  onPreviewFx: () => void
  previewingFx: boolean
}

export default function ClipEditor({ clip, source, isFirst, onChange, onSplit, onPreviewFx, previewingFx }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const ws = useRef<WaveSurfer | null>(null)
  const range = useRef<Region | null>(null)
  const marker = useRef<Region | null>(null)
  const stopAt = useRef<number | null>(null)
  const clipRef = useRef(clip)
  clipRef.current = clip
  const changeRef = useRef(onChange)
  changeRef.current = onChange
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)

  // 원본이 바뀔 때만 파형을 새로 만든다
  useEffect(() => {
    if (!box.current) return
    setReady(false)
    const regions = RegionsPlugin.create()
    const w = WaveSurfer.create({
      container: box.current,
      url: source.url,
      height: 128,
      waveColor: '#c9b8ff',
      progressColor: '#9b87f5',
      cursorColor: '#ff7a95',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      plugins: [regions],
    })
    ws.current = w
    w.on('ready', () => {
      const c = clipRef.current
      range.current = regions.addRegion({ start: c.start, end: c.end, color: 'rgba(255, 181, 200, 0.28)', drag: true, resize: true })
      setReady(true)
    })
    w.on('timeupdate', (t) => {
      setTime(t)
      if (stopAt.current !== null && t >= stopAt.current) {
        stopAt.current = null
        w.pause()
      }
    })
    w.on('play', () => setPlaying(true))
    w.on('pause', () => setPlaying(false))
    regions.on('region-updated', (r) => {
      const c = clipRef.current
      if (r === range.current) {
        const start = Math.max(0, r.start)
        const end = Math.min(source.buffer.duration, r.end)
        if (end - start >= 0.1) changeRef.current({ start, end })
      } else if (r === marker.current) {
        const climaxAt = Math.max(0.5, Math.min(r.start - c.start, c.end - c.start))
        changeRef.current({ buildUp: { ...c.buildUp, climaxAt } })
      }
    })
    return () => {
      w.destroy()
      ws.current = null
      range.current = null
      marker.current = null
    }
  }, [source.url, source.buffer.duration])

  // 숫자 입력 등 외부 변경을 파형 위 구간에 반영
  useEffect(() => {
    if (!ready || !ws.current) return
    const r = range.current
    if (r && (Math.abs(r.start - clip.start) > 1e-3 || Math.abs(r.end - clip.end) > 1e-3)) {
      r.setOptions({ start: clip.start, end: clip.end })
    }
    const regions = ws.current.getActivePlugins().find((p) => p instanceof RegionsPlugin) as RegionsPlugin | undefined
    const t = clip.start + clip.buildUp.climaxAt
    if (clip.buildUp.enabled) {
      if (!marker.current && regions) {
        const el = document.createElement('span')
        // 파형은 Shadow DOM 안에 그려져서 전역 CSS가 닿지 않으므로 인라인 스타일 사용
        Object.assign(el.style, { position: 'absolute', top: '4px', left: '3px', fontSize: '11px', background: '#ff7a95', color: '#fff', padding: '2px 8px', borderRadius: '999px', fontWeight: '600', whiteSpace: 'nowrap' })
        el.textContent = '💥 클라이맥스'
        marker.current = regions.addRegion({ start: t, color: '#ff7a95', drag: true, content: el })
      } else if (marker.current && Math.abs(marker.current.start - t) > 1e-3) {
        marker.current.setOptions({ start: t })
      }
    } else if (marker.current) {
      marker.current.remove()
      marker.current = null
    }
  }, [ready, clip.start, clip.end, clip.buildUp.enabled, clip.buildUp.climaxAt])

  const playRange = () => {
    const w = ws.current
    if (!w) return
    if (w.isPlaying()) return w.pause()
    const from = time >= clip.start && time < clip.end - 0.05 ? time : clip.start
    stopAt.current = clip.end
    w.setTime(from)
    w.play()
  }

  const dur = clipDuration(clip)
  const bu = clip.buildUp
  const setBu = (patch: Partial<BuildUp>, key?: string) => onChange({ buildUp: { ...bu, ...patch } }, key)
  const maxFade = Math.max(0.1, Math.floor(dur * 10) / 20)

  const applyWeddingPreset = () =>
    onChange({
      fadeIn: Math.max(clip.fadeIn, Math.min(2, dur / 10)),
      buildUp: {
        enabled: true,
        climaxAt: Math.round(Math.min(dur * 0.55, Math.max(8, dur * 0.4)) * 10) / 10,
        startVolume: 0.3,
        muffle: true,
        pauseBeforeDrop: true,
        bassBoost: true,
      },
    })

  return (
    <section className="panel editor">
      <div className="panel-head">
        <h2>
          <span className="step">3</span> 클립 다듬기 · {source.name}
        </h2>
        <span className="muted">
          {fmt(clip.start)} – {fmt(clip.end)} 사용 · 길이 {fmt(dur)}
        </span>
      </div>

      <div className="wave" ref={box} />
      <p className="hint">💡 분홍색 구간이 실제로 쓰이는 부분이에요. 양 끝을 끌어서 자르고, 파형을 누르면 그 위치부터 들을 수 있어요.</p>

      <div className="row">
        <button className="primary" onClick={playRange} disabled={!ready}>
          {playing ? '⏸ 일시정지' : '▶ 원본 듣기'}
        </button>
        <button onClick={onPreviewFx} disabled={!ready}>
          {previewingFx ? '⏹ 정지' : '🎧 효과 넣어서 듣기'}
        </button>
        <button onClick={() => onSplit(time)} disabled={!ready || time <= clip.start + 0.1 || time >= clip.end - 0.1} title="파형을 눌러 위치를 고른 뒤 누르세요">
          ✂️ {fmt(time)}에서 둘로 나누기
        </button>
      </div>

      <div className="groups">
        <div className="group cut">
          <h3>✂️ 자르기</h3>
          <div className="two">
            <NumField label="시작" value={clip.start} min={0} max={clip.end - 0.1} step={0.1} onChange={(v) => onChange({ start: v }, 'start')} />
            <NumField label="끝" value={clip.end} min={clip.start + 0.1} max={source.buffer.duration} step={0.1} onChange={(v) => onChange({ end: v }, 'end')} />
          </div>
        </div>
        <div className="group fade">
          <h3>🌙 부드럽게 시작·끝내기</h3>
          <Slider label="페이드 인 (서서히 커짐)" unit="초" value={clip.fadeIn} min={0} max={maxFade} step={0.1} onChange={(v) => onChange({ fadeIn: v }, 'fadeIn')} />
          <Slider label="페이드 아웃 (서서히 작아짐)" unit="초" value={clip.fadeOut} min={0} max={maxFade} step={0.1} onChange={(v) => onChange({ fadeOut: v }, 'fadeOut')} />
        </div>
        <div className="group mix">
          <h3>🔊 볼륨 · 앞 곡과 잇기</h3>
          <Slider label="볼륨" unit="%" value={Math.round(clip.gain * 100)} min={0} max={200} step={5} onChange={(v) => onChange({ gain: v / 100 }, 'gain')} />
          <Slider
            label="크로스페이드 (앞 곡과 겹치기)"
            unit="초"
            value={clip.crossfade}
            min={0}
            max={Math.min(15, maxFade)}
            step={0.1}
            disabled={isFirst}
            note={isFirst ? '첫 번째 클립이라 앞 곡이 없어요' : '앞 곡이 작아지는 동안 이 곡이 겹치며 커져요'}
            onChange={(v) => onChange({ crossfade: v }, 'crossfade')}
          />
        </div>
      </div>

      <div className="buildup">
        <div className="panel-head">
          <h3>💥 빌드업: 잔잔하게 시작해서 팡!</h3>
          <label className="switch">
            <input type="checkbox" checked={bu.enabled} onChange={(e) => setBu({ enabled: e.target.checked, climaxAt: bu.climaxAt || Math.round(dur * 0.5 * 10) / 10 })} />
            {bu.enabled ? '켜짐' : '꺼짐'}
          </label>
        </div>
        <div className="row">
          <button onClick={applyWeddingPreset}>💒 결혼식 입장 프리셋</button>
          <span className="muted">작고 먹먹하게 시작 → 점점 커지다가 → 잠깐 멈춘 뒤 확 터져요.</span>
        </div>
        {bu.enabled && (
          <>
            <div className="grid2">
              <Slider
                label="터지는 지점"
                unit="초"
                value={bu.climaxAt}
                min={0.5}
                max={Math.max(0.5, Math.floor(dur * 10) / 10)}
                step={0.1}
                note="파형 위 💥 선을 끌어도 돼요"
                onChange={(v) => setBu({ climaxAt: v }, 'climax')}
              />
              <Slider label="시작 볼륨" unit="%" value={Math.round(bu.startVolume * 100)} min={5} max={100} step={5} note="작을수록 터질 때 차이가 커요" onChange={(v) => setBu({ startVolume: v / 100 }, 'sv')} />
            </div>
            <div className="row checks">
              <label className="chip">
                <input type="checkbox" checked={bu.muffle} onChange={(e) => setBu({ muffle: e.target.checked })} /> 🌫️ 먹먹하게 시작
              </label>
              <label className="chip">
                <input type="checkbox" checked={bu.pauseBeforeDrop} onChange={(e) => setBu({ pauseBeforeDrop: e.target.checked })} /> 🤫 터지기 전 정적
              </label>
              <label className="chip">
                <input type="checkbox" checked={bu.bassBoost} onChange={(e) => setBu({ bassBoost: e.target.checked })} /> 🥁 터진 뒤 저음 강조
              </label>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function Slider(p: { label: string; unit: string; value: number; min: number; max: number; step: number; disabled?: boolean; note?: string; onChange: (v: number) => void }) {
  const v = Math.min(p.value, p.max)
  return (
    <label className={`field ${p.disabled ? 'disabled' : ''}`}>
      <span>
        {p.label}
        <b>
          {p.unit === '초' ? v.toFixed(1) : v}
          {p.unit}
        </b>
      </span>
      <input
        type="range"
        min={p.min}
        max={p.max}
        step={p.step}
        value={v}
        disabled={p.disabled}
        style={{ ['--p' as string]: `${p.max > p.min ? ((v - p.min) / (p.max - p.min)) * 100 : 0}%` }}
        onChange={(e) => p.onChange(Number(e.target.value))}
      />
      {p.note && <small>{p.note}</small>}
    </label>
  )
}

function NumField(p: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(p.value.toFixed(1))
  useEffect(() => setText(p.value.toFixed(1)), [p.value])
  const commit = () => {
    const n = Number(text)
    if (isFinite(n)) p.onChange(Math.max(p.min, Math.min(p.max, n)))
    else setText(p.value.toFixed(1))
  }
  return (
    <label className="field">
      <span>
        {p.label} <b>{fmt(p.value)}</b>
      </span>
      <input type="number" min={p.min} max={p.max} step={p.step} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
      
    </label>
  )
}
