import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin, { type Region } from 'wavesurfer.js/dist/plugins/regions.esm.js'
import type { BuildUp, Clip, Source } from '../types'
import { clipDuration, renderMix } from '../audio/render'
import { audioCtx } from '../audio/context'
import { getShifted, keyLabel } from '../audio/pitch'
import { fmt } from '../format'
import { analyzeTempo, buildExtended, findDrop, planIntro, snapSelection, type BeatGrid } from '../audio/loop'
import IntroExtender from './IntroExtender'

interface Props {
  clip: Clip
  source: Source
  isFirst: boolean
  onChange: (patch: Partial<Clip>, key?: string) => void
  onSplit: (at: number) => void
  /** 같은 원본에서 바로 이어지는 앞/뒤 클립이 있을 때만 전달됨 */
  onMergePrev?: () => void
  onMergeNext?: () => void
  /** 인트로를 늘린 새 오디오로 이 클립을 바꾼다. introLen = 늘린 인트로 길이 */
  onExtendIntro: (buffer: AudioBuffer, introLen: number) => void
}

export default function ClipEditor({ clip, source, isFirst, onChange, onSplit, onMergePrev, onMergeNext, onExtendIntro }: Props) {
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
  // 인트로 늘리기: 사용자가 끈 반복 구간(loopRaw)을 마디에 맞춘 것이 loop
  const [introOpen, setIntroOpen] = useState(false)
  const [loopRaw, setLoopRaw] = useState({ start: 0, end: 0 })
  const [grid, setGrid] = useState<BeatGrid | null>(null)
  const [snapOn, setSnapOn] = useState(true)
  const [target, setTarget] = useState(30)
  const [dropFound, setDropFound] = useState<number | null>(null)
  const loopRegion = useRef<Region | null>(null)
  const loopLabel = useRef<HTMLSpanElement | null>(null)
  const seam = useRef<AudioBufferSourceNode | null>(null)
  const [seamPlaying, setSeamPlaying] = useState(false)
  const timeRef = useRef(0)
  timeRef.current = time
  // 효과 넣어서 듣기: 렌더링한 결과를 재생하면서 파형 커서를 같이 움직인다
  const fx = useRef<{ node: AudioBufferSourceNode; raf: number } | null>(null)
  const [fxPlaying, setFxPlaying] = useState(false)
  const [fxLoading, setFxLoading] = useState(false)
  // 키 변환은 시간이 조금 걸리므로 바꾸자마자 미리 계산해 둔다
  const [keyReady, setKeyReady] = useState(true)
  useEffect(() => {
    if (!clip.pitch) return setKeyReady(true)
    let alive = true
    setKeyReady(false)
    getShifted(source, clip.pitch).then(() => alive && setKeyReady(true), () => alive && setKeyReady(true))
    return () => {
      alive = false
    }
  }, [source, clip.pitch])
  const playFxRef = useRef<(from?: number) => void>(() => {})

  const stopFx = useCallback(() => {
    const f = fx.current
    if (!f) return
    fx.current = null
    cancelAnimationFrame(f.raf)
    try {
      f.node.stop()
    } catch {
      /* 이미 멈춤 */
    }
    setFxPlaying(false)
  }, [])

  const playFx = async (from?: number) => {
    stopFx()
    ws.current?.pause()
    const c = clipRef.current
    setFxLoading(true)
    const buf = await renderMix([{ ...c, crossfade: 0 }], new Map([[source.id, source]])).finally(() => setFxLoading(false))
    if (!buf) return
    // 기다리는 사이 다른 클립으로 바꿨으면 재생하지 않음
    if (clipRef.current.id !== c.id) return
    const t0 = from ?? timeRef.current
    const offset = t0 >= c.start && t0 < c.end - 0.2 ? t0 - c.start : 0
    const ctx = audioCtx()
    await ctx.resume()
    const node = ctx.createBufferSource()
    node.buffer = buf
    node.connect(ctx.destination)
    const startedAt = ctx.currentTime + 0.05
    node.start(startedAt, offset)
    const tick = () => {
      const f = fx.current
      if (!f || f.node !== node) return
      const t = offset + Math.max(0, ctx.currentTime - startedAt)
      ws.current?.setTime(Math.min(c.start + t, c.end))
      f.raf = requestAnimationFrame(tick)
    }
    fx.current = { node, raf: requestAnimationFrame(tick) }
    node.onended = () => {
      if (fx.current?.node === node) stopFx()
    }
    setFxPlaying(true)
  }
  playFxRef.current = playFx

  // 다른 클립으로 바꾸거나 화면을 떠나면 효과 미리듣기 정지
  useEffect(() => stopFx, [clip.id, stopFx])

  // 효과를 들으면서 설정을 바꾸면 지금 위치부터 바뀐 소리로 다시 재생
  const firstClipRender = useRef(true)
  useEffect(() => {
    if (firstClipRender.current) {
      firstClipRender.current = false
      return
    }
    if (!fx.current) return
    const id = setTimeout(() => fx.current && playFxRef.current(), 250)
    return () => clearTimeout(id)
  }, [clip])

  // 버튼을 눌렀을 때 잠깐 보여주는 안내
  const [flash, setFlash] = useState<string | null>(null)
  useEffect(() => {
    if (!flash) return
    const id = setTimeout(() => setFlash(null), 4000)
    return () => clearTimeout(id)
  }, [flash])

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
      cursorColor: '#e8507a',
      cursorWidth: 3,
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
    // 효과 미리듣기 중에 파형을 누르면 그 위치부터 다시 재생
    w.on('interaction', (t) => {
      if (fx.current) playFxRef.current(t)
    })
    w.on('play', () => setPlaying(true))
    w.on('pause', () => setPlaying(false))
    regions.on('region-updated', (r) => {
      const c = clipRef.current
      if (r === range.current) {
        const start = Math.max(0, r.start)
        const end = Math.min(source.buffer.duration, r.end)
        if (end - start >= 0.1) changeRef.current({ start, end })
      } else if (r === loopRegion.current) {
        setLoopRaw({ start: Math.max(c.start, r.start), end: Math.min(c.end, r.end) })
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
      loopRegion.current = null
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

  // ── 인트로 늘리기 ──
  const openIntro = () => {
    if (introOpen) return setIntroOpen(false)
    const c = clip
    const d = c.end - c.start
    const end = c.buildUp.climaxAt > 0.5 ? c.start + c.buildUp.climaxAt : c.start + Math.min(10, d / 3)
    setLoopRaw({ start: c.start, end: Math.min(c.end, end) })
    setIntroOpen(true)
    setGrid(null)
    setDropFound(null)
    // 화면이 먼저 열리도록 분석은 다음 틱에
    setTimeout(() => {
      setGrid(analyzeTempo(source, c.start, Math.min(c.end, c.start + 90)))
      // 터지는 지점을 직접 정해두지 않았다면 자동으로 찾아서 반복 구간 끝으로
      if (c.buildUp.climaxAt <= 0.5) {
        const drop = findDrop(source, c.start, c.end)
        if (drop !== null) {
          setDropFound(drop)
          setLoopRaw({ start: c.start, end: drop })
        }
      }
    }, 30)
  }
  useEffect(() => setIntroOpen(false), [clip.id])

  const loop = useMemo(() => {
    if (snapOn && grid) return snapSelection(source, grid, loopRaw.start, loopRaw.end, clip.start)
    return { start: loopRaw.start, end: loopRaw.end, bars: null as number | null }
  }, [snapOn, grid, loopRaw, source, clip.start])
  const currentIntro = loop.end - clip.start
  const plan = useMemo(() => planIntro(clip.start, loop.start, loop.end, Math.max(target, currentIntro)), [clip.start, loop, target, currentIntro])

  // 반복 구간을 파형 위 민트색 구간으로 표시
  useEffect(() => {
    if (!ready || !ws.current) return
    const regions = ws.current.getActivePlugins().find((p) => p instanceof RegionsPlugin) as RegionsPlugin | undefined
    if (!introOpen || loop.end - loop.start < 0.1) {
      loopRegion.current?.remove()
      loopRegion.current = null
      return
    }
    const text = `🔁 반복 구간${loop.bars ? ` · ${loop.bars}마디` : ''}`
    if (!loopRegion.current && regions) {
      const el = document.createElement('span')
      Object.assign(el.style, { position: 'absolute', top: '4px', right: '4px', fontSize: '11px', background: '#2f8a68', color: '#fff', padding: '2px 8px', borderRadius: '999px', fontWeight: '600', whiteSpace: 'nowrap' })
      loopLabel.current = el
      loopRegion.current = regions.addRegion({ start: loop.start, end: loop.end, color: 'rgba(76, 191, 149, 0.30)', drag: true, resize: true, content: el })
    } else if (loopRegion.current) {
      loopRegion.current.setOptions({ start: loop.start, end: loop.end })
    }
    if (loopLabel.current) loopLabel.current.textContent = text
  }, [ready, introOpen, loop])

  const stopSeam = useCallback(() => {
    try {
      seam.current?.stop()
    } catch {
      /* 이미 멈춤 */
    }
    seam.current = null
    setSeamPlaying(false)
  }, [])
  useEffect(() => stopSeam, [clip.id, introOpen, stopSeam])

  /** 이음새 앞뒤 3초씩 들려주기 */
  const previewSeam = async () => {
    if (seam.current) return stopSeam()
    stopFx()
    ws.current?.pause()
    const buf = buildExtended(source, clip.start, Math.min(clip.end, loop.end + 1), loop.start, loop.end, 2)
    const at = loop.end - clip.start
    const ctx = audioCtx()
    await ctx.resume()
    const node = ctx.createBufferSource()
    node.buffer = buf
    node.connect(ctx.destination)
    const from = Math.max(0, at - 3)
    node.start(ctx.currentTime + 0.05, from, at + 3 - from)
    node.onended = () => seam.current === node && stopSeam()
    seam.current = node
    setSeamPlaying(true)
  }

  const applyIntro = () => {
    stopSeam()
    stopFx()
    onExtendIntro(buildExtended(source, clip.start, clip.end, loop.start, loop.end, plan.repeats), plan.introLen)
  }

  const playRange = () => {
    const w = ws.current
    if (!w) return
    if (w.isPlaying()) return w.pause()
    stopFx()
    const from = time >= clip.start && time < clip.end - 0.05 ? time : clip.start
    stopAt.current = clip.end
    w.setTime(from)
    w.play()
  }

  const dur = clipDuration(clip)
  const bu = clip.buildUp
  const setBu = (patch: Partial<BuildUp>, key?: string) => onChange({ buildUp: { ...bu, ...patch } }, key)
  const maxFade = Math.max(0.1, Math.floor(dur * 10) / 20)

  const presetActive = bu.enabled && bu.muffle && bu.pauseBeforeDrop && bu.bassBoost && Math.abs(bu.startVolume - 0.3) < 0.001
  const activeFx = [
    clip.fadeIn > 0 && '페이드 인',
    clip.fadeOut > 0 && '페이드 아웃',
    clip.gain !== 1 && `볼륨 ${Math.round(clip.gain * 100)}%`,
    clip.pitch !== 0 && `🎤 ${keyLabel(clip.pitch)}`,
    !isFirst && clip.crossfade > 0 && '크로스페이드',
    bu.enabled && (presetActive ? '💒 결혼식 프리셋' : '💥 빌드업'),
    bu.enabled && (bu.mode === 'hold' ? `🤫 ${Math.round(bu.startVolume * 100)}% 유지` : '📈 점점 커지게'),
  ].filter(Boolean) as string[]

  const applyWeddingPreset = () => {
    setFlash(fxPlaying ? '💒 결혼식 프리셋 적용! 바뀐 소리로 다시 재생할게요.' : '💒 결혼식 프리셋이 적용됐어요! "🎧 효과 넣어서 듣기"로 들어보세요.')
    onChange({
      fadeIn: Math.max(clip.fadeIn, Math.min(2, dur / 10)),
      buildUp: {
        enabled: true,
        // 인트로 늘리기 등으로 이미 정해둔 터지는 지점이 있으면 그대로 둔다
        climaxAt: bu.climaxAt > 0.5 ? bu.climaxAt : Math.round(Math.min(dur * 0.55, Math.max(8, dur * 0.4)) * 10) / 10,
        mode: bu.mode,
        startVolume: 0.3,
        swell: bu.swell ?? 3,
        muffle: true,
        pauseBeforeDrop: true,
        bassBoost: true,
      },
    })
  }

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

      <div className="wave-wrap">
        <div className="wave" ref={box} />
        {ready && (
          <div
            className={`playhead ${playing || fxPlaying ? 'on' : ''}`}
            style={{
              left: `${(time / source.buffer.duration) * 100}%`,
              // 양 끝에서는 글자가 파형 밖으로 나가지 않게
              transform: `translateX(${time / source.buffer.duration < 0.04 ? '0' : time / source.buffer.duration > 0.96 ? '-100%' : '-50%'})`,
            }}
          >
            {fmt(time)}
          </div>
        )}
      </div>
      <p className="hint">💡 분홍색 구간이 실제로 쓰이는 부분이에요. 양 끝을 끌어서 자르고, 파형을 누르면 그 위치부터 들을 수 있어요.</p>

      <div className={`nowbar ${playing || fxPlaying ? 'on' : ''}`}>
        <span className="now-label">{fxPlaying ? '🎧 효과 재생 중' : playing ? '▶ 원본 재생 중' : '⏸ 멈춤'}</span>
        <span className="now-time">{fmt(time)}</span>
        <div className="progress" title="사용 구간 안에서의 위치">
          <div style={{ width: `${Math.max(0, Math.min(100, ((time - clip.start) / dur) * 100))}%` }} />
        </div>
        <span className="muted">
          구간 {fmt(Math.max(0, Math.min(dur, time - clip.start)))} / {fmt(dur)}
        </span>
      </div>

      <div className="row">
        <button className="primary" onClick={playRange} disabled={!ready}>
          {playing ? '⏸ 일시정지' : '▶ 원본 듣기 (효과 없음)'}
        </button>
        <button className={fxPlaying ? 'active' : flash ? 'pulse' : ''} onClick={() => (fxPlaying ? stopFx() : playFx())} disabled={!ready}>
          {fxLoading ? '⏳ 준비 중…' : fxPlaying ? '⏹ 정지' : '🎧 효과 넣어서 듣기'}
        </button>
        <button onClick={() => onSplit(time)} disabled={!ready || time <= clip.start + 0.1 || time >= clip.end - 0.1} title="파형을 눌러 위치를 고른 뒤 누르세요">
          ✂️ {fmt(time)}에서 둘로 나누기
        </button>
        {onMergePrev && <button onClick={onMergePrev}>🔗 앞 클립과 다시 합치기</button>}
        {onMergeNext && <button onClick={onMergeNext}>🔗 뒤 클립과 다시 합치기</button>}
      </div>

      <div className="fx-status">
        <span>🎚️ 이 클립에 적용된 효과:</span>
        {activeFx.length ? activeFx.map((f) => <span className="fx-tag" key={f}>{f}</span>) : <span className="muted">없음 (원본 그대로)</span>}
      </div>
      {flash && <div className="flash">{flash}</div>}

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
        <div className="group key">
          <h3>🎤 키 조절</h3>
          <div className="key-ctrl">
            <button onClick={() => onChange({ pitch: Math.max(-6, clip.pitch - 1) }, 'pitch')} disabled={clip.pitch <= -6} aria-label="키 낮추기">
              ▼ 낮추기
            </button>
            <div className="key-val">
              <b>{keyLabel(clip.pitch)}</b>
              <small>{clip.pitch === 0 ? '원래 키' : keyReady ? '✅ 준비 완료' : '⏳ 키 바꾸는 중…'}</small>
            </div>
            <button onClick={() => onChange({ pitch: Math.min(6, clip.pitch + 1) }, 'pitch')} disabled={clip.pitch >= 6} aria-label="키 높이기">
              ▲ 높이기
            </button>
          </div>
          <div className="row">
            <button className="ghost small" disabled={clip.pitch === 0} onClick={() => onChange({ pitch: 0 })}>
              ↺ 원키로
            </button>
            <small className="muted">빠르기는 그대로, 음높이만 반음씩 바뀌어요. ±4키를 넘으면 음색이 조금 달라질 수 있어요.</small>
          </div>
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

      <IntroExtender
        open={introOpen}
        onToggle={openIntro}
        grid={grid}
        onBpm={(bpm) => grid && setGrid({ ...grid, bpm })}
        snapOn={snapOn}
        onSnap={setSnapOn}
        loop={loop}
        currentIntro={currentIntro}
        target={Math.max(target, Math.ceil(currentIntro))}
        onTarget={setTarget}
        plan={plan}
        previewing={seamPlaying}
        onPreview={previewSeam}
        onApply={applyIntro}
        dropFound={dropFound}
      />

      <div className="buildup">
        <div className="panel-head">
          <h3>💥 빌드업: 잔잔하게 시작해서 팡!</h3>
          <label className="switch">
            <input type="checkbox" checked={bu.enabled} onChange={(e) => setBu({ enabled: e.target.checked, climaxAt: bu.climaxAt || Math.round(dur * 0.5 * 10) / 10 })} />
            {bu.enabled ? '켜짐' : '꺼짐'}
          </label>
        </div>
        <div className="row">
          <button className={presetActive ? 'applied' : ''} onClick={applyWeddingPreset}>
            {presetActive ? '✅ 결혼식 입장 프리셋 적용됨' : '💒 결혼식 입장 프리셋 적용하기'}
          </button>
          <span className="muted">작고 먹먹하게 시작 → 잠깐 멈춘 뒤 확 터져요. 누르면 바로 이 클립에 적용돼요.</span>
        </div>
        {bu.enabled && (
          <>
            <div className="mode-pick" role="radiogroup" aria-label="빌드업 방식">
              <button role="radio" aria-checked={bu.mode !== 'hold'} className={bu.mode !== 'hold' ? 'on' : ''} onClick={() => setBu({ mode: 'rise' })}>
                <b>📈 점점 커지게</b>
                <small>작게 시작해서 클라이맥스까지 서서히 커지다가 팡</small>
                <MiniGraph mode="rise" />
              </button>
              <button role="radio" aria-checked={bu.mode === 'hold'} className={bu.mode === 'hold' ? 'on' : ''} onClick={() => setBu({ mode: 'hold' })}>
                <b>🤫 작게 유지하다가 팡</b>
                <small>정한 볼륨으로 잔잔하게 유지하다가, 직전에 살짝 커지면서 팡</small>
                <MiniGraph mode="hold" />
              </button>
            </div>
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
              <Slider
                label={bu.mode === 'hold' ? '클라이맥스 전까지 유지할 볼륨' : '시작 볼륨'}
                unit="%"
                value={Math.round(bu.startVolume * 100)}
                min={5}
                max={100}
                step={5}
                note={bu.mode === 'hold' ? '처음부터 클라이맥스 직전까지 이 볼륨으로 쭉 유지돼요' : '작을수록 터질 때 차이가 커요'}
                onChange={(v) => setBu({ startVolume: v / 100 }, 'sv')}
              />
              {bu.mode === 'hold' && (
                <Slider
                  label="터지기 직전 살짝 커지는 시간"
                  unit="초"
                  value={bu.swell ?? 0}
                  min={0}
                  max={Math.max(0, Math.min(10, Math.floor((bu.climaxAt - 0.5) * 2) / 2))}
                  step={0.5}
                  note={(bu.swell ?? 0) > 0 ? `클라이맥스 ${(bu.swell ?? 0).toFixed(1)}초 전부터 서서히 커져요` : '0초: 작게 쭉 유지하다가 바로 팡'}
                  onChange={(v) => setBu({ swell: v }, 'swell')}
                />
              )}
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

/** 빌드업 방식을 한눈에 보여주는 작은 볼륨 그래프 */
function MiniGraph({ mode }: { mode: 'rise' | 'hold' }) {
  const d = mode === 'rise' ? 'M2 30 C 30 29, 52 24, 66 16 L 68 30 L 72 30 L 72 4 L 98 4' : 'M2 23 L 50 23 C 58 22.5, 63 20, 67 16 L 68 30 L 72 30 L 72 4 L 98 4'
  return (
    <svg viewBox="0 0 100 34" className="mini-graph" aria-hidden="true">
      <line x1="70" y1="0" x2="70" y2="34" className="mg-climax" />
      <path d={d} className="mg-line" />
    </svg>
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
