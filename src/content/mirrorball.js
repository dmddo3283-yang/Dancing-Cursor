// 미러볼 커서 content script.
// 탭 캡처(tabCapture) 대신, 이 페이지의 미디어 요소(<video>/<audio>)를 captureStream()으로
// 비침습적으로 tap 해서 Web Audio로 분석한다. 덕분에 Dancing Chrome의 탭 캡처와 충돌하지 않아
// 두 확장을 동시에 켤 수 있다. 분석·렌더링 모두 이 스크립트 안에서 처리한다.
(() => {
  // 선언형 주입과 서비스 워커의 프로그램적 주입이 겹칠 수 있으므로 중복 실행 방지.
  if (window.__mirrorballCursorLoaded) return;
  window.__mirrorballCursorLoaded = true;

  const Message = {
    GET_STATE: "GET_STATE",
    MIRRORBALL_STATE: "MIRRORBALL_STATE",
    MIRRORBALL_LEVEL: "MIRRORBALL_LEVEL"
  };

  const SPARK_POOL_SIZE = 20;
  const SOUND_ON = 0.06; // 이 이상의 음량이면 "소리 있음"으로 판정
  const SOUND_HOLD_MS = 900; // 마지막 소리 이후 이 시간까지는 미러볼 유지

  // ---- 비트 감지기 (Dancing Chrome과 동일한 알고리즘, 인라인) ----
  class BeatDetector {
    constructor({ sampleRate = 48000, fftSize = 2048 } = {}) {
      this.sampleRate = sampleRate;
      this.fftSize = fftSize;
      this.previousSpectrum = null;
      this.energyAverage = 0.02;
      this.fluxAverage = 0.005;
      this.lastBeatAt = 0;
    }
    analyse(timeData, frequencyData, now, sensitivity = 55) {
      const rms = calcRms(timeData);
      const bass = calcBand(frequencyData, this.sampleRate, this.fftSize, 45, 190);
      const flux = calcFlux(frequencyData, this.previousSpectrum);
      this.previousSpectrum = Uint8Array.from(frequencyData);
      this.energyAverage = lerp(this.energyAverage, rms, 0.045);
      this.fluxAverage = lerp(this.fluxAverage, flux, 0.075);
      const sScale = 1.8 - sensitivity / 100;
      const onset = Math.max(0.004, this.fluxAverage * (1.2 + sScale * 0.62));
      const gate = Math.max(0.012, this.energyAverage * (0.85 + sScale * 0.22));
      const cooldown = 150 + (1 - sensitivity / 100) * 120;
      const beat = now - this.lastBeatAt >= cooldown && flux > onset && rms > gate;
      if (beat) this.lastBeatAt = now;
      return { energy: clamp(rms * 2.35, 0, 1), bass: clamp(bass * 1.8, 0, 1), flux: clamp(flux * 7, 0, 1), beat };
    }
  }
  function calcRms(data) {
    let sum = 0;
    for (const v of data) { const s = (v - 128) / 128; sum += s * s; }
    return Math.sqrt(sum / Math.max(1, data.length));
  }
  function calcBand(data, sampleRate, fftSize, lowHz, highHz) {
    const hzPerBin = sampleRate / fftSize;
    const start = Math.max(0, Math.floor(lowHz / hzPerBin));
    const end = Math.min(data.length - 1, Math.ceil(highHz / hzPerBin));
    let sum = 0;
    for (let i = start; i <= end; i += 1) sum += data[i] / 255;
    return sum / Math.max(1, end - start + 1);
  }
  function calcFlux(current, previous) {
    if (!previous) return 0;
    let sum = 0;
    for (let i = 0; i < current.length; i += 1) { const inc = current[i] - previous[i]; if (inc > 0) sum += inc / 255; }
    return sum / current.length;
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  // ---- 상태 ----
  let active = false;
  let sensitivity = 55;
  let intensity = 0.65; // 0~1
  let baseSize = 42;
  let mouseX = -100;
  let mouseY = -100;
  let pointerInside = false;

  let root = null;
  let ball = null;
  let sparks = [];
  let sparkCursor = 0;
  let rafId = 0;

  // 스무딩 값
  let energy = 0;
  let bass = 0;
  let pulse = 0;
  let spin = 0;
  let show = 0;
  let lastLoudAt = 0;
  let target = { energy: 0, bass: 0 };
  let lastLevelSentAt = 0;

  // ---- 오디오 분석 ----
  let audioCtx = null;
  let analyser = null;
  let detector = null;
  let timeData = null;
  let freqData = null;
  const attached = new Map(); // media element -> MediaStreamAudioSourceNode
  let scanTimer = 0;

  // ---- 부팅 ----
  chrome.runtime.sendMessage({ type: Message.GET_STATE }, (res) => {
    if (chrome.runtime.lastError || !res) return;
    const isActive = res.active ?? res.state?.enabled ?? false;
    applyState(isActive, res.settings ?? {});
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === Message.MIRRORBALL_STATE) {
      applyState(message.active, {
        sensitivity: message.sensitivity,
        intensity: message.intensity,
        size: message.size
      });
    }
  });

  function applyState(isActive, settings) {
    if (typeof settings.sensitivity === "number") sensitivity = settings.sensitivity;
    if (typeof settings.intensity === "number") intensity = clamp(settings.intensity / 100, 0, 1);
    if (typeof settings.size === "number") baseSize = 26 + (settings.size / 100) * 54; // 26~80px

    if (isActive && !active) {
      active = true;
      build();
      attachPointerListeners();
      startAudio();
      startLoop();
    } else if (!isActive && active) {
      active = false;
      teardown();
    } else if (active && root) {
      root.style.setProperty("--size", `${baseSize}px`);
    }
  }

  // ---- DOM 구성 ----
  function build() {
    if (root) return;
    root = document.createElement("div");
    root.id = "mirrorball-root";
    root.style.setProperty("--size", `${baseSize}px`);

    const rays = document.createElement("div");
    rays.className = "mb-rays";
    const glow = document.createElement("div");
    glow.className = "mb-glow";
    ball = document.createElement("div");
    ball.className = "mb-ball";
    root.append(rays, glow, ball);

    for (let i = 0; i < SPARK_POOL_SIZE; i += 1) {
      const s = document.createElement("div");
      s.className = "mb-spark";
      root.appendChild(s);
      sparks.push(s);
    }
    mount();
  }

  function mount() {
    const parent = document.body || document.documentElement;
    parent.appendChild(root);
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", () => {
        if (root && document.body && root.parentNode !== document.body) document.body.appendChild(root);
      }, { once: true });
    }
  }

  function teardown() {
    stopLoop();
    stopAudio();
    detachPointerListeners();
    document.documentElement.classList.remove("mirrorball-hide-cursor");
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = ball = null;
    sparks = [];
    energy = bass = pulse = spin = show = 0;
    lastLoudAt = 0;
    target = { energy: 0, bass: 0 };
  }

  // ---- 오디오 그래프 ----
  function startAudio() {
    ensureAudio();
    scanMedia();
    scanTimer = setInterval(() => {
      resumeCtx();
      scanMedia();
    }, 1000);
    // 재생이 시작되는 미디어를 빠르게 붙잡는다.
    document.addEventListener("play", onMediaPlay, true);
    // 사용자 제스처가 있을 때 AudioContext를 깨운다.
    window.addEventListener("pointerdown", resumeCtx, true);
    window.addEventListener("keydown", resumeCtx, true);
  }

  function stopAudio() {
    if (scanTimer) clearInterval(scanTimer);
    scanTimer = 0;
    document.removeEventListener("play", onMediaPlay, true);
    window.removeEventListener("pointerdown", resumeCtx, true);
    window.removeEventListener("keydown", resumeCtx, true);
    for (const src of attached.values()) {
      try { src.disconnect(); } catch {}
    }
    attached.clear();
    if (audioCtx) {
      audioCtx.close().catch(() => {});
      audioCtx = null;
      analyser = null;
      detector = null;
    }
  }

  function ensureAudio() {
    if (audioCtx) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.48;
      detector = new BeatDetector({ sampleRate: audioCtx.sampleRate, fftSize: analyser.fftSize });
      timeData = new Uint8Array(analyser.fftSize);
      freqData = new Uint8Array(analyser.frequencyBinCount);
    } catch {
      audioCtx = null;
    }
  }

  function resumeCtx() {
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  }

  function onMediaPlay(e) {
    if (e.target instanceof HTMLMediaElement) attach(e.target);
  }

  function scanMedia() {
    const media = document.querySelectorAll("video, audio");
    for (const el of media) {
      if (!el.paused && !el.ended) attach(el);
    }
  }

  // 미디어의 출력을 tap 한다. captureStream은 원래 재생을 방해하지 않으며 tabCapture와도 무관하다.
  function attach(el) {
    if (attached.has(el)) return;
    ensureAudio();
    if (!audioCtx) return;
    try {
      const capture = el.captureStream || el.mozCaptureStream;
      if (!capture) return;
      const stream = capture.call(el);
      if (!stream || stream.getAudioTracks().length === 0) return;
      const srcNode = audioCtx.createMediaStreamSource(stream);
      srcNode.connect(analyser); // 분석용으로만 연결 (destination에는 연결하지 않아 소리에 영향 없음)
      attached.set(el, srcNode);
      resumeCtx();
    } catch {
      // 교차 출처(CORS)로 tap 불가한 미디어 — 건너뛴다.
    }
  }

  // ---- 마우스 추적 ----
  function attachPointerListeners() {
    document.addEventListener("mousemove", onMouseMove, { passive: true, capture: true });
    document.addEventListener("mouseenter", onMouseEnter, true);
    document.addEventListener("mouseleave", onMouseLeave, true);
    window.addEventListener("blur", onMouseLeave);
  }
  function detachPointerListeners() {
    document.removeEventListener("mousemove", onMouseMove, { capture: true });
    document.removeEventListener("mouseenter", onMouseEnter, true);
    document.removeEventListener("mouseleave", onMouseLeave, true);
    window.removeEventListener("blur", onMouseLeave);
  }
  function onMouseMove(e) { mouseX = e.clientX; mouseY = e.clientY; pointerInside = true; }
  function onMouseEnter() { pointerInside = true; }
  function onMouseLeave() { pointerInside = false; }

  // ---- 렌더 루프 ----
  function startLoop() {
    if (rafId) return;
    const step = (now) => { render(now); rafId = requestAnimationFrame(step); };
    rafId = requestAnimationFrame(step);
  }
  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function render(now) {
    if (!root) return;

    // 오디오 분석
    if (analyser && detector) {
      analyser.getByteTimeDomainData(timeData);
      analyser.getByteFrequencyData(freqData);
      const frame = detector.analyse(timeData, freqData, now, sensitivity);
      const gain = 0.55 + intensity;
      target.energy = clamp(frame.energy * gain, 0, 1);
      target.bass = clamp(frame.bass * gain, 0, 1);
      if (frame.beat) {
        pulse = Math.min(1, pulse + 0.85 * (0.6 + intensity * 0.6));
        burstSparkles(frame.bass);
      }
    }

    // 스무딩
    energy += (target.energy - energy) * 0.22;
    bass += (target.bass - bass) * 0.28;
    pulse *= 0.86;
    if (pulse < 0.001) pulse = 0;

    spin = (spin + 0.35 + energy * 3.2) % 360;

    // 소리가 감지될 때만 미러볼 표시
    if (energy > SOUND_ON) lastLoudAt = now;
    const hasSound = lastLoudAt > 0 && now - lastLoudAt < SOUND_HOLD_MS;
    const wantShow = pointerInside && hasSound ? 1 : 0;
    show += (wantShow - show) * 0.15;
    if (show < 0.01) show = 0;

    // 미러볼이 보일 때만 네이티브 커서 숨김
    const cls = document.documentElement.classList;
    if (show > 0.35) cls.add("mirrorball-hide-cursor");
    else cls.remove("mirrorball-hide-cursor");

    const s = root.style;
    s.setProperty("--x", `${mouseX}px`);
    s.setProperty("--y", `${mouseY}px`);
    s.setProperty("--energy", energy.toFixed(3));
    s.setProperty("--bass", bass.toFixed(3));
    s.setProperty("--pulse", pulse.toFixed(3));
    s.setProperty("--spin", `${spin.toFixed(1)}deg`);
    s.setProperty("--show", show.toFixed(3));
    if (ball) ball.style.transform = `scale(${(1 + bass * 0.16 + pulse * 0.22).toFixed(3)}) rotate(${spin.toFixed(1)}deg)`;

    // 팝업 미터용 음량 보고 (throttle)
    if (now - lastLevelSentAt > 150) {
      lastLevelSentAt = now;
      chrome.runtime.sendMessage({ type: Message.MIRRORBALL_LEVEL, value: energy }).catch(() => {});
    }
  }

  // ---- 반짝임 버스트 ----
  function burstSparkles(bassLevel) {
    const count = 4 + Math.round(bassLevel * 6);
    for (let i = 0; i < count; i += 1) {
      const s = sparks[sparkCursor % sparks.length];
      sparkCursor += 1;
      if (!s) continue;
      const angle = (sparkCursor * 137.5 + i * 40) * (Math.PI / 180);
      const dist = baseSize * (0.9 + (i % 3) * 0.5);
      s.style.setProperty("--sx", `${Math.cos(angle) * dist}px`);
      s.style.setProperty("--sy", `${Math.sin(angle) * dist}px`);
      s.classList.remove("mb-burst");
      void s.offsetWidth;
      s.classList.add("mb-burst");
    }
  }
})();
