# 🎵 음원 편집기

브라우저에서 바로 쓰는 음원 편집 웹앱입니다. 파일은 서버로 전송되지 않고 내 컴퓨터(브라우저)에서만 처리됩니다.

## 기능

- **불러오기**: mp3 / wav / m4a / ogg / flac 등 드래그&드롭 또는 파일 선택 (여러 개 한 번에)
- **자르기**: 파형 위 노란 구간의 양 끝을 끌어서 사용할 범위 지정, 재생 위치에서 클립 나누기
- **페이드 인 / 아웃**, **클립별 볼륨**
- **🎤 키 조절**: 빠르기는 그대로 두고 음높이만 반음 단위로 ±6키 (축가 MR 키 맞추기)
- **이어 붙이기**: 타임라인에서 끌어서 순서 변경, 복제, 삭제
- **🔁 인트로 늘리기** (사회자 멘트용): 노래가 터지는 지점과 빠르기(BPM)를 자동으로 찾아, 인트로 일부를 마디 단위로 반복해서 원하는 길이로 늘림
- **크로스페이드**: 앞 곡이 작아지는 동안 다음 곡이 겹치며 커짐 (등전력 곡선)
- **💥 빌드업 효과**: 잔잔하게 시작해서 클라이맥스에서 팡 터뜨리기
  - 방식 선택: 점점 커지게 / 작은 볼륨을 쭉 유지하다가 팡
  - 작은 볼륨에서 점점 커지는 크레센도
  - 먹먹하게 시작해서 점점 선명해지는 필터
  - 터지기 직전 짧은 정적
  - 터진 뒤 저음 강조
  - 💒 결혼식 입장 프리셋 / 파형 위 빨간 선으로 클라이맥스 지점 조절
- **실행 취소 / 다시 실행** (Ctrl+Z / Ctrl+Shift+Z)
- **MP3 다운로드**: 128 / 192 / 320kbps

## 실행

```bash
npm install
npm run dev      # 개발 서버 (http://localhost:5173)
npm run build    # dist/ 에 정적 파일 생성 → Vercel, Netlify, GitHub Pages 등에 그대로 배포
```

## 배포

`master` 브랜치에 푸시하면 GitHub Actions가 자동으로 빌드해서 GitHub Pages에 배포합니다
(`.github/workflows/deploy.yml`). 처음 한 번은 저장소 **Settings → Pages → Source**를 **GitHub Actions**로 설정해야 합니다.

## 구조

| 파일 | 역할 |
|---|---|
| `src/audio/render.ts` | 클립 배치(크로스페이드 겹침), 페이드·빌드업 효과, OfflineAudioContext로 합치기 |
| `src/audio/loop-core.ts`, `loop.ts` | 빠르기·박 위치·터지는 지점 감지, 마디 맞춤, 인트로 늘리기 |
| `src/audio/pitch-core.ts`, `pitch.worker.ts` | SoundTouch로 키 변환 (Web Worker, 결과는 캐시) |
| `src/audio/mp3.worker.ts` | lamejs로 MP3 인코딩 (Web Worker) |
| `src/components/ClipEditor.tsx` | 파형(wavesurfer.js), 구간 선택, 효과 설정 |
| `src/components/Timeline.tsx` | 클립 순서 및 전체 배치 |
| `src/components/MixPanel.tsx` | 전체 미리듣기, MP3 내보내기 |
| `src/history.ts` | 실행 취소 / 다시 실행 |

원본 오디오는 수정하지 않고 "어느 구간을 어떤 효과로 쓸지"만 저장하는 비파괴 편집 방식입니다.

## 사용한 라이브러리

- [wavesurfer.js](https://wavesurfer.xyz) (BSD-3-Clause): 파형 표시
- [lamejs](https://github.com/zhuker/lamejs) (LGPL-3.0, `@breezystack/lamejs`): MP3 인코딩
- [SoundTouchJS](https://github.com/cutterbl/SoundTouchJS) (LGPL-2.1): 키 변환
