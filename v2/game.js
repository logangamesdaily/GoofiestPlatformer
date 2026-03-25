// =========================
// CONFIG
// =========================

const API_ROOT = "https://gp.logangamesdaily.co.uk/api/v1";
const ASSET_ROOT = "https://logangamesdaily.github.io/gp-assets";
const SONG_ROOT = ""; // e.g. same origin: `${location.origin}/songs`

// Unity units → pixels
const UNIT = 32;

// Camera
const CAMERA_WIDTH_UNITS = 30;
const CAMERA_HEIGHT_UNITS = 17;

// =========================
// DOM HOOKS
// =========================

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const levelListEl = document.getElementById("levelList");
const menuStatusEl = document.getElementById("menuStatus");
const searchInputEl = document.getElementById("searchInput");
const searchButtonEl = document.getElementById("searchButton");
const playButtonEl = document.getElementById("playButton");
const currentLevelLabelEl = document.getElementById("currentLevelLabel");
const overlayStatusEl = document.getElementById("overlayStatus");
const fpsLabelEl = document.getElementById("fpsLabel");

// =========================
// STATE
// =========================

let levels = [];
let selectedLevelId = null;
let currentLevelData = null;

let lastTime = 0;
let accumulator = 0;
const FIXED_DT = 1 / 120; // physics step

let keys = {};
let game = null;
let audioCtx = null;
let currentSong = null;

let fpsCounter = {
  last: performance.now(),
  frames: 0,
  fps: 0,
};

// =========================
// INPUT
// =========================

window.addEventListener("keydown", (e) => {
  keys[e.key.toLowerCase()] = true;

  if (e.key === "Enter") {
    if (selectedLevelId != null) {
      loadAndStartLevel(selectedLevelId);
    }
  }
  if (e.key.toLowerCase() === "r") {
    if (currentLevelData) {
      startGameFromLevel(currentLevelData);
    }
  }
});

window.addEventListener("keyup", (e) => {
  keys[e.key.toLowerCase()] = false;
});

// =========================
// UTIL
// =========================

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function rectsOverlap(a, b) {
  return !(
    a.x + a.w <= b.x ||
    a.x >= b.x + b.w ||
    a.y + a.h <= b.y ||
    a.y >= b.y + b.h
  );
}

function worldToScreenX(x, camera) {
  return (x - camera.x) * UNIT;
}

function worldToScreenY(y, camera) {
  // y up in world, canvas y down
  const top = camera.y + CAMERA_HEIGHT_UNITS / 2;
  return (top - y) * UNIT;
}

// =========================
// ASSETS
// =========================

const imageCache = new Map();

function loadImage(name) {
  const url = `${ASSET_ROOT}/${name}.png`;
  if (imageCache.has(url)) return imageCache.get(url);

  const img = new Image();
  img.src = url;
  imageCache.set(url, img);
  return img;
}

// Simple mapping; adjust to your actual asset filenames
const ASSETS = {
  player: loadImage("Player"),
  platform: loadImage("Floor"),
  spike: loadImage("Spike"),
  metalSpike: loadImage("MetalSpike"),
  gobble: loadImage("Gobble"),
  jumpOrb: loadImage("JumpOrb"),
  gravOrb: loadImage("GravOrb"),
  jumpPad: loadImage("JumpPad"),
  gravPad: loadImage("GravPad"),
  endGoal: loadImage("DeathParticle"),
  bg: loadImage("BG"),
};

// =========================
// AUDIO
// =========================

async function playSong(id) {
  if (!id) return;
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (currentSong) {
      currentSong.stop();
      currentSong = null;
    }
    const url = `${SONG_ROOT}/songs/${id}.wav`;
    const res = await fetch(url);
    if (!res.ok) return;
    const arrayBuffer = await res.arrayBuffer();
    const buffer = await audioCtx.decodeAudioData(arrayBuffer);
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.loop = true;
    source.start(0);
    currentSong = source;
  } catch (e) {
    console.warn("Audio error:", e);
  }
}

