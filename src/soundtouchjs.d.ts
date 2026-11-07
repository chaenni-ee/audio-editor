declare module 'soundtouchjs' {
  export class SoundTouch {
    pitchSemitones: number
    tempo: number
    rate: number
  }
  export class SimpleFilter {
    constructor(source: { extract(target: Float32Array, numFrames: number, position: number): number }, pipe: SoundTouch)
    extract(target: Float32Array, numFrames: number): number
  }
}
