// 확장 내부 컨텍스트(서비스 워커 / content / popup)들이 주고받는 메시지 타입 상수.
export const Message = Object.freeze({
  GET_STATE: "GET_STATE",
  SAVE_SETTINGS: "SAVE_SETTINGS",
  START: "START", // 미러볼 커서 켜기
  STOP: "STOP", // 끄기
  // 서비스 워커 → content: 활성 상태·설정 전달
  MIRRORBALL_STATE: "MIRRORBALL_STATE",
  // content → 서비스 워커: 팝업 미터용 현재 음량 보고
  MIRRORBALL_LEVEL: "MIRRORBALL_LEVEL"
});
