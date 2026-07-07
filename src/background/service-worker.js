import { Message } from "../shared/messages.js";
import { DEFAULT_SETTINGS, normalizeSettings } from "../shared/settings.js";

const OFFSCREEN_PATH = "src/offscreen/offscreen.html";

// 현재 세션 상태. 팝업이 450ms마다 GET_STATE로 폴링해 미터·버튼을 갱신한다.
const state = {
  enabled: false,
  status: "idle", // idle | starting | running
  level: 0, // 현재 음량 (0~1)
  error: null,
  source: null, // "tab"
  settings: { ...DEFAULT_SETTINGS }
};

// 프레임을 보낼 대상(각 창의 활성 탭) 캐시.
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
      sendResponse({
        ok: true,
        state: {
          enabled: state.enabled,
          status: state.status,
          level: state.level,
          error: state.error,
          source: state.source
        },
        settings: state.settings
      });
      return false;

    case Message.SAVE_SETTINGS:
      saveSettings(message.settings).then(() => sendResponse({ ok: true }));
      return true;

    case Message.START_CAPTURE:
      startCapture(message).then(sendResponse).catch((error) => {
        state.status = "idle";
        state.error = readable(error);
        sendResponse({ ok: false, error: state.error });
      });
      return true;

    case Message.STOP:
      stopCapture("사용자가 중지했습니다.").then(() => sendResponse({ ok: true }));
      return true;

    case Message.AUDIO_FRAME:
      // 서비스 워커가 유휴 상태로 재시작되어도 프레임이 오면 활성으로 복구한다.
      if (!state.enabled) {
        state.enabled = true;
        state.status = "running";
        broadcastState();
      }
      onAudioFrame(message.frame);
      return false;

    case Message.CAPTURE_STARTED:
      state.enabled = true;
      state.status = "running";
      state.error = null;
      broadcastState();
      return false;

    case Message.AUDIO_STOPPED:
      state.error = message.reason && !/사용자/.test(message.reason) ? message.reason : null;
      finishStop();
      return false;

    default:
      return false;
  }
});

// 단축키(Alt+Shift+M): 팝업 없이도 현재 탭 소리에 바로 연결/해제
chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-mirrorball") return;
  if (state.enabled) {
    stopCapture("단축키로 중지했습니다.");
  } else {
    startTabCaptureFromActiveTab();
  }
});

// ---- 캡처 수명주기 --------------------------------------------------------

// 팝업/단축키 공통: streamId를 offscreen에 넘겨 분석을 시작한다.
async function startCapture({ streamId, source = "tab", settings }) {
  if (settings) state.settings = normalizeSettings(settings);
  state.status = "starting";
  state.error = null;

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
    state.status = "idle";
    state.error = response?.error || "소리 연결을 시작하지 못했습니다.";
    return { ok: false, error: state.error };
  }

  state.enabled = true;
  state.status = "running";
  state.source = source;
  await refreshActiveTabs();
  broadcastState();
  return { ok: true };
}

// 단축키 경로: 서비스 워커가 직접 활성 탭의 streamId를 얻어 시작한다.
async function startTabCaptureFromActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("활성 탭을 찾지 못했습니다.");
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    await startCapture({ streamId, source: "tab", settings: state.settings });
  } catch (error) {
    state.status = "idle";
    state.error = readable(error);
  }
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
  state.enabled = false;
  state.status = "idle";
  state.level = 0;
  state.source = null;
  broadcastState();
  closeOffscreen();
}

function onAudioFrame(frame) {
  if (!frame) return;
  // 미터용 음량을 부드럽게 추적
  state.level = state.level * 0.6 + (frame.energy || 0) * 0.4;

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
    active: state.enabled,
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
  if (state.enabled) broadcastState(); // intensity·size는 즉시 반영
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
  if (changeInfo.status === "complete" && state.enabled && tab?.id != null) {
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
    justification: "탭 오디오를 분석해 미러볼 커서를 소리에 반응시킵니다."
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

function readable(error) {
  return error instanceof Error ? error.message : String(error);
}