// =========================
// LEVEL API
// =========================

async function fetchLevels(query = "") {
  try {
    menuStatusEl.textContent = "Loading levels…";
    const url = `${API_ROOT}/search.php?q=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    levels = data;
    renderLevelList();
    menuStatusEl.textContent = levels.length
      ? `Loaded ${levels.length} levels`
      : "No levels found.";
  } catch (e) {
    console.error(e);
    menuStatusEl.textContent = "Failed to load levels.";
    menuStatusEl.classList.add("error");
  }
}

async function fetchLevelData(id) {
  const url = `${API_ROOT}/download.php?id=${encodeURIComponent(id)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const text = await res.text();
  // The API returns the raw JSON file content
  return JSON.parse(text);
}

// =========================
// MENU RENDERING
// =========================

function renderLevelList() {
  levelListEl.innerHTML = "";
  levels.forEach((lvl) => {
    const item = document.createElement("div");
    item.className = "level-item";
    if (lvl.id === selectedLevelId) item.classList.add("active");

    const titleRow = document.createElement("div");
    titleRow.className = "level-title-row";

    const title = document.createElement("div");
    title.className = "level-title";
    title.textContent = lvl.name;

    const meta = document.createElement("div");
    meta.className = "level-meta";
    meta.innerHTML = `
      <span>@${lvl.username}</span>
      <span class="level-stars">★ ${lvl.stars}</span>
      <span>${lvl.rated ? "Rated" : "Unrated"}</span>
    `;

    titleRow.appendChild(title);
    titleRow.appendChild(meta);

    const desc = document.createElement("div");
    desc.className = "level-description";
    desc.textContent = lvl.description || "";

    item.appendChild(titleRow);
    item.appendChild(desc);

    item.addEventListener("click", () => {
      selectedLevelId = lvl.id;
      renderLevelList();
      currentLevelLabelEl.textContent = `Selected: ${lvl.name}`;
    });

    levelListEl.appendChild(item);
  });
}

// =========================
// GAME OBJECTS
// =========================

class Player {
  constructor(x, y, speed) {
    this.x = x;
    this.y = y;
    this.w = 1; // Unity units
    this.h = 1.5;
    this.vx = 0;
    this.vy = 0;
    this.speed = speed || 6;
    this.onGround = false;
    this.gravity = -25;
    this.jumpStrength = 11;
    this.facing = 1;
    this.alive = true;
  }

  getRect() {
    return { x: this.x - this.w / 2, y: this.y, w: this.w, h: this.h };
  }

  update(dt, game) {
    if (!this.alive) return;

    let move = 0;
    if (keys["arrowleft"] || keys["a"]) move -= 1;
    if (keys["arrowright"] || keys["d"]) move += 1;

    this.vx = move * this.speed;
    if (move !== 0) this.facing = move;

    // Jump
    const jumpPressed =
      keys[" "] || keys["arrowup"] || keys["w"];
    if (jumpPressed && this.onGround) {
      this.vy = this.jumpStrength;
      this.onGround = false;
    }

    // Gravity
    this.vy += this.gravity * dt;

    // Integrate
    let newX = this.x + this.vx * dt;
    let newY = this.y + this.vy * dt;

    const rect = this.getRect();

    // Horizontal collision
    const hRect = {
      x: newX - this.w / 2,
      y: rect.y,
      w: this.w,
      h: this.h,
    };

    for (const p of game.platforms) {
      if (rectsOverlap(hRect, p.rect)) {
        if (this.vx > 0) {
          hRect.x = p.rect.x - hRect.w;
        } else if (this.vx < 0) {
          hRect.x = p.rect.x + p.rect.w;
        }
        this.vx = 0;
        newX = hRect.x + this.w / 2;
      }
    }

    // Vertical collision
    const vRect = {
      x: hRect.x,
      y: newY,
      w: this.w,
      h: this.h,
    };

    this.onGround = false;
    for (const p of game.platforms) {
      if (rectsOverlap(vRect, p.rect)) {
        if (this.vy > 0) {
          // hitting ceiling
          vRect.y = p.rect.y - vRect.h;
          this.vy = 0;
        } else if (this.vy < 0) {
          // landing
          vRect.y = p.rect.y + p.rect.h;
          this.vy = 0;
          this.onGround = true;
        }
        newY = vRect.y;
      }
    }

    this.x = newX;
    this.y = newY;

    // Death by falling
    if (this.y < -50) {
      this.alive = false;
      overlayStatusEl.textContent = "You fell! Press R to restart.";
    }

    // Spikes
    for (const s of game.spikes) {
      if (rectsOverlap(this.getRect(), s.rect)) {
        this.die("Spikes got you! Press R to restart.");
        break;
      }
    }

    // Gobbles
    for (const g of game.gobbles) {
      if (rectsOverlap(this.getRect(), g.getRect())) {
        this.die("Gobbles got you! Press R to restart.");
        break;
      }
    }

    // End goal
    for (const goal of game.endGoals) {
      if (rectsOverlap(this.getRect(), goal.rect)) {
        overlayStatusEl.textContent = "Level complete! Select another level or press R to replay.";
        this.alive = false;
      }
    }

    // BG color triggers
    for (const trig of game.bgTriggers) {
      if (rectsOverlap(this.getRect(), trig.rect)) {
        game.bgColor = trig.color;
      }
    }

    // Jump orbs
    for (const orb of game.jumpOrbs) {
      if (rectsOverlap(this.getRect(), orb.rect)) {
        this.vy = this.jumpStrength * 1.2;
        this.onGround = false;
      }
    }

    // Grav orbs
    for (const orb of game.gravOrbs) {
      if (rectsOverlap(this.getRect(), orb.rect)) {
        this.gravity *= -1;
        this.vy = this.jumpStrength * Math.sign(this.gravity);
      }
    }

    // Jump pads
    for (const pad of game.jumpPads) {
      if (rectsOverlap(this.getRect(), pad.rect)) {
        this.vy = this.jumpStrength * 1.5;
        this.onGround = false;
      }
    }

    // Grav pads
    for (const pad of game.gravPads) {
      if (rectsOverlap(this.getRect(), pad.rect)) {
        this.gravity *= -1;
        this.vy = this.jumpStrength * Math.sign(this.gravity);
      }
    }
  }

  die(message) {
    this.alive = false;
    overlayStatusEl.textContent = message;
  }

  draw(ctx, camera) {
    const img = ASSETS.player;
    const sx = worldToScreenX(this.x - this.w / 2, camera);
    const sy = worldToScreenY(this.y + this.h, camera);
    const sw = this.w * UNIT;
    const sh = this.h * UNIT;

    if (img && img.complete) {
      ctx.save();
      ctx.translate(sx + sw / 2, sy + sh / 2);
      ctx.scale(this.facing < 0 ? -1 : 1, 1);
      ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);
      ctx.restore();
    } else {
      ctx.fillStyle = "#ff4";
      ctx.fillRect(sx, sy, sw, sh);
    }
  }
}

class Platform {
  constructor(x, y, w, h) {
    this.rect = { x: x - w / 2, y, w, h };
  }

  draw(ctx, camera) {
    const img = ASSETS.platform;
    const sx = worldToScreenX(this.rect.x, camera);
    const sy = worldToScreenY(this.rect.y + this.rect.h, camera);
    const sw = this.rect.w * UNIT;
    const sh = this.rect.h * UNIT;

    if (img && img.complete) {
      ctx.drawImage(img, sx, sy, sw, sh);
    } else {
      ctx.fillStyle = "#888";
      ctx.fillRect(sx, sy, sw, sh);
    }
  }
}

class Spike {
  constructor(x, y, w, h, metal = false) {
    this.rect = { x: x - w / 2, y, w, h };
    this.metal = metal;
  }

  draw(ctx, camera) {
    const img = this.metal ? ASSETS.metalSpike : ASSETS.spike;
    const sx = worldToScreenX(this.rect.x, camera);
    const sy = worldToScreenY(this.rect.y + this.rect.h, camera);
    const sw = this.rect.w * UNIT;
    const sh = this.rect.h * UNIT;

    if (img && img.complete) {
      ctx.drawImage(img, sx, sy, sw, sh);
    } else {
      ctx.fillStyle = this.metal ? "#ccc" : "#f44";
      ctx.fillRect(sx, sy, sw, sh);
    }
  }
}

class Gobble {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.w = 1;
    this.h = 1.2;
    this.vx = 2;
    this.range = 3;
    this.originX = x;
  }

  getRect() {
    return { x: this.x - this.w / 2, y: this.y, w: this.w, h: this.h };
  }

  update(dt) {
    this.x += this.vx * dt;
    if (this.x > this.originX + this.range) {
      this.x = this.originX + this.range;
      this.vx *= -1;
    }
    if (this.x < this.originX - this.range) {
      this.x = this.originX - this.range;
      this.vx *= -1;
    }
  }

  draw(ctx, camera) {
    const img = ASSETS.gobble;
    const sx = worldToScreenX(this.x - this.w / 2, camera);
    const sy = worldToScreenY(this.y + this.h, camera);
    const sw = this.w * UNIT;
    const sh = this.h * UNIT;

    if (img && img.complete) {
      ctx.save();
      ctx.translate(sx + sw / 2, sy + sh / 2);
      ctx.scale(this.vx < 0 ? -1 : 1, 1);
      ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);
      ctx.restore();
    } else {
      ctx.fillStyle = "#0f0";
      ctx.fillRect(sx, sy, sw, sh);
    }
  }
}

