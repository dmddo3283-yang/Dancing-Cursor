// 미러볼 커서 content script.
// 서비스 워커로부터 활성 상태와 오디오 프레임을 받아, 마우스를 따라다니는
// 미러볼을 그리고 소리 크기에 맞춰 빛을 뿜게 한다.
(() => {
  // 선언형 content script와 서비스 워커의 프로그램적 주입이 겹칠 수 있으므로 중복 실행을 막는다.
  if (window.__mirrorballCursorLoaded) return;
  window.__mirrorballCursorLoaded = true;

  const Message = {
    GET_STATE: "GET_STATE",
    MIRRORBALL_STATE: "MIRRORBALL_STATE",
    MIRRORBALL_FRAME: "MIRRORBALL_FRAME"
  };

  const SPARK_POOL_SIZE = 20;
  const SOUND_ON = 0.06; // 이 이상의 음량이면 "소리 있음"으로 판정
  const SOUND_HOLD_MS = 900; // 마지막 소리 이후 이 시간까지는 미러볼 유지 (조용한 구간 브릿지)

  let root = null;
  let ball = null;
  let raysEl = null;
  let sparks = [];
  let sparkCursor = 0;
  let rafId = 0;

  // 실시간 상태
  let active = false;
  let intensity = 0.65;
  let baseSize = 42;
  let mouseX = -100;
  let mouseY = -100;
  let pointerInside = false;

  // 스무딩 값
  let energy = 0;
  let bass = 0;
  let pulse = 0;
  let spin = 0;
  let show = 0; // 0~1 페이드
  let target = { energy: 0, bass: 0 };
  let lastLoudAt = 0; // 마지막으로 소리가 감지된 시각

  // ---- 부팅: 현재 상태를 서비스 워커에 질의 ----
  chrome.runtime.sendMessage({ type: Message.GET_STATE }, (res) => {
    if (chrome.runtime.lastError || !res) return;
    const isActive = res.active ?? res.state?.enabled ?? false;
    const nextIntensity = res.intensity ?? res.settings?.intensity;
    const nextSize = res.size ?? res.settings?.size;
    applyState(isActive, nextIntensity, nextSize);
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === Message.MIRRORBALL_STATE) {
      applyState(message.active, message.intensity, message.size);
    } else if (message?.type === Message.MIRRORBALL_FRAME) {
      onFrame(message.frame, message.intensity, message.size);
    }
  });

  function applyState(isActive, nextIntensity, nextSize) {
    if (typeof nextIntensity === "number") intensity = clamp01(nextIntensity / 100);
    if (typeof nextSize === "number") baseSize = 26 + (nextSize / 100) * 54; // 26~80px

    if (isActive && !active) {
      active = true;
      build();
      attachPointerListeners();
      startLoop();
    } else if (!isActive && active) {
      active = false;
      teardown();
    } else if (active && root) {
      root.style.setProperty("--size", `${baseSize}px`);
    }
  }

  function onFrame(frame, nextIntensity, nextSize) {
    if (!active || !frame) return;
    if (typeof nextIntensity === "number") intensity = clamp01(nextIntensity / 100);
    if (typeof nextSize === "number") baseSize = 26 + (nextSize / 100) * 54;

    const gain = 0.55 + intensity; // 0.55~1.55
    target.energy = clamp01(frame.energy * gain);
    target.bass = clamp01(frame.bass * gain);

    if (frame.beat) {
      pulse = Math.min(1, pulse + 0.85 * (0.6 + intensity * 0.6));
      burstSparkles(frame.bass);
    }
  }

  // ---- DOM 구성 ----
  function build() {
    if (root) return;
    root = document.createElement("div");
    root.id = "mirrorball-root";
    root.style.setProperty("--size", `${baseSize}px`);

    raysEl = document.createElement("div");
    raysEl.className = "mb-rays";

    const glow = document.createElement("div");
    glow.className = "mb-glow";

    ball = document.createElement("div");
    ball.className = "mb-ball";

    root.append(raysEl, glow, ball);

    for (let i = 0; i < SPARK_POOL_SIZE; i += 1) {
      const s = document.createElement("div");
      s.className = "mb-spark";
      root.appendChild(s);
      sparks.push(s);
    }

    mount();
    // 네이티브 커서 숨김은 render()에서 소리가 있을 때만 켠다.
  }

  // document_start 시점엔 body가 없을 수 있으므로 documentElement에 붙인다.
  function mount() {
    const parent = document.body || document.documentElement;
    parent.appendChild(root);
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", () => {
        if (root && document.body && root.parentNode !== document.body) {
          document.body.appendChild(root);
        }
      }, { once: true });
    }
  }

  function teardown() {
    stopLoop();
    detachPointerListeners();
    document.documentElement.classList.remove("mirrorball-hide-cursor");
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = ball = raysEl = null;
    sparks = [];
    energy = bass = pulse = spin = show = 0;
    lastLoudAt = 0;
    target = { energy: 0, bass: 0 };
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

  function onMouseMove(e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
    pointerInside = true;
  }
  function onMouseEnter() {
    pointerInside = true;
  }
  function onMouseLeave() {
    pointerInside = false;
  }

  // ---- 렌더 루프 ----
  function startLoop() {
    if (rafId) return;
    const step = (now) => {
      render(now);
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
  }

  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function render(now) {
    if (!root) return;

    // 스무딩
    energy += (target.energy - energy) * 0.22;
    bass += (target.bass - bass) * 0.28;
    pulse *= 0.86;
    if (pulse < 0.001) pulse = 0;

    // 자연 감쇠(프레임 사이 소리 정보가 안 올 때 서서히 줄어듦)
    target.energy *= 0.94;
    target.bass *= 0.94;

    // 회전: 소리가 클수록 빠르게
    spin = (spin + 0.35 + energy * 3.2) % 360;

    // 소리가 감지될 때만 미러볼을 표시한다. 마지막 소리 이후 SOUND_HOLD_MS 동안은
    // 유지해 곡 중간의 조용한 구간에서 깜빡이지 않게 한다.
    if (energy > SOUND_ON) lastLoudAt = now;
    const hasSound = lastLoudAt > 0 && now - lastLoudAt < SOUND_HOLD_MS;
    const wantShow = pointerInside && hasSound ? 1 : 0;
    show += (wantShow - show) * 0.15;
    if (show < 0.01) show = 0;

    // 네이티브 커서는 미러볼이 보이는 동안에만 숨긴다. (소리 없으면 평소 커서로 복귀)
    const cls = document.documentElement.classList;
    if (show > 0.35) cls.add("mirrorball-hide-cursor");
    else cls.remove("mirrorball-hide-cursor");

    // CSS 변수 반영
    const s = root.style;
    s.setProperty("--x", `${mouseX}px`);
    s.setProperty("--y", `${mouseY}px`);
    s.setProperty("--energy", energy.toFixed(3));
    s.setProperty("--bass", bass.toFixed(3));
    s.setProperty("--pulse", pulse.toFixed(3));
    s.setProperty("--spin", `${spin.toFixed(1)}deg`);
    s.setProperty("--show", show.toFixed(3));

    if (ball) ball.style.transform =
      `scale(${(1 + bass * 0.16 + pulse * 0.22).toFixed(3)}) rotate(${spin.toFixed(1)}deg)`;
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
      // 애니메이션 재시작
      s.classList.remove("mb-burst");
      void s.offsetWidth; // reflow로 애니메이션 리셋
      s.classList.add("mb-burst");
    }
  }

  function clamp01(v) {
    return Math.min(1, Math.max(0, v));
  }
})();
