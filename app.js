const $ = (sel) => document.querySelector(sel);

const PHRASES = [
  "진짜\n하고싶어?",
  "장단점을\n써보자",
  "누군가에게\n물어봐",
  "바로 가",
  "질러",
  "뒤돌아\n보지마",
  "하루만 더\n생각해봐",
  "감당\n할 수 있어?",
  "최악의 경우\n생각해봐",
  "직감에 \n맡겨",
  "지금 아니면\n언제해",
  "하고 후회하자",
  "첫 느낌을\n따라",
  "눈 감고\n골라",
  "노래제목을\n따라가",
  "인생은\n한번뿐",
  "무조건\n하지마",
  "왜\n안하고있어?",
  "그냥해",
  "하지마",
  "동전을\n던져봐",
  "없었던 \n일로 하자",
  "후회는\n너의 몫",
  "답은 너\n안에 있어",
];

const els = {
  screenFirst: $("#screenFirst"),
  screenSelect: $("#screenSelect"),
  screenRoll: $("#screenRoll"),
  tiles: $("#tiles"),
  selectedCount: $("#selectedCount"),
  goRollBtn: $("#goRollBtn"),
  backBtn: $("#backBtn"),

  diceScene: $("#diceScene"),
  dice: $("#dice"),
  rollHint: $("#rollHint"),
};

const FACE_ORIENT = [
  { rx: 0, ry: 0 }, // front
  { rx: 0, ry: 180 }, // back
  { rx: 0, ry: -90 }, // right
  { rx: 0, ry: 90 }, // left
  { rx: -90, ry: 0 }, // top
  { rx: 90, ry: 0 }, // bottom
];

// net layout selection order -> dice face index
// [top, front, bottom, back, left, right]
const NET_FACE_ORDER = [4, 0, 5, 1, 3, 2];
// (kept) order mapping only; no net UI anymore

/** @type {number[]} selected tile indices (0~23), in order */
let selected = [];

let currentRx = -18;
let currentRy = 28;
let isRolling = false;
let pendingRoll = false;

let motionOn = false;
let lastShakeAt = 0;
let lastAccel = { x: 0, y: 0, z: 0 };

function renderTiles() {
  els.tiles.innerHTML = "";
  for (let idx = 0; idx < PHRASES.length; idx++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tile";
    btn.dataset.idx = String(idx);
    btn.setAttribute("aria-label", PHRASES[idx].replace(/\n/g, " "));

    const text = document.createElement("div");
    text.className = "tileText";
    text.textContent = PHRASES[idx];
    btn.appendChild(text);

    const mark = document.createElement("span");
    mark.className = "tileBadge";
    mark.textContent = "X";
    mark.setAttribute("role", "button");
    mark.setAttribute("aria-label", "선택 취소");
    mark.tabIndex = -1;
    mark.addEventListener("click", (e) => {
      e.stopPropagation();
      // X는 선택된 타일에서만 보이므로, 클릭은 곧 선택 취소
      toggleSelect(idx);
    });
    btn.appendChild(mark);

    btn.addEventListener("click", () => toggleSelect(idx));
    els.tiles.appendChild(btn);
  }
  syncTileUI();
}

function getFaceAssignments() {
  /** @type {(number|null)[]} */
  const faceToTile = [null, null, null, null, null, null];
  for (let i = 0; i < 6; i++) {
    const tileIdx = selected[i];
    if (tileIdx == null) continue;
    faceToTile[NET_FACE_ORDER[i]] = tileIdx;
  }
  return faceToTile;
}

function syncTileUI() {
  els.selectedCount.textContent = String(selected.length);

  const remaining = 6 - selected.length;
  els.goRollBtn.disabled = remaining !== 0;

  if (remaining <= 0) {
    els.goRollBtn.textContent = "굴리자!";
  } else {
    els.goRollBtn.textContent = `${remaining}개 더 골라!`;
  }

  [...els.tiles.children].forEach((node) => {
    const idx = Number(node.dataset.idx);
    const selPos = selected.indexOf(idx);
    node.classList.toggle("tile--selected", selPos !== -1);

    // X 표시는 CSS가 처리
  });
}

function toggleSelect(idx) {
  const pos = selected.indexOf(idx);
  if (pos !== -1) {
    selected.splice(pos, 1);
    updateAll();
    return;
  }
  if (selected.length >= 6) {
    els.selectedCount.animate(
      [{ transform: "scale(1)" }, { transform: "scale(1.18)" }, { transform: "scale(1)" }],
      { duration: 260, easing: "ease-out" },
    );
    return;
  }
  selected.push(idx);
  updateAll();
}

function updateDiceFaces() {
  const texts = els.dice.querySelectorAll(".faceText");
  const faceToTile = getFaceAssignments();
  for (let faceIdx = 0; faceIdx < 6; faceIdx++) {
    const tileIdx = faceToTile[faceIdx];
    const node = texts[faceIdx];
    if (!node) continue;
    if (tileIdx == null) {
      node.textContent = "";
      node.style.opacity = "0";
      continue;
    }
    node.style.opacity = "1";
    node.textContent = PHRASES[tileIdx] ?? "";
  }
}