class SimpleRectObject {
  constructor(x, y, w, h, type, color, img) {
    this.rect = { x: x - w / 2, y, w, h };
    this.type = type;
    this.color = color;
    this.img = img;
  }

  draw(ctx, camera) {
    const sx = worldToScreenX(this.rect.x, camera);
    const sy = worldToScreenY(this.rect.y + this.rect.h, camera);
    const sw = this.rect.w * UNIT;
    const sh = this.rect.h * UNIT;

    if (this.img && this.img.complete) {
      ctx.drawImage(this.img, sx, sy, sw, sh);
    } else {
      ctx.fillStyle = this.color || "#fff";
      ctx.fillRect(sx, sy, sw, sh);
    }
  }
}

// =========================
// GAME WORLD
// =========================

class GameWorld {
  constructor(levelJson) {
    this.levelJson = levelJson;
    this.platforms = [];
    this.spikes = [];
    this.gobbles = [];
    this.endGoals = [];
    this.bgTriggers = [];
    this.jumpOrbs = [];
    this.gravOrbs = [];
    this.jumpPads = [];
    this.gravPads = [];
    this.bgColor = { r: 0.05, g: 0.02, b: 0.1 };

    this.player = null;
    this.camera = { x: 0, y: 0 };

    this.parseLevel();
  }

