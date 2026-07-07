// 확장 내부 컨텍스트(서비스 워커 / offscreen / capture / content / popup)들이
// 주고받는 메시지 타입 상수. Dancing Chrome과 동일한 오디오 파이프라인 명칭을 따른다.
export const Message = Object.freeze({
  GET_STATE: "GET_STATE",
  SAVE_SETTINGS: "SAVE_SETTINGS",
  START_CAPTURE: "START_CAPTURE",
  CAPTURE_STARTED: "CAPTURE_STARTED",
  CAPTURE_ERROR: "CAPTURE_ERROR",
  STOP: "STOP",
  AUDIO_FRAME: "AUDIO_FRAME",
  AUDIO_STOPPED: "AUDIO_STOPPED",
  // 미러볼 커서 전용
  MIRRORBALL_STATE: "MIRRORBALL_STATE",
  MIRRORBALL_FRAME: "MIRRORBALL_FRAME"
});
