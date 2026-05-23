"use strict";

const canvas = document.querySelector("#reefCanvas");
const ctx = canvas.getContext("2d", { alpha: false });

const ui = {
  score: document.querySelector("#scoreValue"),
  health: document.querySelector("#healthValue"),
  rescued: document.querySelector("#rescuedValue"),
  status: document.querySelector("#statusLine"),
  reset: document.querySelector("#resetButton"),
  sound: document.querySelector("#soundToggle"),
};

const TAU = Math.PI * 2;
const keys = new Set();
const pointer = { x: 0, y: 0, active: false };

let view = { width: 960, height: 600, dpr: 1 };
let state = null;
let lastFrameTime = 0;

class ReefAudio {
  constructor() {
    this.enabled = false;
    this.context = null;
    this.master = null;
    this.hum = null;
  }

  async ensure() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return false;
    }

    if (!this.context) {
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = 0.075;
      this.master.connect(this.context.destination);
    }

    if (this.context.state === "suspended") {
      await this.context.resume();
    }

    return true;
  }

  async setEnabled(enabled) {
    this.enabled = enabled;
    ui.sound.textContent = enabled ? "Sound On" : "Sound Off";
    ui.sound.setAttribute("aria-pressed", String(enabled));

    if (!enabled) {
      this.stopHum();
      return;
    }

    if (await this.ensure()) {
      this.startHum();
      this.note(220, 0.08, "sine", 0.04);
      this.note(330, 0.12, "triangle", 0.035, 0.08);
    }
  }

  startHum() {
    if (!this.context || this.hum) {
      return;
    }

    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 74;
    gain.gain.value = 0.018;
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start();
    this.hum = { oscillator, gain };
  }

  stopHum() {
    if (!this.hum || !this.context) {
      return;
    }

    const { oscillator, gain } = this.hum;
    gain.gain.setTargetAtTime(0, this.context.currentTime, 0.04);
    oscillator.stop(this.context.currentTime + 0.12);
    this.hum = null;
  }

  note(frequency, duration = 0.1, type = "sine", volume = 0.05, delay = 0) {
    if (!this.enabled || !this.context || !this.master) {
      return;
    }

    const start = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.8, start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  collect() {
    this.note(520 + Math.random() * 160, 0.09, "triangle", 0.05);
    this.note(880, 0.12, "sine", 0.035, 0.07);
  }

  sting() {
    this.note(120, 0.2, "sawtooth", 0.055);
  }
}

const audio = new ReefAudio();

function random(min, max) {
  return min + Math.random() * (max - min);
}

