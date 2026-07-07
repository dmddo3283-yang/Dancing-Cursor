import { Message } from "../shared/messages.js";
import { DEFAULT_SETTINGS, normalizeSettings } from "../shared/settings.js";

const CAPTURE_PATH = "src/capture/capture.html";

const statusEl = document.querySelector("#status");
const toggleBtn = document.querySelector("#toggle");
const hintEl = document.querySelector("#hint");

const inputs = {
  sensitivity: document.querySelector("#sensitivity"),
  intensity: document.querySelector("#intensity"),
  size: document.querySelector("#size"),
  playThrough: document.querySelector("#playThrough")
};
const valueLabels = {
  sensitivity: document.querySelector("#sensitivityVal"),
  intensity: document.querySelector("#intensityVal"),
  size: document.querySelector("#sizeVal")
};

let active = false;
let settings = { ...DEFAULT_SETTINGS };

init();

async function init() {
  const state = await sendMessage({ type: Message.GET_STATE }).catch(() => null);
  if (state) {
    active = Boolean(state.active);
    settings = normalizeSettings(state.settings ?? DEFAULT_SETTINGS);
  } else {
    const stored = await chrome.storage.local.get("settings");
    settings = normalizeSettings(stored.settings ?? DEFAULT_SETTINGS);
  }
  reflectSettings();
  reflectActive();
}

toggleBtn.addEventListener("click", async () => {
  if (active) {
    await sendMessage({ type: Message.STOP }).catch(() => {});
    active = false;
    reflectActive();
  } else {
    await chrome.tabs.create({ url: chrome.runtime.getURL(CAPTURE_PATH) });
    window.close();
  }
});

for (const key of ["sensitivity", "intensity", "size"]) {
  inputs[key].addEventListener("input", () => {
    settings[key] = Number(inputs[key].value);
    valueLabels[key].textContent = settings[key];
    persist();
  });
}
inputs.playThrough.addEventListener("change", () => {
  settings.playThrough = inputs.playThrough.checked;
  persist();
});

function persist() {
  settings = normalizeSettings(settings);
  sendMessage({ type: Message.SAVE_SETTINGS, settings }).catch(() => {
    chrome.storage.local.set({ settings });
  });
}

function reflectSettings() {
  for (const key of ["sensitivity", "intensity", "size"]) {
    inputs[key].value = String(settings[key]);
    valueLabels[key].textContent = settings[key];
  }
  inputs.playThrough.checked = settings.playThrough;
}

function reflectActive() {
  statusEl.textContent = active ? "켜짐 — 소리에 반응 중" : "꺼짐";
  statusEl.className = active ? "status-on" : "status-off";
  toggleBtn.textContent = active ? "끄기" : "소리 연결하기";
  toggleBtn.classList.toggle("stop", active);
  hintEl.style.display = active ? "none" : "";
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(response);
    });
  });
}