function showScreen(name) {
  const isFirst = name === "first";
  const isSelect = name === "select";
  const isRoll = name === "roll";
  els.screenFirst.hidden = !isFirst;
  els.screenSelect.hidden = !isSelect;
  els.screenRoll.hidden = !isRoll;
}

function normalizeAngle(deg) {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

function setDiceRotation(rx, ry, instant = false) {
  if (instant) {
    const prev = els.dice.style.transition;
    els.dice.style.transition = "none";
    els.dice.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
    void els.dice.offsetHeight;
    els.dice.style.transition = prev || "";
    return;
  }
  els.dice.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
}

function waitTransition(el, fallbackMs) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      resolve();
    }, fallbackMs);
    const onEnd = (e) => {
      if (e.target !== el) return;
      if (done) return;
      done = true;
      cleanup();
      resolve();
    };
    function cleanup() {
      clearTimeout(timer);
      el.removeEventListener("transitionend", onEnd);
    }
    el.addEventListener("transitionend", onEnd);
  });
}

async function rollDice() {
  if (isRolling) {
    pendingRoll = true;
    return;
  }
  if (selected.length !== 6) return;

  isRolling = true;

  const face = Math.floor(Math.random() * 6);
  const base = FACE_ORIENT[face];
  const spinX = 360 * (2 + Math.floor(Math.random() * 2));
  const spinY = 360 * (2 + Math.floor(Math.random() * 2));

  const targetRx = currentRx + spinX + (base.rx - normalizeAngle(currentRx));
  const targetRy = currentRy + spinY + (base.ry - normalizeAngle(currentRy));
  setDiceRotation(targetRx, targetRy);

  await waitTransition(els.dice, 2100);

  currentRx = base.rx;
  currentRy = base.ry;
  setDiceRotation(currentRx, currentRy, true);
  isRolling = false;

  if (pendingRoll) {
    pendingRoll = false;
    // run one more roll right after finishing
    rollDice();
  }
}

function onDiceActivate(e) {
  if (els.screenRoll.hidden) return;
  // Avoid interpreting the gesture as scroll/zoom on mobile.
  if (typeof e.preventDefault === "function") e.preventDefault();
  rollDice();
}

function supportsMotionPermission() {
  return (
    typeof window.DeviceMotionEvent !== "undefined" &&
    typeof window.DeviceMotionEvent.requestPermission === "function"
  );
}

async function requestMotionPermission() {
  try {
    const res = await window.DeviceMotionEvent.requestPermission();
    if (res === "granted") {
      els.rollHint.textContent = "흔들기 감지 켜짐";
      enableMotion();
    } else {
      els.rollHint.textContent = "권한이 거부되어 버튼으로 굴려주세요.";
    }
  } catch {
    els.rollHint.textContent = "권한 요청에 실패했어요. 버튼으로 굴려주세요.";
  }
}

function enableMotion() {
  if (motionOn) return;
  if (typeof window.DeviceMotionEvent === "undefined") return;
  motionOn = true;
  lastShakeAt = 0;
  lastAccel = { x: 0, y: 0, z: 0 };
  window.addEventListener("devicemotion", onDeviceMotion, { passive: true });
}

function disableMotion() {
  if (!motionOn) return;
  motionOn = false;
  window.removeEventListener("devicemotion", onDeviceMotion);
}

function onDeviceMotion(e) {
  const a = e.accelerationIncludingGravity || e.acceleration;
  if (!a) return;
  const x = a.x || 0;
  const y = a.y || 0;
  const z = a.z || 0;

  const dx = x - lastAccel.x;
  const dy = y - lastAccel.y;
  const dz = z - lastAccel.z;
  lastAccel = { x, y, z };

  const delta = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const now = Date.now();
  if (delta > 16 && now - lastShakeAt > 900) {
    lastShakeAt = now;
    rollDice();
  }
}

function updateAll() {
  syncTileUI();
  updateDiceFaces();
}

function init() {
  // Start with splash screen; click to move to select
  showScreen("first");
  els.screenFirst.addEventListener("click", () => {
    showScreen("select");
  });

  renderTiles();
  updateDiceFaces();
  setDiceRotation(currentRx, currentRy, true);

  els.goRollBtn.addEventListener("click", async () => {
    if (selected.length !== 6) return;
    if (supportsMotionPermission()) {
      // iOS: 권한 요청을 버튼 클릭 제스처 안에서 처리
      await requestMotionPermission();
    } else {
      // 그 외 환경: 별도 권한 없이 바로 모션 활성화 시도
      enableMotion();
    }

    showScreen("roll");
    updateDiceFaces();
  });

  els.backBtn.addEventListener("click", () => {
    showScreen("select");
    disableMotion();
  });

  els.dice.addEventListener("click", onDiceActivate);
  els.dice.addEventListener("pointerdown", onDiceActivate, { passive: false });
  els.dice.addEventListener("touchend", onDiceActivate, { passive: false });
  els.diceScene.addEventListener("click", onDiceActivate);
  els.diceScene.addEventListener("pointerdown", onDiceActivate, { passive: false });
  els.diceScene.addEventListener("touchend", onDiceActivate, { passive: false });

  window.addEventListener("keydown", (e) => {
    if (e.code !== "Space") return;
    if (!els.screenRoll.hidden) {
      e.preventDefault();
      rollDice();
    }
  });
}

init();