function choice(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function lerpAngle(start, end, amount) {
  let difference = ((end - start + Math.PI) % TAU) - Math.PI;
  if (difference < -Math.PI) {
    difference += TAU;
  }
  return start + difference * amount;
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function resizeCanvas() {
  const bounds = canvas.getBoundingClientRect();
  view.width = Math.max(320, Math.floor(bounds.width));
  view.height = Math.max(360, Math.floor(bounds.height));
  view.dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = Math.floor(view.width * view.dpr);
  canvas.height = Math.floor(view.height * view.dpr);
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);

  if (state) {
    state.player.x = clamp(state.player.x, 38, view.width - 38);
    state.player.y = clamp(state.player.y, 56, view.height - 72);
  }
}

function createState() {
  const player = {
    x: view.width * 0.28,
    y: view.height * 0.48,
    radius: 24,
    angle: 0,
    speed: 360,
    hurtTimer: 0,
  };

  pointer.x = player.x;
  pointer.y = player.y;

  return {
    score: 0,
    health: 100,
    rescued: 0,
    missed: 0,
    elapsed: 0,
    spawnTimer: 0.4,
    jellyTimer: 2,
    gameOver: false,
    player,
    debris: [],
    jellies: [],
    particles: [],
    plankton: Array.from({ length: 90 }, () => ({
      x: random(0, view.width),
      y: random(10, view.height - 20),
      radius: random(0.6, 2.3),
      speed: random(5, 24),
      hue: random(145, 205),
      phase: random(0, TAU),
    })),
    fish: Array.from({ length: 11 }, (_, index) => ({
      x: random(0, view.width),
      y: random(80, view.height - 160),
      size: random(0.55, 1.05),
      speed: random(18, 46) * (index % 2 ? 1 : -1),
      color: choice(["#ffd36a", "#ff8c85", "#8bf7ff", "#b3ff9d"]),
      phase: random(0, TAU),
    })),
    corals: Array.from({ length: 9 }, (_, index) => ({
      x: (index / 8) * view.width + random(-22, 22),
      height: random(34, 86),
      width: random(18, 38),
      color: choice(["#ff7c7c", "#ffd36a", "#9bffca", "#c983ff"]),
      phase: random(0, TAU),
    })),
  };
}

function setStatus(message) {
  ui.status.textContent = message;
}

function resetGame() {
  state = createState();
  setStatus("Reef scan active");
  updateHud();
  canvas.focus();
}

function updateHud() {
  ui.score.textContent = String(state.score);
  ui.health.textContent = `${Math.max(0, Math.round(state.health))}%`;
  ui.rescued.textContent = String(state.rescued);
}

function updatePointer(event) {
  const bounds = canvas.getBoundingClientRect();
  pointer.x = event.clientX - bounds.left;
  pointer.y = event.clientY - bounds.top;
  pointer.active = true;
}

function spawnDebris() {
  const type = choice(["bottle", "ring", "wrapper", "can"]);
  state.debris.push({
    type,
    x: view.width + random(35, 140),
    y: random(80, view.height - 112),
    vx: -random(80, 165),
    vy: random(-20, 20),
    radius: type === "ring" ? 20 : 17,
    angle: random(0, TAU),
    spin: random(-1.8, 1.8),
    wobble: random(0, TAU),
    value: type === "ring" ? 16 : 12,
  });
}

function spawnJelly() {
  state.jellies.push({
    x: view.width + random(50, 180),
    y: random(100, view.height - 170),
    vx: -random(42, 88),
    radius: random(25, 36),
    phase: random(0, TAU),
    cooldown: 0,
    color: choice(["#66e5ff", "#ff88ba", "#c983ff"]),
  });
}

function burst(x, y, color, amount = 18) {
  for (let i = 0; i < amount; i += 1) {
    const angle = random(0, TAU);
    const speed = random(32, 190);
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: random(1.6, 4.5),
      life: random(0.45, 0.95),
      maxLife: 0,
      color,
    });
    state.particles[state.particles.length - 1].maxLife =
      state.particles[state.particles.length - 1].life;
  }
}

// GRAPHICS PIPELINE STAGE: APPLICATION
// This stage handles input, object behavior, scoring, collision decisions,
// spawning, audio triggers, and other "what is happening in the app" logic.
function updateApplicationStage(deltaTime) {
  state.elapsed += deltaTime;

  if (state.gameOver) {
    updateAmbientObjects(deltaTime);
    updateParticles(deltaTime);
    return;
  }

  updatePlayer(deltaTime);
  updateAmbientObjects(deltaTime);
  updateDebris(deltaTime);
  updateJellies(deltaTime);
  updateParticles(deltaTime);

  state.spawnTimer -= deltaTime;
  if (state.spawnTimer <= 0) {
    spawnDebris();
    state.spawnTimer = random(0.65, 1.25);
  }

  state.jellyTimer -= deltaTime;
  if (state.jellyTimer <= 0) {
    spawnJelly();
    state.jellyTimer = random(3.2, 5.1);
  }

  if (state.health <= 0) {
    state.gameOver = true;
    setStatus("Reef drone offline");
  }

  updateHud();
}

function updatePlayer(deltaTime) {
  const player = state.player;
  let moveX = 0;
  let moveY = 0;

  if (keys.has("ArrowLeft") || keys.has("a")) moveX -= 1;
  if (keys.has("ArrowRight") || keys.has("d")) moveX += 1;
  if (keys.has("ArrowUp") || keys.has("w")) moveY -= 1;
  if (keys.has("ArrowDown") || keys.has("s")) moveY += 1;

  const keyboardMagnitude = Math.hypot(moveX, moveY);
  let velocityX = 0;
  let velocityY = 0;

  if (keyboardMagnitude > 0) {
    velocityX = (moveX / keyboardMagnitude) * player.speed;
    velocityY = (moveY / keyboardMagnitude) * player.speed;
    player.x += velocityX * deltaTime;
    player.y += velocityY * deltaTime;
  } else if (pointer.active) {
    const dx = pointer.x - player.x;
    const dy = pointer.y - player.y;
    velocityX = dx * 8;
    velocityY = dy * 8;
    player.x += velocityX * deltaTime;
    player.y += velocityY * deltaTime;
  }

  player.x = clamp(player.x, 38, view.width - 38);
  player.y = clamp(player.y, 54, view.height - 74);

  const velocityLength = Math.hypot(velocityX, velocityY);
  if (velocityLength > 5) {
    player.angle = lerpAngle(player.angle, Math.atan2(velocityY, velocityX), 0.16);
  }

  player.hurtTimer = Math.max(0, player.hurtTimer - deltaTime);
}