  parseLevel() {
    const data = this.levelJson;

    // Player
    if (data.Players && data.Players.length > 0) {
      const p = data.Players[0];
      this.player = new Player(
        p.Position.x,
        p.Position.y,
        p.Speed || 6
      );
    } else {
      this.player = new Player(0, 0, 6);
    }

    // Platforms
    (data.Platforms || []).forEach((p) => {
      const w = p.Scale.x;
      const h = p.Scale.y;
      this.platforms.push(
        new Platform(p.Position.x, p.Position.y, w, h)
      );
    });

    // Moving platforms (treated as static for now)
    (data.MovingPlatforms || []).forEach((p) => {
      const w = p.Scale.x;
      const h = p.Scale.y;
      this.platforms.push(
        new Platform(p.Position.x, p.Position.y, w, h)
      );
    });

    // Spikes
    (data.NewSpikes || []).forEach((s) => {
      const w = s.Scale.x / 3; // they’re often 3 wide in scale
      const h = s.Scale.y / 3;
      this.spikes.push(
        new Spike(s.Position.x, s.Position.y, w, h, false)
      );
    });

    (data.MetalSpikes || []).forEach((s) => {
      // Some entries are decorative far away; we only keep ones near gameplay
      if (Math.abs(s.Position.x) > 200 || Math.abs(s.Position.y) > 200) {
        return;
      }
      const w = s.Scale.x / 3;
      const h = s.Scale.y / 3;
      this.spikes.push(
        new Spike(s.Position.x, s.Position.y, w, h, true)
      );
    });

    // Gobbles
    (data.Gobbles || []).forEach((g) => {
      this.gobbles.push(new Gobble(g.Position.x, g.Position.y));
    });

    // End goals
    (data.EndGoals || []).forEach((g) => {
      const w = 1.5;
      const h = 2;
      this.endGoals.push(
        new SimpleRectObject(
          g.x,
          g.y,
          w,
          h,
          "goal",
          "#0ff",
          ASSETS.endGoal
        )
      );
    });

    // BG color triggers
    (data.BGColTrigs || []).forEach((t) => {
      const w = t.Scale.x;
      const h = t.Scale.y;
      const rect = {
        x: t.Position.x - w / 2,
        y: t.Position.y,
        w,
        h,
      };
      const color = t.color || { r: 0, g: 0, b: 0 };
      this.bgTriggers.push({
        rect,
        color,
      });
    });

    // Jump orbs
    (data.JumpOrbs || []).forEach((o) => {
      const w = o.Scale.x;
      const h = o.Scale.y;
      this.jumpOrbs.push(
        new SimpleRectObject(
          o.Position.x,
          o.Position.y,
          w,
          h,
          "jumpOrb",
          "#ff0",
          ASSETS.jumpOrb
        )
      );
    });

    // Grav orbs
    (data.GravOrbs || []).forEach((o) => {
      const w = o.Scale.x;
      const h = o.Scale.y;
      this.gravOrbs.push(
        new SimpleRectObject(
          o.Position.x,
          o.Position.y,
          w,
          h,
          "gravOrb",
          "#0ff",
          ASSETS.gravOrb
        )
      );
    });

    // Jump pads
    (data.JumpPads || []).forEach((o) => {
      const w = o.Scale.x;
      const h = o.Scale.y;
      this.jumpPads.push(
        new SimpleRectObject(
          o.Position.x,
          o.Position.y,
          w,
          h,
          "jumpPad",
          "#ff0",
          ASSETS.jumpPad
        )
      );
    });

    // Grav pads
    (data.GravPads || []).forEach((o) => {
      const w = o.Scale.x;
      const h = o.Scale.y;
      this.gravPads.push(
        new SimpleRectObject(
          o.Position.x,
          o.Position.y,
          w,
          h,
          "gravPad",
          "#0ff",
          ASSETS.gravPad
        )
      );
    });

    // Initial BG color
    if (data.BGColTrigs && data.BGColTrigs.length > 0) {
      const c = data.BGColTrigs[0].color;
      this.bgColor = c || this.bgColor;
    }

    this.updateCamera(0);
  }

