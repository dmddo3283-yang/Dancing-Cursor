import { Message } from "../shared/messages.js";
import { DEFAULT_SETTINGS, normalizeSettings } from "../shared/settings.js";

// 데스크톱 미디어 선택 창을 띄우고, 얻은 streamId를 서비스 워커로 넘겨 캡처를 시작한다.
// chooseDesktopMedia는 확장 페이지의 사용자 제스처 컨텍스트에서 호출해야 하므로 별도 탭에서 실행한다.
const messageElement = document.querySelector("#message");
const chooseButton = document.querySelector("#chooseButton");

chooseButton.addEventListener("click", chooseAndStart);

async function chooseAndStart() {
  chooseButton.disabled = true;
  chooseButton.textContent = "선택 창 여는 중…";
  messageElement.className = "";
  messageElement.innerHTML = "공유 창에서 <b>전체 화면</b>과 <b>오디오 공유</b>를 선택하세요.";

  const selection = await chooseDesktopMedia();
  if (selection.error) return showError(selection.error);
  if (!selection.streamId) return showError("선택이 취소되었습니다. 다시 시도할 수 있습니다.");
  if (!selection.canRequestAudioTrack) {
    return showError("오디오가 공유되지 않았습니다. '오디오 공유'를 체크해 주세요.");
  }

  const stored = await chrome.storage.local.get("settings");
  const response = await chrome.runtime.sendMessage({
    type: Message.START_CAPTURE,
    streamId: selection.streamId,
    source: "desktop",
    settings: normalizeSettings(stored.settings ?? DEFAULT_SETTINGS)
  });

  if (!response?.ok) return showError(response?.error || "소리 연결을 시작하지 못했습니다.");

  messageElement.className = "success";
  messageElement.textContent = "연결 완료! 소리가 나면 커서가 미러볼로 바뀝니다.";
  chooseButton.hidden = true;
  setTimeout(() => window.close(), 900);
}

function chooseDesktopMedia() {
  return new Promise((resolve) => {
    chrome.desktopCapture.chooseDesktopMedia(
      ["screen", "tab", "window", "audio"],
      (streamId, options = {}) => {
        const error = chrome.runtime.lastError?.message;
        resolve({
          streamId: streamId || "",
          canRequestAudioTrack: Boolean(options.canRequestAudioTrack),
          error: error || null
        });
      }
    );
  });
}

function showError(message) {
  messageElement.className = "error";
  messageElement.textContent = message;
  chooseButton.disabled = false;
  chooseButton.textContent = "다시 선택";
}