function updateAmbientObjects(deltaTime) {
  for (const dot of state.plankton) {
    dot.x -= dot.speed * deltaTime;
    dot.y += Math.sin(state.elapsed * 1.4 + dot.phase) * deltaTime * 5;
    if (dot.x < -8) {
      dot.x = view.width + 8;
      dot.y = random(12, view.height - 26);
    }
  }

  for (const fish of state.fish) {
    fish.x += fish.speed * deltaTime;
    fish.y += Math.sin(state.elapsed * 2 + fish.phase) * deltaTime * 16;
    if (fish.speed > 0 && fish.x > view.width + 60) fish.x = -60;
    if (fish.speed < 0 && fish.x < -60) fish.x = view.width + 60;
  }
}

function updateDebris(deltaTime) {
  const player = state.player;
  const remaining = [];

  for (const item of state.debris) {
    item.wobble += deltaTime * 3;
    item.angle += item.spin * deltaTime;
    item.x += item.vx * deltaTime;
    item.y += (item.vy + Math.sin(item.wobble) * 18) * deltaTime;

    if (distance(player, item) < player.radius + item.radius) {
      state.score += item.value;
      state.rescued += 1;
      state.health = clamp(state.health + 2.5, 0, 100);
      setStatus(choice(["Clean current", "Debris captured", "Reef pulse rising"]));
      burst(item.x, item.y, "#9bffca", 22);
      audio.collect();
      continue;
    }

    if (item.x < -70) {
      state.missed += 1;
      state.health -= 4;
      setStatus("Debris slipped past");
      continue;
    }

    remaining.push(item);
  }

  state.debris = remaining;
}

function updateJellies(deltaTime) {
  const player = state.player;
  const remaining = [];

  for (const jelly of state.jellies) {
    jelly.phase += deltaTime * 3.1;
    jelly.x += jelly.vx * deltaTime;
    jelly.y += Math.sin(jelly.phase) * deltaTime * 32;
    jelly.cooldown = Math.max(0, jelly.cooldown - deltaTime);

    if (
      jelly.cooldown <= 0 &&
      distance(player, jelly) < player.radius + jelly.radius * 0.72
    ) {
      state.health -= 14;
      player.hurtTimer = 0.45;
      jelly.cooldown = 1.1;
      setStatus("Static shock detected");
      burst(player.x, player.y, "#ff7c7c", 28);
      audio.sting();
    }

    if (jelly.x > -90) {
      remaining.push(jelly);
    }
  }

  state.jellies = remaining;
}

function updateParticles(deltaTime) {
  const remaining = [];

  for (const particle of state.particles) {
    particle.life -= deltaTime;
    particle.x += particle.vx * deltaTime;
    particle.y += particle.vy * deltaTime;
    particle.vx *= 0.985;
    particle.vy = particle.vy * 0.985 - 8 * deltaTime;

    if (particle.life > 0) {
      remaining.push(particle);
    }
  }

  state.particles = remaining;
}

// GRAPHICS PIPELINE STAGE: GEOMETRY
// Local model points become canvas points here through scale, rotation,
// and translation. This mirrors the geometry stage before pixels are drawn.
function transformVertices(vertices, object) {
  const scale = object.scale || 1;
  const cos = Math.cos(object.angle || 0);
  const sin = Math.sin(object.angle || 0);

  return vertices.map(([x, y]) => ({
    x: object.x + (x * scale * cos - y * scale * sin),
    y: object.y + (x * scale * sin + y * scale * cos),
  }));
}

function drawScene() {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  // GRAPHICS PIPELINE STAGE: RASTERIZATION
  // Everything below uses Canvas 2D draw calls. The browser converts these
  // vector paths, gradients, images-as-shapes, alpha values, and layers into
  // actual screen pixels.
  drawWater();
  drawLightBeams();
  drawPlankton();
  drawFishSchool();
  drawCorals();
  drawDebris();
  drawJellies();
  drawPlayer();
  drawParticles();
  drawOverlay();
}

