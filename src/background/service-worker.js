import { Message } from "../shared/messages.js";
import { DEFAULT_SETTINGS, normalizeSettings } from "../shared/settings.js";

const OFFSCREEN_PATH = "src/offscreen/offscreen.html";
const CAPTURE_PATH = "src/capture/capture.html";

// 현재 캡처 세션 상태. 서비스 워커는 언제든 종료·재시작될 수 있으므로
// "확실한" 상태는 offscreen 문서의 존재 여부로 판단하고, 아래 값은 캐시로만 쓴다.
const state = {
  active: false,
  settings: { ...DEFAULT_SETTINGS },
  lastFrame: null
};

// 프레임을 보낼 대상(각 창의 활성 탭) 캐시. 34ms마다 tabs.query를 돌리면 무거우므로
// 탭/창 이벤트로만 갱신한다.
let activeTabIds = new Set();

init();

async function init() {
  const stored = await chrome.storage.local.get("settings");
  state.settings = normalizeSettings(stored.settings ?? DEFAULT_SETTINGS);
  await refreshActiveTabs();
}

// ---- 메시지 라우팅 --------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message?.type) {
    case Message.GET_STATE:
      sendResponse({ active: state.active, settings: state.settings });
      return false;

    case Message.SAVE_SETTINGS:
      saveSettings(message.settings).then(() => sendResponse({ ok: true }));
      return true;

    case Message.START_CAPTURE:
      startCapture(message).then(sendResponse).catch((error) => {
        sendResponse({ ok: false, error: readable(error) });
      });
      return true;

    case Message.STOP:
      stopCapture("사용자가 중지했습니다.").then(() => sendResponse({ ok: true }));
      return true;

    case Message.AUDIO_FRAME:
      // 서비스 워커가 유휴 상태로 재시작되어도 프레임이 오면 활성으로 복구한다.
      if (!state.active) {
        state.active = true;
        broadcastState();
      }
      onAudioFrame(message.frame);
      return false;

    case Message.CAPTURE_STARTED:
      state.active = true;
      broadcastState();
      return false;

    case Message.AUDIO_STOPPED:
      finishStop();
      return false;

    default:
      return false;
  }
});

// 툴바 아이콘 대신 단축키(Alt+Shift+M)로 켜고 끄기
chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-mirrorball") return;
  if (state.active) {
    stopCapture("단축키로 중지했습니다.");
  } else {
    openCaptureTab();
  }
});

// ---- 캡처 수명주기 --------------------------------------------------------

async function startCapture({ streamId, source = "desktop", settings }) {
  if (settings) state.settings = normalizeSettings(settings);

  await ensureOffscreen();

  const response = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: Message.START_CAPTURE,
    streamId,
    source,
    sensitivity: state.settings.sensitivity,
    playThrough: state.settings.playThrough
  });

  if (!response?.ok) {
    await closeOffscreen();
    return { ok: false, error: response?.error || "오디오 연결을 시작하지 못했습니다." };
  }

  state.active = true;
  await refreshActiveTabs();
  broadcastState();
  return { ok: true };
}

async function stopCapture(reason) {
  if (await hasOffscreen()) {
    await chrome.runtime
      .sendMessage({ target: "offscreen", type: Message.STOP })
      .catch(() => {});
  }
  finishStop();
}

function finishStop() {
  state.active = false;
  state.lastFrame = null;
  broadcastState();
  closeOffscreen();
}

async function onAudioFrame(frame) {
  if (!frame) return;
  state.lastFrame = frame;
  const payload = {
    type: Message.MIRRORBALL_FRAME,
    frame,
    intensity: state.settings.intensity,
    size: state.settings.size
  };
  for (const tabId of activeTabIds) {
    chrome.tabs.sendMessage(tabId, payload).catch(() => {});
  }
}

// ---- 상태 브로드캐스트 ----------------------------------------------------

function broadcastState() {
  const payload = {
    type: Message.MIRRORBALL_STATE,
    active: state.active,
    intensity: state.settings.intensity,
    size: state.settings.size
  };
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id != null) chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
    }
  });
}

async function saveSettings(raw) {
  state.settings = normalizeSettings(raw);
  await chrome.storage.local.set({ settings: state.settings });
  if (state.active) broadcastState(); // intensity·size는 즉시 반영
}

// ---- 활성 탭 캐시 ---------------------------------------------------------

async function refreshActiveTabs() {
  try {
    const tabs = await chrome.tabs.query({ active: true });
    activeTabIds = new Set(tabs.map((t) => t.id).filter((id) => id != null));
  } catch {
    activeTabIds = new Set();
  }
}

chrome.tabs.onActivated.addListener(refreshActiveTabs);
chrome.windows.onFocusChanged.addListener(refreshActiveTabs);
chrome.tabs.onRemoved.addListener(refreshActiveTabs);
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") refreshActiveTabs();
  // 새로 로드된 탭의 content script에 현재 상태를 알려 준다.
  if (changeInfo.status === "complete" && state.active && tab?.id != null) {
    chrome.tabs
      .sendMessage(tab.id, {
        type: Message.MIRRORBALL_STATE,
        active: true,
        intensity: state.settings.intensity,
        size: state.settings.size
      })
      .catch(() => {});
  }
});

// ---- offscreen 문서 관리 --------------------------------------------------

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ["USER_MEDIA"],
    justification: "탭·화면 오디오를 분석해 미러볼 커서를 소리에 반응시킵니다."
  });
}

async function hasOffscreen() {
  if (chrome.offscreen?.hasDocument) {
    return chrome.offscreen.hasDocument();
  }
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"]
  });
  return contexts.length > 0;
}

async function closeOffscreen() {
  if (await hasOffscreen()) {
    await chrome.offscreen.closeDocument().catch(() => {});
  }
}

// ---- 캡처 시작 탭 열기 -----------------------------------------------------

async function openCaptureTab() {
  const url = chrome.runtime.getURL(CAPTURE_PATH);
  await chrome.tabs.create({ url });
}

function readable(error) {
  return error instanceof Error ? error.message : String(error);
}
