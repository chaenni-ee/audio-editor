import { useState } from 'react'
import type { BeatGrid } from '../audio/loop'
import { fmt } from '../format'

interface Props {
  open: boolean
  onToggle: () => void
  grid: BeatGrid | null
  onBpm: (bpm: number) => void
  snapOn: boolean
  onSnap: (on: boolean) => void
  loop: { start: number; end: number; bars: number | null }
  /** 지금 인트로 길이 (클립 시작 ~ 반복 구간 끝) */
  currentIntro: number
  target: number
  onTarget: (v: number) => void
  plan: { repeats: number; introLen: number }
  previewing: boolean
  onPreview: () => void
  onApply: () => void
  /** 자동으로 찾은 "노래가 터지는 지점" */
  dropFound: number | null
}

export default function IntroExtender(p: Props) {
  const [bpmText, setBpmText] = useState<string | null>(null)
  const loopLen = p.loop.end - p.loop.start
  const commitBpm = () => {
    const n = Number(bpmText)
    if (bpmText !== null && isFinite(n) && n >= 40 && n <= 240) p.onBpm(n)
    setBpmText(null)
  }

  return (
    <div className={`intro ${p.open ? 'open' : ''}`}>
      <div className="panel-head">
        <h3>🔁 인트로 늘리기 (사회자 멘트용)</h3>
        <button className={p.open ? '' : 'primary'} onClick={p.onToggle}>
          {p.open ? '닫기' : '열기'}
        </button>
      </div>
      {!p.open ? (
        <p className="muted" style={{ margin: 0 }}>
          앞부분이 짧을 때, 인트로의 일부를 박자에 맞춰 자연스럽게 반복해서 원하는 길이(예: 30초)로 늘려줘요.
        </p>
      ) : (
        <>
          <ol className="intro-steps">
            <li>
              파형 위 <b className="mint-text">민트색 반복 구간</b>을 끌어서, <b>끝을 노래가 터지기 직전</b>에 맞춰 주세요. 시작은 인트로 안 아무 데나 괜찮아요.
            </li>
            <li>늘린 뒤 인트로 길이를 정하고, 이음새를 들어본 다음 늘리기를 누르세요.</li>
          </ol>

          {p.dropFound !== null && (
            <p className="found">🎯 노래가 터지는 지점({fmt(p.dropFound)})을 자동으로 찾아서 반복 구간 끝으로 잡았어요. 다르면 끌어서 고쳐 주세요.</p>
          )}
          <div className="intro-grid">
            <div className="intro-card">
              <span className="muted">반복 구간</span>
              <b>
                {fmt(p.loop.start)} – {fmt(p.loop.end)}
              </b>
              <small>
                {loopLen.toFixed(2)}초{p.loop.bars ? ` · ${p.loop.bars}마디` : ''}
              </small>
            </div>
            <div className="intro-card">
              <span className="muted">곡 빠르기</span>
              {p.grid ? (
                <div className="row bpm-row">
                  <input
                    type="number"
                    value={bpmText ?? p.grid.bpm.toFixed(1)}
                    step={0.1}
                    onChange={(e) => setBpmText(e.target.value)}
                    onBlur={commitBpm}
                    onKeyDown={(e) => e.key === 'Enter' && commitBpm()}
                    aria-label="BPM"
                  />
                  <span className="muted">BPM</span>
                  <button className="small" onClick={() => p.onBpm(p.grid!.bpm / 2)} title="실제보다 두 배 빠르게 잡혔을 때">
                    ½
                  </button>
                  <button className="small" onClick={() => p.onBpm(p.grid!.bpm * 2)} title="실제보다 절반으로 잡혔을 때">
                    ×2
                  </button>
                </div>
              ) : (
                <b>분석 중…</b>
              )}
              <small>자동으로 찾았어요. 틀리면 직접 고칠 수 있어요</small>
            </div>
          </div>

          <label className="chip" style={{ alignSelf: 'flex-start' }}>
            <input type="checkbox" checked={p.snapOn} onChange={(e) => p.onSnap(e.target.checked)} /> 🎯 마디에 자동으로 맞추기 (추천)
          </label>

          <label className="field">
            <span>
              늘린 뒤 인트로 길이 (사회자 멘트 시간)
              <b>{p.target}초</b>
            </span>
            <input
              type="range"
              min={Math.ceil(p.currentIntro)}
              max={120}
              step={1}
              value={p.target}
              style={{ ['--p' as string]: `${((p.target - Math.ceil(p.currentIntro)) / Math.max(1, 120 - Math.ceil(p.currentIntro))) * 100}%`, ['--c' as string]: '#4cbf95' }}
              onChange={(e) => p.onTarget(Number(e.target.value))}
            />
            <small>
              지금 인트로 {fmt(p.currentIntro)} → 반복 구간을 <b>{p.plan.repeats}번</b> 재생해서 <b>{fmt(p.plan.introLen)}</b>가 돼요
              {p.snapOn ? ' (마디 단위라 정확히 맞추지 않고 가장 가까운 길이로)' : ''}
            </small>
          </label>

          <div className="row">
            <button onClick={p.onPreview} disabled={loopLen < 0.5}>
              {p.previewing ? '⏹ 정지' : '🎧 이음새 들어보기'}
            </button>
            <button className="primary" onClick={p.onApply} disabled={loopLen < 0.5 || p.plan.repeats < 2}>
              ✅ 인트로를 {fmt(p.plan.introLen)}로 늘리기
            </button>
            {p.plan.repeats < 2 && <small className="muted">늘릴 길이를 지금보다 길게 정해 주세요</small>}
          </div>
        </>
      )}
    </div>
  )
}
