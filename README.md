# Mirrorball Cursor 🪩

소리를 감지하면 **마우스 포인터가 미러볼(디스코 볼)로 바뀌면서 빛을 뿜는** Chrome 확장 프로그램입니다.
[Dancing Chrome](https://github.com/dmddo3283-yang/Dancing-Chrome)과 **동일한 방식**(화면·탭 오디오 캡처 → Web Audio 분석 → 비트 감지)으로 소리를 감지하므로, 두 확장을 **함께 켜 두면** 노래에 맞춰 Chrome 창은 춤추고 커서는 미러볼로 반짝입니다.

<p align="center">
  <a href="https://github.com/dmddo3283-yang/Dancing-Cursor/archive/refs/heads/main.zip">
    <img src="https://img.shields.io/badge/⬇_다운로드-Mirrorball_Cursor-6ea8ff?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Mirrorball Cursor 다운로드" />
  </a>
</p>

## 동작 방식

- `tabCapture`로 **현재 탭**의 오디오 스트림을 받아 **offscreen 문서**에서 Web Audio `AnalyserNode`로 분석합니다.
- Dancing Chrome과 같은 `BeatDetector`가 34ms마다 `{ energy, bass, flux, beat }` 프레임을 만듭니다.
- 서비스 워커가 이 프레임을 각 창의 활성 탭으로 중계하고, content script가 마우스를 따라다니는 미러볼을 그립니다.
- 소리가 커질수록 광선·발광이 강해지고, **비트마다** 미러볼이 튀며 반짝임이 사방으로 흩어집니다.
- **소리가 감지되는 동안에만** 기본 커서가 미러볼로 바뀌고, 조용해지면 다시 평소 커서로 돌아옵니다.

## 설치 (개발자 모드)

1. Chrome 주소창에 `chrome://extensions` 입력
2. 우측 상단 **개발자 모드** 켜기
3. **압축해제된 확장 프로그램을 로드** 클릭 → 이 폴더(`mirrorball`) 선택
4. 툴바에 🪩 아이콘이 나타납니다.

## 사용법

1. 이 탭에서 음악을 재생합니다.
2. 툴바의 Mirrorball Cursor 아이콘을 클릭하고 가운데 **START** 버튼을 누릅니다 — **바로** 현재 탭 소리에 연결됩니다. (선택 창·추가 탭 없음)
3. 마우스를 움직이면 커서가 미러볼로 바뀌며 빛을 뿜습니다.
4. 끄려면 **STOP** 버튼을 누르거나 단축키 **Alt+Shift+M** (켜기·끄기 모두 가능).

### 설정 (팝업)

| 항목 | 설명 |
| --- | --- |
| 빛 강도 | 광선·발광·반짝임의 세기 (즉시 적용) |
| 감도 | 비트를 얼마나 예민하게 잡을지 (다음 연결부터 적용) |
| 미러볼 크기 | 커서 미러볼의 크기 (즉시 적용) |
