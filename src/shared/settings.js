// 사용자 설정 기본값과 정규화. 값 범위를 벗어난 저장값도 안전하게 보정한다.
export const DEFAULT_SETTINGS = Object.freeze({
  sensitivity: 55, // 비트 감지 민감도 (0~100)
  intensity: 65, // 빛·반짝임 강도 (0~100)
  size: 60, // 미러볼 크기 (0~100)
  playThrough: false // 캡처한 소리를 다시 재생할지 여부
});

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeSettings(raw = {}) {
  return {
    sensitivity: clampInt(raw.sensitivity, 0, 100, DEFAULT_SETTINGS.sensitivity),
    intensity: clampInt(raw.intensity, 0, 100, DEFAULT_SETTINGS.intensity),
    size: clampInt(raw.size, 0, 100, DEFAULT_SETTINGS.size),
    playThrough: Boolean(raw.playThrough)
  };
}
