export interface Source {
  id: string
  name: string
  buffer: AudioBuffer
  /** 원본 파일 Blob URL (파형 표시용) */
  url: string
}

/** "잔잔하게 시작 → 클라이맥스에서 팡" 효과 */
export type BuildUpMode = 'rise' | 'hold'

export interface BuildUp {
  enabled: boolean
  /** rise: 점점 커지다가 팡 / hold: 작은 볼륨을 쭉 유지하다가 팡 */
  mode: BuildUpMode
  /** 클립 시작 기준 클라이맥스(터지는 지점) 시각, 초 */
  climaxAt: number
  /** 시작 볼륨 (rise) 또는 클라이맥스 전까지 유지할 볼륨 (hold), 0.05 ~ 1 */
  startVolume: number
  /** 처음엔 먹먹하게(저역 통과 필터) 시작해서 점점 선명해짐 */
  muffle: boolean
  /** 클라이맥스 직전 짧은 정적 */
  pauseBeforeDrop: boolean
  /** 클라이맥스 이후 저음 강조 */
  bassBoost: boolean
}

export interface Clip {
  id: string
  sourceId: string
  /** 원본 기준 시작/끝, 초 */
  start: number
  end: number
  fadeIn: number
  fadeOut: number
  /** 볼륨 배율 (0 ~ 2) */
  gain: number
  /** 앞 클립과 겹치는 크로스페이드 길이, 초 (첫 클립은 무시) */
  crossfade: number
  buildUp: BuildUp
}

export const defaultBuildUp = (): BuildUp => ({
  enabled: false,
  mode: 'rise',
  climaxAt: 0,
  startVolume: 0.35,
  muffle: true,
  pauseBeforeDrop: true,
  bassBoost: true,
})

export const uid = () => Math.random().toString(36).slice(2, 10)
