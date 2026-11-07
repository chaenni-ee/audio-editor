import { useState } from 'react'
import type { Clip, Source } from '../types'
import { clipDuration, layout } from '../audio/render'
import { fmt } from '../format'
import { keyLabel } from '../audio/pitch'

interface Props {
  clips: Clip[]
  sources: Map<string, Source>
  selectedId: string | null
  onSelect: (id: string) => void
  onMove: (from: number, to: number) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
  onAdd: () => void
  canMerge: (i: number) => boolean
  onMerge: (i: number) => void
}

export default function Timeline({ clips, sources, selectedId, onSelect, onMove, onDuplicate, onDelete, onAdd, canMerge, onMerge }: Props) {
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const { placed, total } = layout(clips, sources)

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>
          <span className="step">2</span> 순서 정하기
        </h2>
        <span className="muted">
          클립 {clips.length}개 · 전체 {fmt(total)} · 카드를 끌어서 순서를 바꿔요
        </span>
      </div>

      {total > 0 && (
        <div className="bar">
          {placed.map((p, i) => (
            <div
              key={p.clip.id}
              className={`bar-seg c${i % 6} ${p.clip.id === selectedId ? 'sel' : ''}`}
              style={{ left: `${(p.at / total) * 100}%`, width: `${(p.dur / total) * 100}%`, top: i % 2 ? '50%' : 0 }}
              onClick={() => onSelect(p.clip.id)}
              title={sources.get(p.clip.sourceId)?.name}
            />
          ))}
        </div>
      )}

      <div className="cards">
        {clips.map((c, i) => {
          const dur = clipDuration(c)
          const tags = [
            c.fadeIn > 0 && `페이드인 ${c.fadeIn.toFixed(1)}s`,
            c.fadeOut > 0 && `페이드아웃 ${c.fadeOut.toFixed(1)}s`,
            c.pitch !== 0 && `🎤 ${keyLabel(c.pitch)}`,
            c.buildUp.enabled && '💥 빌드업',
            c.gain !== 1 && `볼륨 ${Math.round(c.gain * 100)}%`,
          ].filter(Boolean) as string[]
          return [
            i > 0 && (
              <div className="link" key={`link-${c.id}`}>
                {c.crossfade > 0 ? <span>🔀 {c.crossfade.toFixed(1)}s</span> : '→'}
                {canMerge(i - 1) && (
                  <button className="merge" onClick={() => onMerge(i - 1)} title="나눴던 두 클립을 다시 하나로 합쳐요">
                    🔗 합치기
                  </button>
                )}
              </div>
            ),
            <div
              key={c.id}
              className={`card c${i % 6} ${c.id === selectedId ? 'sel' : ''} ${dragOver === i ? 'over' : ''}`}
              draggable
              onDragStart={() => setDragFrom(i)}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(i)
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={() => {
                if (dragFrom !== null && dragFrom !== i) onMove(dragFrom, i)
                setDragFrom(null)
                setDragOver(null)
              }}
              onDragEnd={() => {
                setDragFrom(null)
                setDragOver(null)
              }}
              onClick={() => onSelect(c.id)}
            >
              <div className="card-top">
                <span className="num">{i + 1}</span>
                <span className="name">{sources.get(c.sourceId)?.name}</span>
              </div>
              <div className="muted">{fmt(dur)}</div>
              <div className="tags">{tags.map((t) => <span key={t}>{t}</span>)}</div>
              <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                <button disabled={i === 0} onClick={() => onMove(i, i - 1)} title="앞으로">◀</button>
                <button disabled={i === clips.length - 1} onClick={() => onMove(i, i + 1)} title="뒤로">▶</button>
                <button onClick={() => onDuplicate(c.id)} title="복제">⧉</button>
                <button className="danger" onClick={() => onDelete(c.id)} title="삭제">🗑</button>
              </div>
            </div>,
          ]
        })}
        <button className="add-card" onClick={onAdd}>
          <span style={{ fontSize: 22 }}>＋</span>
          음원 추가
        </button>
      </div>
    </section>
  )
}
