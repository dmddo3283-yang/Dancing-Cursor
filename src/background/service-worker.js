import { Message } from "../shared/messages.js";
import { DEFAULT_SETTINGS, normalizeSettings } from "../shared/settings.js";

// Dancing Cursor는 탭 오디오를 캡처하지 않는다. 대신 각 탭의 content script가
// 페이지의 미디어 요소를 captureStream()으로 직접 분석한다. 따라서 Dancing Chrome의
// 탭 캡처와 충돌하지 않고 동시에 사용할 수 있다.
// 서비스 워커는 켜짐/꺼짐 상태와 설정만 관리하고, content script를 활성 탭에 주입한다.
const state = {
  enabled: false,
  status: "idle", // idle | running
  level: 0, // 팝업 미터용 음량 (0~1), content가 보고
  error: null,
  settings: { ...DEFAULT_SETTINGS }
};

init();

async function init() {
  const stored = await chrome.storage.local.get("settings");
  state.settings = normalizeSettings(stored.settings ?? DEFAULT_SETTINGS);
}

// ---- 메시지 라우팅 --------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message?.type) {
    case Message.GET_STATE:
      sendResponse({
        ok: true,
        state: { enabled: state.enabled, status: state.status, level: state.level, error: state.error },
        settings: state.settings
      });
      return false;

    case Message.SAVE_SETTINGS:
      saveSettings(message.settings).then(() => sendResponse({ ok: true }));
      return true;

    case Message.START:
      start().then(sendResponse).catch((error) => sendResponse({ ok: false, error: readable(error) }));
      return true;

    case Message.STOP:
      stop().then(() => sendResponse({ ok: true }));
      return false;

    case Message.MIRRORBALL_LEVEL:
      if (state.enabled) state.level = Number(message.value) || 0;
      return false;

    default:
      return false;
  }
});

// 단축키(Alt+Shift+M): 켜기/끄기
chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-mirrorball") return;
  if (state.enabled) stop();
  else start();
});

// ---- 켜기/끄기 ------------------------------------------------------------

async function start() {
  state.enabled = true;
  state.status = "running";
  state.error = null;
  state.level = 0;
  await ensureContentInActiveTabs();
  broadcastState();
  return { ok: true };
}

async function stop() {
  state.enabled = false;
  state.status = "idle";
  state.level = 0;
  broadcastState();
}

function broadcastState() {
  const payload = {
    type: Message.MIRRORBALL_STATE,
    active: state.enabled,
    sensitivity: state.settings.sensitivity,
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
  if (state.enabled) broadcastState(); // 설정 즉시 반영
}

// ---- content script 주입 --------------------------------------------------

async function injectContent(tabId) {
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["src/content/mirrorball.css"] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["src/content/mirrorball.js"] });
  } catch {
    // chrome://, 웹 스토어 등 주입 불가 페이지 — 무시.
  }
}

async function ensureContentInActiveTabs() {
  const tabs = await chrome.tabs.query({ active: true }).catch(() => []);
  await Promise.all(tabs.map((t) => (t.id != null ? injectContent(t.id) : null)));
}

// 탭을 전환하면 그 탭에도 주입하고 현재 상태를 알린다.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  if (!state.enabled || tabId == null) return;
  await injectContent(tabId);
  chrome.tabs
    .sendMessage(tabId, {
      type: Message.MIRRORBALL_STATE,
      active: true,
      sensitivity: state.settings.sensitivity,
      intensity: state.settings.intensity,
      size: state.settings.size
    })
    .catch(() => {});
});

// 새로 로드된 탭에도 현재 상태 전달 (선언형 content script가 이미 주입되어 있음)
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete" && state.enabled && tabId != null) {
    chrome.tabs
      .sendMessage(tabId, {
        type: Message.MIRRORBALL_STATE,
        active: true,
        sensitivity: state.settings.sensitivity,
        intensity: state.settings.intensity,
        size: state.settings.size
      })
      .catch(() => {});
  }
});

function readable(error) {
  return error instanceof Error ? error.message : String(error);
}
