import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ClipEditor from './components/ClipEditor'
import Timeline from './components/Timeline'
import MixPanel from './components/MixPanel'
import { useHistory } from './history'
import { renderMix } from './audio/render'
import { bufferToWav } from './audio/wav'
import { encodeMp3 } from './audio/mp3'
import { audioCtx } from './audio/context'
import { defaultBuildUp, uid, type Clip, type Source } from './types'


export default function App() {
  const [sources, setSources] = useState<Map<string, Source>>(new Map())
  const { state: clips, set: setClips, undo, redo, canUndo, canRedo } = useHistory<Clip[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [mix, setMix] = useState<{ buffer: AudioBuffer; url: string; clips: Clip[] } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const selected = clips.find((c) => c.id === selectedId) ?? null
  const selectedIndex = clips.findIndex((c) => c.id === selectedId)

  // 선택된 클립이 사라지면(실행 취소 등) 다른 클립 선택
  useEffect(() => {
    if (!selected && clips.length) setSelectedId(clips[clips.length - 1].id)
    if (!clips.length) setSelectedId(null)
  }, [clips, selected])

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      setError(null)
      const list = [...files].filter((f) => f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|oga|flac|webm|opus)$/i.test(f.name))
      if (!list.length) return setError('오디오 파일만 올릴 수 있어요. (mp3, wav, m4a, ogg, flac 등)')
      const added: Clip[] = []
      const newSources: Source[] = []
      for (const f of list) {
        setLoading(`"${f.name}" 불러오는 중…`)
        try {
          const buffer = await audioCtx().decodeAudioData(await f.arrayBuffer())
          const src: Source = { id: uid(), name: f.name.replace(/\.[^.]+$/, ''), buffer, url: URL.createObjectURL(f) }
          newSources.push(src)
          added.push({ id: uid(), sourceId: src.id, start: 0, end: buffer.duration, fadeIn: 0, fadeOut: 0, gain: 1, pitch: 0, crossfade: 0, buildUp: defaultBuildUp() })
        } catch {
          setError(`"${f.name}"은(는) 이 브라우저에서 읽을 수 없는 형식이에요.`)
        }
      }
      setLoading(null)
      if (!added.length) return
      setSources((m) => {
        const n = new Map(m)
        newSources.forEach((s) => n.set(s.id, s))
        return n
      })
      setClips((cs) => [...cs, ...added])
      setSelectedId(added[added.length - 1].id)
    },
    [setClips],
  )

  const updateClip = useCallback(
    (id: string, patch: Partial<Clip>, key?: string) => setClips((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)), key && `${id}:${key}`),
    [setClips],
  )

  const moveClip = (from: number, to: number) =>
    setClips((cs) => {
      const n = [...cs]
      const [c] = n.splice(from, 1)
      n.splice(to, 0, c)
      return n
    })

  const duplicate = (id: string) => {
    const i = clips.findIndex((c) => c.id === id)
    if (i < 0) return
    const copy = { ...clips[i], id: uid(), buildUp: { ...clips[i].buildUp } }
    setClips([...clips.slice(0, i + 1), copy, ...clips.slice(i + 1)])
    setSelectedId(copy.id)
  }

  const remove = (id: string) => setClips((cs) => cs.filter((c) => c.id !== id))

  const split = (at: number) => {
    if (!selected) return
    const c = selected
    const firstLen = at - c.start
    const climaxInFirst = c.buildUp.climaxAt < firstLen
    const a: Clip = { ...c, end: at, fadeOut: 0, buildUp: climaxInFirst ? c.buildUp : { ...c.buildUp, enabled: false } }
    const b: Clip = {
      ...c,
      id: uid(),
      start: at,
      fadeIn: 0,
      crossfade: 0,
      buildUp: climaxInFirst ? { ...c.buildUp, enabled: false } : { ...c.buildUp, climaxAt: c.buildUp.climaxAt - firstLen },
    }
    setClips((cs) => cs.flatMap((x) => (x.id === c.id ? [a, b] : [x])))
    setSelectedId(b.id)
  }

  /** 같은 원본에서 끊김 없이 이어지는 두 클립(나눴던 클립)인지 */
  const canMerge = (i: number) => {
    const a = clips[i]
    const b = clips[i + 1]
    return !!a && !!b && a.sourceId === b.sourceId && a.pitch === b.pitch && Math.abs(b.start - a.end) < 0.01
  }

  const merge = (i: number) => {
    if (!canMerge(i)) return
    const a = clips[i]
    const b = clips[i + 1]
    const aDur = a.end - a.start
    const buildUp = a.buildUp.enabled ? a.buildUp : b.buildUp.enabled ? { ...b.buildUp, climaxAt: b.buildUp.climaxAt + aDur } : a.buildUp
    const merged: Clip = { ...a, end: b.end, fadeOut: b.fadeOut, buildUp }
    setClips([...clips.slice(0, i), merged, ...clips.slice(i + 2)])
    setSelectedId(a.id)
  }

  const doRender = async () => {
    setBusy(clips.some((c) => c.pitch) ? '키를 바꾸고 모든 클립을 합치는 중…' : '모든 클립을 합치는 중…')
    try {
      const buffer = await renderMix(clips, sources)
      if (!buffer) return null
      if (mix) URL.revokeObjectURL(mix.url)
      const next = { buffer, url: URL.createObjectURL(bufferToWav(buffer)), clips }
      setMix(next)
      return next
    } catch (e) {
      setError(`합치는 중 오류가 났어요: ${(e as Error).message}`)
      return null
    } finally {
      setBusy(null)
    }
  }

  const stale = !!mix && mix.clips !== clips

  const doExport = async (kbps: number, name: string) => {
    if (!clips.length) return setError('먼저 음원을 올려주세요.')
    const m = mix && !stale ? mix : await doRender()
    if (!m) return
    try {
      setBusy('MP3로 변환하는 중… 0%')
      const blob = await encodeMp3(m.buffer, kbps, (p) => setBusy(`MP3로 변환하는 중… ${Math.round(p * 100)}%`))
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${name}.mp3`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
    } catch (e) {
      setError(`MP3 변환 중 오류가 났어요: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  // 단축키: Ctrl/Cmd+Z 실행 취소, Ctrl/Cmd+Shift+Z 또는 Ctrl+Y 다시 실행
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        e.shiftKey ? redo() : undo()
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  const selectedSource = useMemo(() => (selected ? sources.get(selected.sourceId) : undefined), [selected, sources])

  return (
    <div
      className={`app ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        setDragging(false)
        addFiles(e.dataTransfer.files)
      }}
    >
      <header>
        <div className="brand">
          <div className="logo">🎵</div>
          <div>
            <h1>음원 편집기</h1>
            <p className="subtitle">자르고, 잇고, 부드럽게. 내 브라우저에서 바로.</p>
          </div>
        </div>
        <div className="row">
          <button className="ghost" onClick={undo} disabled={!canUndo} title="Ctrl+Z">↶ 되돌리기</button>
          <button className="ghost" onClick={redo} disabled={!canRedo} title="Ctrl+Shift+Z">↷ 다시하기</button>
          <button className="primary" onClick={() => fileInput.current?.click()}>＋ 음원 추가</button>
          <input ref={fileInput} type="file" accept="audio/*" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files).then(() => (e.target.value = ''))} />
        </div>
      </header>

      {error && (
        <p className="error" onClick={() => setError(null)}>
          ⚠️ {error} <small>(눌러서 닫기)</small>
        </p>
      )}
      {loading && <p className="busy">{loading}</p>}

      {!clips.length ? (
        <>
          <button className="dropzone" onClick={() => fileInput.current?.click()}>
            <span className="step">1</span>
            <span className="big-icon">🎶</span>
            <b>음원 파일을 여기에 끌어다 놓으세요</b>
            <span className="muted">또는 눌러서 선택 · mp3, wav, m4a, ogg, flac · 여러 개를 올리면 순서대로 이어져요</span>
            <span className="muted">🔒 파일은 서버로 보내지 않고 내 브라우저에서만 처리돼요</span>
          </button>
          <div className="steps-guide">
            <div><b>① 올리기</b>편집할 음원을 올려요</div>
            <div><b>② 순서 정하기</b>여러 곡을 원하는 순서로 이어요</div>
            <div><b>③ 다듬기</b>자르기 · 페이드 · 크로스페이드 · 빌드업</div>
            <div><b>④ 저장하기</b>들어보고 MP3로 내려받아요</div>
          </div>
        </>
      ) : (
        <>
          <Timeline clips={clips} sources={sources} selectedId={selectedId} onSelect={setSelectedId} onMove={moveClip} onDuplicate={duplicate} onDelete={remove} onAdd={() => fileInput.current?.click()} canMerge={canMerge} onMerge={merge} />
          {selected && selectedSource && (
            <ClipEditor
              key={selected.sourceId}
              clip={selected}
              source={selectedSource}
              isFirst={selectedIndex === 0}
              onChange={(patch, key) => updateClip(selected.id, patch, key)}
              onSplit={split}
              onMergePrev={canMerge(selectedIndex - 1) ? () => merge(selectedIndex - 1) : undefined}
              onMergeNext={canMerge(selectedIndex) ? () => merge(selectedIndex) : undefined}
            />
          )}
          <MixPanel mixUrl={mix?.url ?? null} stale={stale} busy={busy} onRender={doRender} onExport={doExport} />
        </>
      )}

      <footer className="muted">개인적으로 소장한 음원을 편집하는 용도로 사용해 주세요. 저작권이 있는 음원을 무단으로 배포하면 안 돼요.</footer>
    </div>
  )
}