  update(dt) {
    if (!this.player) return;

    this.player.update(dt, this);

    for (const g of this.gobbles) {
      g.update(dt);
    }

    this.updateCamera(dt);
  }

  updateCamera(dt) {
    if (!this.player) return;
    const targetX = this.player.x;
    const targetY = this.player.y + 1;

    const lerpFactor = 1 - Math.pow(0.001, dt || 0.016);
    this.camera.x += (targetX - this.camera.x) * lerpFactor;
    this.camera.y += (targetY - this.camera.y) * lerpFactor;
  }

  draw(ctx) {
    // Background
    const c = this.bgColor;
    const r = Math.floor((c.r || 0) * 255);
    const g = Math.floor((c.g || 0) * 255);
    const b = Math.floor((c.b || 0) * 255);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Platforms
    for (const p of this.platforms) {
      p.draw(ctx, this.camera);
    }

    // Spikes
    for (const s of this.spikes) {
      s.draw(ctx, this.camera);
    }

    // Pads & orbs
    for (const o of this.jumpPads) o.draw(ctx, this.camera);
    for (const o of this.gravPads) o.draw(ctx, this.camera);
    for (const o of this.jumpOrbs) o.draw(ctx, this.camera);
    for (const o of this.gravOrbs) o.draw(ctx, this.camera);

    // End goals
    for (const g of this.endGoals) g.draw(ctx, this.camera);

    // Gobbles
    for (const g of this.gobbles) {
      g.draw(ctx, this.camera);
    }

    // Player
    if (this.player) {
      this.player.draw(ctx, this.camera);
    }
  }
}

