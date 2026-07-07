import { Message } from "../shared/messages.js";
import { DEFAULT_SETTINGS, normalizeSettings } from "../shared/settings.js";

const elements = {
  powerButton: document.querySelector("#powerButton"),
  statusBadge: document.querySelector("#statusBadge"),
  statusText: document.querySelector("#statusText"),
  lightName: document.querySelector("#lightName"),
  meter: [...document.querySelectorAll(".meter span")],
  intensity: document.querySelector("#intensity"),
  sensitivity: document.querySelector("#sensitivity"),
  size: document.querySelector("#size")
};

let state = { enabled: false, status: "idle", level: 0, error: null, source: null };
let saveTimer;

await refresh();
setInterval(refresh, 450);

elements.powerButton.addEventListener("click", async () => {
  if (state.enabled) {
    setBusy("미러볼을 끄는 중…");
    await send({ type: Message.STOP });
    await refresh();
    return;
  }
  await startTabCapture();
});

// 버튼 한 번으로 현재 탭 소리에 바로 연결 (추가 탭·선택 창 없음)
async function startTabCapture() {
  setBusy("현재 탭의 사운드에 연결 중…");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    const response = await send({
      type: Message.START_CAPTURE,
      streamId,
      source: "tab",
      settings: readSettings()
    });
    showResponse(response);
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
  await refresh();
}

for (const input of document.querySelectorAll("input")) {
  input.addEventListener("input", () => {
    syncLabels();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => send({
      type: Message.SAVE_SETTINGS,
      settings: readSettings()
    }), 120);
  });
}

async function refresh() {
  const response = await send({ type: Message.GET_STATE });
  if (!response?.ok) return;
  state = response.state;
  if (!document.activeElement?.matches("input")) writeSettings(response.settings);
  renderState();
}

function renderState() {
  const running = state.enabled && ["starting", "running"].includes(state.status);
  elements.powerButton.classList.toggle("running", running);
  elements.powerButton.querySelector("strong").textContent = running ? "STOP" : "START";
  elements.powerButton.querySelector("small").textContent = "현재 탭 사운드";
  elements.statusBadge.dataset.state = running ? "running" : "idle";
  elements.statusBadge.querySelector("b").textContent = running ? "LIVE" : "OFF";

  if (state.error) {
    showError(state.error);
  } else if (state.status === "running") {
    elements.statusText.classList.remove("error");
    elements.statusText.textContent = "소리 감지 중 — 커서가 미러볼로 빛나고 있어요.";
  } else if (state.status === "starting") {
    setBusy("오디오에 연결 중…");
  } else {
    elements.statusText.classList.remove("error");
    elements.statusText.textContent = "준비 완료 — 이 탭에서 음악을 틀어주세요.";
  }

  const activeBars = Math.round((state.level || 0) * elements.meter.length);
  elements.meter.forEach((bar, index) => {
    bar.classList.toggle("active", index < activeBars);
    bar.style.height = `${5 + Math.min(index, activeBars) * 1.4}px`;
  });
}

function readSettings() {
  return normalizeSettings({
    intensity: elements.intensity.value,
    sensitivity: elements.sensitivity.value,
    size: elements.size.value
  });
}

function writeSettings(settings = DEFAULT_SETTINGS) {
  const normalized = normalizeSettings(settings);
  elements.intensity.value = normalized.intensity;
  elements.sensitivity.value = normalized.sensitivity;
  elements.size.value = normalized.size;
  syncLabels();
}

function syncLabels() {
  for (const key of ["intensity", "sensitivity", "size"]) {
    document.querySelector(`#${key}Value`).textContent = elements[key].value;
  }
  const value = Number(elements.intensity.value);
  elements.lightName.textContent = value >= 88 ? "BLAZE" : value >= 65 ? "DAZZLE" : value >= 30 ? "SHINE" : "GLOW";
}

function setBusy(text) {
  elements.statusText.classList.remove("error");
  elements.statusText.textContent = text;
}

function showResponse(response) {
  if (response?.ok || response?.cancelled) return;
  showError(response?.error || "시작하지 못했습니다.");
}

function showError(message) {
  elements.statusText.classList.add("error");
  elements.statusText.textContent = message;
}

async function send(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
