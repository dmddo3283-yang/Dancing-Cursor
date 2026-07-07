# Mirrorball Cursor 🪩

소리를 감지하면 **마우스 포인터가 미러볼(디스코 볼)로 바뀌면서 빛을 뿜는** Chrome 확장 프로그램입니다.
[Dancing Chrome](https://github.com/dmddo3283-yang/Dancing-Chrome)과 **동일한 방식**(화면·탭 오디오 캡처 → Web Audio 분석 → 비트 감지)으로 소리를 감지하므로, 두 확장을 **함께 켜 두면** 노래에 맞춰 Chrome 창은 춤추고 커서는 미러볼로 반짝입니다.

## 동작 방식

- `desktopCapture`로 화면/탭의 오디오 스트림을 받아 **offscreen 문서**에서 Web Audio `AnalyserNode`로 분석합니다.
- Dancing Chrome과 같은 `BeatDetector`가 34ms마다 `{ energy, bass, flux, beat }` 프레임을 만듭니다.
- 서비스 워커가 이 프레임을 각 창의 활성 탭으로 중계하고, content script가 마우스를 따라다니는 미러볼을 그립니다.
- 소리가 커질수록 광선·발광이 강해지고, **비트마다** 미러볼이 튀며 반짝임이 사방으로 흩어집니다.
- 소리가 멈추면 미러볼이 사라지고 일반 커서로 돌아옵니다.

## 설치 (개발자 모드)

1. Chrome 주소창에 `chrome://extensions` 입력
2. 우측 상단 **개발자 모드** 켜기
3. **압축해제된 확장 프로그램을 로드** 클릭 → 이 폴더(`mirrorball`) 선택
4. 툴바에 🪩 아이콘이 나타납니다.

## 사용법

1. 툴바의 Mirrorball Cursor 아이콘 클릭 → **소리 연결하기**
2. 공유 창에서 **전체 화면**(또는 특정 탭)을 고르고 **오디오 공유**를 꼭 체크
3. 노래를 재생하면, 마우스를 움직일 때 커서가 미러볼로 바뀌며 빛을 뿜습니다.
4. 끄려면 팝업에서 **끄기**를 누르거나 단축키 **Alt+Shift+M**

### 설정 (팝업)

| 항목 | 설명 |
| --- | --- |
| 민감도 | 비트를 얼마나 예민하게 잡을지 (다음 연결부터 적용) |
| 빛 강도 | 광선·발광·반짝임의 세기 (즉시 적용) |
| 미러볼 크기 | 커서 미러볼의 크기 (즉시 적용) |
| 캡처한 소리도 다시 들려주기 | 분석용으로 캡처한 오디오를 스피커로 재생 |

## 알아두기 (기술적 제약)

- 커서 효과는 **일반 웹페이지 안에서만** 나타납니다. 주소창·툴바·`chrome://` 페이지·다른 앱 위에서는 Chrome 확장이 커서를 바꿀 수 없습니다.
- 이미 열려 있던 탭은 확장 설치·재로드 후 **한 번 새로고침**해야 커서가 적용됩니다.
- 교차 출처 `<iframe>` 위에서는 마우스 이벤트가 상위 문서로 전달되지 않아 미러볼이 잠시 멈출 수 있습니다.
- 소리 감지는 Dancing Chrome과 별개로 각자 캡처합니다. 두 확장 모두 "오디오 공유"를 체크해 각각 연결하면 됩니다.

## 폴더 구조

```
manifest.json
icons/                     아이콘 (스크립트로 생성)
scripts/make-icons.mjs     아이콘 PNG 생성기 (node)
src/
  shared/    messages.js, settings.js
  offscreen/ audio-engine.js, beat-detector.js, offscreen.html   # 오디오 캡처·분석
  capture/   capture.html/js/css                                  # 화면·오디오 소스 선택
  background/service-worker.js                                    # 캡처 수명주기 + 프레임 중계
  content/   mirrorball.js, mirrorball.css                        # 미러볼 커서 렌더링
  popup/     popup.html/js/css                                    # 켜기/끄기 + 설정
```

아이콘을 다시 만들려면: `node scripts/make-icons.mjs`