function drawWater() {
  const gradient = ctx.createLinearGradient(0, 0, 0, view.height);
  gradient.addColorStop(0, "#0b3b45");
  gradient.addColorStop(0.5, "#06242e");
  gradient.addColorStop(1, "#02090c");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, view.width, view.height);

  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = "#66e5ff";
  ctx.lineWidth = 1;
  for (let y = 48; y < view.height; y += 54) {
    ctx.beginPath();
    for (let x = 0; x <= view.width; x += 18) {
      const wave = Math.sin(x * 0.018 + state.elapsed * 1.5 + y * 0.02) * 5;
      if (x === 0) ctx.moveTo(x, y + wave);
      else ctx.lineTo(x, y + wave);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawLightBeams() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.16;
  for (let i = 0; i < 4; i += 1) {
    const offset = ((state.elapsed * 18 + i * 230) % (view.width + 240)) - 120;
    const beam = ctx.createLinearGradient(offset, 0, offset + 120, view.height);
    beam.addColorStop(0, "rgba(155, 255, 202, 0.7)");
    beam.addColorStop(1, "rgba(102, 229, 255, 0)");
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(offset, 0);
    ctx.lineTo(offset + 92, 0);
    ctx.lineTo(offset + 210, view.height);
    ctx.lineTo(offset - 30, view.height);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawPlankton() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const dot of state.plankton) {
    const pulse = 0.55 + Math.sin(state.elapsed * 3 + dot.phase) * 0.35;
    ctx.globalAlpha = 0.18 + pulse * 0.36;
    ctx.fillStyle = `hsl(${dot.hue} 100% 75%)`;
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, dot.radius * (0.8 + pulse), 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawFishSchool() {
  for (const fish of state.fish) {
    // GEOMETRY: translate and flip each fish according to its direction.
    ctx.save();
    ctx.translate(fish.x, fish.y);
    ctx.scale(fish.speed < 0 ? -fish.size : fish.size, fish.size);
    ctx.rotate(Math.sin(state.elapsed * 2 + fish.phase) * 0.08);

    ctx.fillStyle = fish.color;
    ctx.globalAlpha = 0.72;
    ctx.beginPath();
    ctx.ellipse(0, 0, 14, 7, 0, 0, TAU);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(-13, 0);
    ctx.lineTo(-24, -8);
    ctx.lineTo(-22, 8);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#06161c";
    ctx.beginPath();
    ctx.arc(7, -2, 1.8, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

function drawCorals() {
  const floorY = view.height - 42;
  const sand = ctx.createLinearGradient(0, floorY - 12, 0, view.height);
  sand.addColorStop(0, "#3b2730");
  sand.addColorStop(1, "#140d14");
  ctx.fillStyle = sand;
  ctx.fillRect(0, floorY, view.width, view.height - floorY);

  for (const coral of state.corals) {
    const sway = Math.sin(state.elapsed * 1.4 + coral.phase) * 0.12;
    // GEOMETRY: position the coral at the sea floor, then rotate its branches.
    ctx.save();
    ctx.translate(coral.x, floorY + 4);
    ctx.rotate(sway);

    ctx.strokeStyle = coral.color;
    ctx.lineCap = "round";
    ctx.lineWidth = coral.width * 0.28;
    ctx.globalAlpha = 0.9;

    branch(0, 0, -Math.PI / 2, coral.height, coral.width, 0);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = coral.color;
    ctx.beginPath();
    ctx.ellipse(coral.x, floorY + 6, coral.width * 1.4, 8, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

function branch(x, y, angle, length, width, depth) {
  const endX = x + Math.cos(angle) * length;
  const endY = y + Math.sin(angle) * length;
  ctx.lineWidth = Math.max(2, width * (1 - depth * 0.18));
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(endX, endY);
  ctx.stroke();

  if (depth >= 2 || length < 18) {
    return;
  }

  branch(endX, endY, angle - 0.58, length * 0.54, width * 0.74, depth + 1);
  branch(endX, endY, angle + 0.48, length * 0.48, width * 0.68, depth + 1);
}

function drawDebris() {
  for (const item of state.debris) {
    if (item.type === "wrapper") drawWrapper(item);
    if (item.type === "ring") drawRing(item);
    if (item.type === "bottle") drawBottle(item);
    if (item.type === "can") drawCan(item);
  }
}

function drawWrapper(item) {
  const localPoints = [
    [-18, -10],
    [15, -12],
    [21, 3],
    [4, 13],
    [-20, 9],
  ];
  const points = transformVertices(localPoints, item);

  ctx.save();
  ctx.fillStyle = "#ff7c7c";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.78)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.globalAlpha = 0.48;
  ctx.strokeStyle = "#ffd36a";
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  ctx.lineTo(points[2].x, points[2].y);
  ctx.stroke();
  ctx.restore();
}

function drawRing(item) {
  ctx.save();
  // GEOMETRY: move the ring origin, rotate it, then scale its local circle.
  ctx.translate(item.x, item.y);
  ctx.rotate(item.angle);
  ctx.scale(1.18, 0.78);

  ctx.strokeStyle = "#f7fbff";
  ctx.lineWidth = 7;
  ctx.globalAlpha = 0.92;
  ctx.beginPath();
  ctx.arc(0, 0, 13, 0, TAU);
  ctx.stroke();

  ctx.strokeStyle = "#66e5ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 13, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

function drawBottle(item) {
  ctx.save();
  ctx.translate(item.x, item.y);
  ctx.rotate(item.angle);

  const glass = ctx.createLinearGradient(-18, -9, 22, 13);
  glass.addColorStop(0, "rgba(155, 255, 202, 0.28)");
  glass.addColorStop(0.55, "rgba(102, 229, 255, 0.74)");
  glass.addColorStop(1, "rgba(247, 251, 255, 0.38)");
  ctx.fillStyle = glass;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
  ctx.lineWidth = 2;

  roundRectPath(ctx, -20, -9, 34, 18, 6);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#ffd36a";
  roundRectPath(ctx, 12, -5, 10, 10, 3);
  ctx.fill();
  ctx.restore();
}

function drawCan(item) {
  ctx.save();
  ctx.translate(item.x, item.y);
  ctx.rotate(item.angle);

  ctx.fillStyle = "#c983ff";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
  ctx.lineWidth = 2;
  roundRectPath(ctx, -13, -17, 26, 34, 7);
  ctx.fill();
  ctx.stroke();

  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = "#f7fbff";
  ctx.beginPath();
  ctx.moveTo(-10, -8);
  ctx.lineTo(10, -8);
  ctx.moveTo(-10, 8);
  ctx.lineTo(10, 8);
  ctx.stroke();
  ctx.restore();
}

function drawJellies() {
  for (const jelly of state.jellies) {
    const bob = Math.sin(jelly.phase) * 4;
    ctx.save();
    // GEOMETRY: translate to the jelly's center and scale by its radius.
    ctx.translate(jelly.x, jelly.y + bob);
    ctx.scale(jelly.radius / 32, jelly.radius / 32);

    const cap = ctx.createRadialGradient(-8, -8, 4, 0, 0, 35);
    cap.addColorStop(0, "rgba(255, 255, 255, 0.92)");
    cap.addColorStop(0.22, jelly.color);
    cap.addColorStop(1, "rgba(102, 229, 255, 0.05)");

    ctx.globalAlpha = 0.82;
    ctx.fillStyle = cap;
    ctx.beginPath();
    ctx.moveTo(-30, 4);
    ctx.bezierCurveTo(-24, -28, 24, -28, 30, 4);
    ctx.quadraticCurveTo(18, 16, 0, 12);
    ctx.quadraticCurveTo(-18, 16, -30, 4);
    ctx.fill();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.68)";
    ctx.lineWidth = 2;
    for (let i = -2; i <= 2; i += 1) {
      ctx.beginPath();
      ctx.moveTo(i * 10, 10);
      for (let y = 16; y <= 54; y += 8) {
        const wave = Math.sin(state.elapsed * 5 + y * 0.22 + i) * 5;
        ctx.lineTo(i * 8 + wave, y);
      }
      ctx.stroke();
    }

    ctx.fillStyle = "#06161c";
    ctx.globalAlpha = 0.86;
    ctx.beginPath();
    ctx.arc(-7, -2, 2.4, 0, TAU);
    ctx.arc(7, -2, 2.4, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

function drawPlayer() {
  const player = state.player;
  const flash = player.hurtTimer > 0 && Math.floor(player.hurtTimer * 18) % 2 === 0;

  ctx.save();
  // GEOMETRY: the drone body is modeled around (0,0), then translated and
  // rotated into its current world position.
  ctx.translate(player.x, player.y);
  ctx.rotate(player.angle);

  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = flash ? "#ff7c7c" : "#66e5ff";
  ctx.beginPath();
  ctx.ellipse(0, 0, 42, 25, 0, 0, TAU);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;

  const body = ctx.createLinearGradient(-28, -16, 34, 17);
  body.addColorStop(0, flash ? "#ffb1a8" : "#f7fbff");
  body.addColorStop(0.5, "#66e5ff");
  body.addColorStop(1, "#156675");

  ctx.fillStyle = body;
  ctx.strokeStyle = "#021115";
  ctx.lineWidth = 3;
  roundRectPath(ctx, -30, -16, 60, 32, 16);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#06161c";
  ctx.beginPath();
  ctx.arc(12, -3, 5, 0, TAU);
  ctx.fill();

  ctx.fillStyle = "#9bffca";
  ctx.beginPath();
  ctx.arc(14, -5, 1.8, 0, TAU);
  ctx.fill();

  drawPropeller(-35, 0);

  ctx.strokeStyle = "#ffd36a";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(18, 14);
  ctx.quadraticCurveTo(24, 30, 5, 36);
  ctx.stroke();

  ctx.restore();
}

function drawPropeller(x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(state.elapsed * 24);
  ctx.fillStyle = "rgba(247, 251, 255, 0.72)";
  for (let i = 0; i < 3; i += 1) {
    ctx.rotate(TAU / 3);
    ctx.beginPath();
    ctx.ellipse(0, -8, 3.5, 11, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawParticles() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const particle of state.particles) {
    const alpha = clamp(particle.life / particle.maxLife, 0, 1);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.radius * (0.5 + alpha), 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawOverlay() {
  ctx.save();
  ctx.globalAlpha = 0.32;
  ctx.fillStyle = "#02090c";
  ctx.fillRect(0, 0, view.width, 54);
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "#f7fbff";
  ctx.font = "800 16px Inter, system-ui, sans-serif";
  ctx.fillText("Neon Reef Rescue", 22, 32);
  ctx.fillStyle = "#9bffca";
  ctx.font = "700 13px Inter, system-ui, sans-serif";
  ctx.fillText(`cleared ${state.rescued} | missed ${state.missed}`, 176, 32);
  ctx.restore();

  if (!pointer.active && !state.gameOver) {
    ctx.save();
    ctx.fillStyle = "rgba(2, 9, 12, 0.52)";
    ctx.fillRect(0, 54, view.width, view.height - 54);
    ctx.fillStyle = "#f7fbff";
    ctx.textAlign = "center";
    ctx.font = "850 24px Inter, system-ui, sans-serif";
    ctx.fillText("Start the reef scan", view.width / 2, view.height / 2 - 10);
    ctx.font = "700 14px Inter, system-ui, sans-serif";
    ctx.fillStyle = "#b9cad3";
    ctx.fillText("Move with mouse, touch, WASD, or arrow keys", view.width / 2, view.height / 2 + 20);
    ctx.restore();
  }

  if (state.gameOver) {
    ctx.save();
    ctx.fillStyle = "rgba(2, 9, 12, 0.68)";
    ctx.fillRect(0, 0, view.width, view.height);
    ctx.textAlign = "center";
    ctx.fillStyle = "#ff7c7c";
    ctx.font = "900 34px Inter, system-ui, sans-serif";
    ctx.fillText("Reef Drone Offline", view.width / 2, view.height / 2 - 18);
    ctx.fillStyle = "#f7fbff";
    ctx.font = "750 16px Inter, system-ui, sans-serif";
    ctx.fillText(`Final score: ${state.score}`, view.width / 2, view.height / 2 + 16);
    ctx.fillStyle = "#9bffca";
    ctx.fillText("Press Restart to run another rescue", view.width / 2, view.height / 2 + 44);
    ctx.restore();
  }
}

function roundRectPath(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function frame(timeStamp) {
  if (!lastFrameTime) {
    lastFrameTime = timeStamp;
  }

  const deltaTime = Math.min(0.033, (timeStamp - lastFrameTime) / 1000);
  lastFrameTime = timeStamp;

  updateApplicationStage(deltaTime);
  drawScene();
  requestAnimationFrame(frame);
}

canvas.addEventListener("pointermove", updatePointer);
canvas.addEventListener("pointerdown", async (event) => {
  updatePointer(event);
  canvas.focus();
  if (audio.enabled) {
    await audio.ensure();
  }
});

window.addEventListener("keydown", async (event) => {
  keys.add(event.key);
  pointer.active = true;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(event.key)) {
    event.preventDefault();
  }
  if (audio.enabled) {
    await audio.ensure();
  }
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.key);
});

window.addEventListener("resize", resizeCanvas);

ui.reset.addEventListener("click", resetGame);
ui.sound.addEventListener("click", async () => {
  await audio.setEnabled(!audio.enabled);
});

resizeCanvas();
resetGame();
requestAnimationFrame(frame);