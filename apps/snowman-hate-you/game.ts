export type SnowmanStatus = "ready" | "playing" | "paused" | "over" | "won";
export type SnowmanControls = { direction: -1 | 0 | 1; jump: boolean };
export type Snowball = { id: number; x: number; y: number; direction: -1 | 1 };
export type SnowmanGameState = {
  status: SnowmanStatus;
  x: number;
  y: number;
  velocityY: number;
  grounded: boolean;
  jumpReady: boolean;
  lives: number;
  checkpoint: number;
  bestDistance: number;
  snowballs: Snowball[];
  snowmanCooldowns: number[];
  nextId: number;
};

export const SNOWMAN_WIDTH = 640;
export const SNOWMAN_HEIGHT = 350;
export const SNOWMAN_WORLD_WIDTH = 2100;
export const SNOWMAN_GROUND = 280;
export const SNOWMAN_PLAYER_WIDTH = 22;
export const SNOWMAN_PLAYER_HEIGHT = 34;
export const SNOWMAN_POSITIONS = [390, 850, 1370, 1835] as const;
export const SNOWMAN_GAPS = [[560, 630], [1030, 1120], [1590, 1680]] as const;
export const SNOWMAN_CHECKPOINTS = [0, 760, 1450] as const;
export const SNOWMAN_GOAL = 2020;
const SNOWBALL_RADIUS = 9;

export function createSnowmanGame(bestDistance = 0): SnowmanGameState {
  return {
    status: "ready", x: 40, y: SNOWMAN_GROUND - SNOWMAN_PLAYER_HEIGHT,
    velocityY: 0, grounded: true, jumpReady: true, lives: 3, checkpoint: 0,
    bestDistance: Math.max(0, bestDistance), snowballs: [],
    snowmanCooldowns: SNOWMAN_POSITIONS.map(() => 400), nextId: 1,
  };
}

export function startSnowmanGame(state: SnowmanGameState): SnowmanGameState {
  const base = state.status === "over" || state.status === "won" ? createSnowmanGame(state.bestDistance) : state;
  return { ...base, status: "playing" };
}

export function stepSnowmanGame(state: SnowmanGameState, deltaMs: number, controls: SnowmanControls): SnowmanGameState {
  if (state.status !== "playing") return state;
  const dt = Math.min(Math.max(deltaMs, 0), 50) / 1000;
  let x = Math.max(0, Math.min(SNOWMAN_WORLD_WIDTH - SNOWMAN_PLAYER_WIDTH, state.x + controls.direction * 205 * dt));
  let y = state.y;
  let velocityY = state.velocityY;
  let grounded = state.grounded;
  let jumpReady = state.jumpReady;
  if (!controls.jump) jumpReady = true;
  if (controls.jump && grounded && jumpReady) {
    velocityY = -390;
    grounded = false;
    jumpReady = false;
  }
  velocityY += 980 * dt;
  y += velocityY * dt;
  const centerX = x + SNOWMAN_PLAYER_WIDTH / 2;
  const inGap = SNOWMAN_GAPS.some(([start, end]) => centerX > start && centerX < end);
  if (!inGap && velocityY >= 0 && y < SNOWMAN_GROUND && y + SNOWMAN_PLAYER_HEIGHT >= SNOWMAN_GROUND) {
    y = SNOWMAN_GROUND - SNOWMAN_PLAYER_HEIGHT;
    velocityY = 0;
    grounded = true;
  } else if (inGap) {
    grounded = false;
  }

  let lives = state.lives;
  let checkpoint = state.checkpoint;
  const newCheckpoint = [...SNOWMAN_CHECKPOINTS].reverse().find((point) => x >= point);
  if (newCheckpoint !== undefined) checkpoint = newCheckpoint;
  let snowballs = state.snowballs.map((ball) => ({ ...ball, x: ball.x + ball.direction * 185 * dt })).filter((ball) => ball.x > x - 180 && ball.x < x + 820);
  let cooldowns = state.snowmanCooldowns.map((value) => Math.max(0, value - deltaMs));
  let nextId = state.nextId;
  for (let i = 0; i < SNOWMAN_POSITIONS.length; i++) {
    const snowmanX = SNOWMAN_POSITIONS[i]!;
    if (Math.abs(centerX - snowmanX) < 235 && cooldowns[i] === 0) {
      snowballs = [...snowballs, { id: nextId++, x: snowmanX, y: SNOWMAN_GROUND - 14, direction: centerX < snowmanX ? -1 : 1 }];
      cooldowns[i] = 1800;
    }
  }
  const playerTop = y;
  const playerBottom = y + SNOWMAN_PLAYER_HEIGHT;
  const struck = snowballs.some((ball) => Math.abs(ball.x - centerX) < SNOWMAN_PLAYER_WIDTH / 2 + SNOWBALL_RADIUS && ball.y + SNOWBALL_RADIUS > playerTop && ball.y - SNOWBALL_RADIUS < playerBottom);
  const fell = y > SNOWMAN_HEIGHT + 20;
  if (struck || fell) {
    lives -= 1;
    if (lives <= 0) return { ...state, status: "over", lives: 0, bestDistance: Math.max(state.bestDistance, Math.floor(x)) };
    x = checkpoint + 32;
    y = SNOWMAN_GROUND - SNOWMAN_PLAYER_HEIGHT;
    velocityY = 0;
    grounded = true;
    snowballs = [];
    cooldowns = cooldowns.map((value) => Math.max(value, 1200));
  }
  const bestDistance = Math.max(state.bestDistance, Math.floor(x));
  return {
    ...state, status: x >= SNOWMAN_GOAL ? "won" : "playing", x, y, velocityY, grounded,
    lives, checkpoint, bestDistance, snowballs, snowmanCooldowns: cooldowns, nextId, jumpReady,
  };
}