// =========================
// GAME LOOP
// =========================

function loop(timestamp) {
  if (!lastTime) lastTime = timestamp;
  let dt = (timestamp - lastTime) / 1000;
  lastTime = timestamp;

  // FPS
  fpsCounter.frames++;
  if (timestamp - fpsCounter.last >= 1000) {
    fpsCounter.fps = fpsCounter.frames;
    fpsCounter.frames = 0;
    fpsCounter.last = timestamp;
    fpsLabelEl.textContent = `FPS: ${fpsCounter.fps}`;
  }

  dt = clamp(dt, 0, 0.05);
  accumulator += dt;

  while (accumulator >= FIXED_DT) {
    if (game) game.update(FIXED_DT);
    accumulator -= FIXED_DT;
  }

  if (game) {
    game.draw(ctx);
  } else {
    // Idle background
    ctx.fillStyle = "#05020a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  requestAnimationFrame(loop);
}

// =========================
// START / LEVEL LOADING
// =========================

async function loadAndStartLevel(id) {
  try {
    overlayStatusEl.textContent = "Loading level…";
    const data = await fetchLevelData(id);
    currentLevelData = data;
    startGameFromLevel(data);

    // If the level JSON has SongIDs, play the first
    if (data.SongIDs && data.SongIDs.length > 0) {
      playSong(data.SongIDs[0]);
    }

    const lvl = levels.find((l) => l.id === id);
    if (lvl) {
      currentLevelLabelEl.textContent = `Playing: ${lvl.name}`;
    } else {
      currentLevelLabelEl.textContent = `Playing level #${id}`;
    }

    overlayStatusEl.textContent = "Playing. Press R to restart.";
  } catch (e) {
    console.error(e);
    overlayStatusEl.textContent = "Failed to load level.";
  }
}

function startGameFromLevel(levelJson) {
  game = new GameWorld(levelJson);
}

// =========================
// UI EVENTS
// =========================

searchButtonEl.addEventListener("click", () => {
  const q = searchInputEl.value.trim();
  fetchLevels(q);
});

searchInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const q = searchInputEl.value.trim();
    fetchLevels(q);
  }
});

playButtonEl.addEventListener("click", () => {
  if (selectedLevelId == null) {
    menuStatusEl.textContent = "Select a level first.";
    return;
  }
  loadAndStartLevel(selectedLevelId);
});

// =========================
// INIT
// =========================

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const aspect = CAMERA_WIDTH_UNITS / CAMERA_HEIGHT_UNITS;
  let width = rect.width;
  let height = rect.width / aspect;
  if (height > rect.height) {
    height = rect.height;
    width = rect.height * aspect;
  }
  canvas.width = width * window.devicePixelRatio;
  canvas.height = height * window.devicePixelRatio;
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

fetchLevels(""); // initial load
requestAnimationFrame(loop);
