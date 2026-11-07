let ctx: AudioContext | null = null

/** 앱 전체에서 하나만 쓰는 AudioContext (디코딩·효과 미리듣기) */
export const audioCtx = () => (ctx ??= new AudioContext())
