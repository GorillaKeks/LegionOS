export type InvadersStatus = "ready" | "playing" | "paused" | "over" | "won";
export type Invader = { id: number; x: number; y: number };
export type InvaderBullet = { id: number; x: number; y: number; velocity: number };
export type InvadersBoss = { x: number; y: number; health: number; maxHealth: number; direction: -1 | 1; shotCooldownMs: number };
export type InvadersState = {
  status: InvadersStatus;
  score: number;
  playerX: number;
  aliens: Invader[];
  boss: InvadersBoss | null;
  playerShots: InvaderBullet[];
  enemyShots: InvaderBullet[];
  alienDirection: -1 | 1;
  alienMoveMs: number;
  shotCooldownMs: number;
  nextId: number;
};
export type InvadersControls = { direction: -1 | 0 | 1; fire: boolean };

export const INVADERS_WIDTH = 480;
export const INVADERS_HEIGHT = 320;
export const INVADERS_WIN_SCORE = 320;
const PLAYER_Y = 288;
const PLAYER_WIDTH = 32;
const PLAYER_HEIGHT = 18;
const ALIEN_WIDTH = 24;
const ALIEN_HEIGHT = 18;
const BOSS_WIDTH = 92;
const BOSS_HEIGHT = 42;
const BOSS_HEALTH = 12;

export function createInvadersGame(): InvadersState {
  const aliens: Invader[] = [];
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 8; column++) {
      aliens.push({ id: row * 8 + column, x: 54 + column * 47, y: 42 + row * 32 });
    }
  }
  return { status: "ready", score: 0, playerX: INVADERS_WIDTH / 2, aliens, boss: null, playerShots: [], enemyShots: [], alienDirection: 1, alienMoveMs: 0, shotCooldownMs: 0, nextId: aliens.length };
}

export function startInvaders(state: InvadersState): InvadersState {
  return { ...(state.status === "over" || state.status === "won" ? createInvadersGame() : state), status: "playing" };
}

export function stepInvaders(state: InvadersState, deltaMs: number, controls: InvadersControls, random: () => number = Math.random): InvadersState {
  if (state.status !== "playing") return state;
  const delta = Math.min(Math.max(deltaMs, 0), 50);
  const seconds = delta / 1000;
  const playerX = clamp(state.playerX + controls.direction * 245 * seconds, PLAYER_WIDTH / 2, INVADERS_WIDTH - PLAYER_WIDTH / 2);
  let nextId = state.nextId;
  let shotCooldownMs = Math.max(0, state.shotCooldownMs - delta);
  let playerShots = state.playerShots.map((shot) => ({ ...shot, y: shot.y - shot.velocity * seconds })).filter((shot) => shot.y > -8);
  let enemyShots = state.enemyShots.map((shot) => ({ ...shot, y: shot.y + shot.velocity * seconds })).filter((shot) => shot.y < INVADERS_HEIGHT + 8);
  if (controls.fire && shotCooldownMs === 0) {
    playerShots = [...playerShots, { id: nextId++, x: playerX, y: PLAYER_Y - PLAYER_HEIGHT / 2, velocity: 330 }];
    shotCooldownMs = 270;
  }

  let aliens = state.aliens;
  let score = state.score;
  const remainingShots: InvaderBullet[] = [];
  for (const shot of playerShots) {
    const hitIndex = aliens.findIndex((alien) => Math.abs(shot.x - (alien.x + ALIEN_WIDTH / 2)) < (ALIEN_WIDTH + 4) / 2 && Math.abs(shot.y - (alien.y + ALIEN_HEIGHT / 2)) < (ALIEN_HEIGHT + 5) / 2);
    if (hitIndex < 0) remainingShots.push(shot);
    else {
      aliens = aliens.filter((_, index) => index !== hitIndex);
      score += 10;
    }
  }
  playerShots = remainingShots;
  let boss = state.boss;
  if (aliens.length === 0 && !boss) {
    boss = { x: INVADERS_WIDTH / 2, y: 44, health: BOSS_HEALTH, maxHealth: BOSS_HEALTH, direction: 1, shotCooldownMs: 900 };
  }

  if (boss) {
    const bossHalfWidth = BOSS_WIDTH / 2;
    let health = boss.health;
    const bossShots: InvaderBullet[] = [];
    for (const shot of playerShots) {
      const hit = Math.abs(shot.x - boss.x) <= bossHalfWidth && shot.y >= boss.y && shot.y <= boss.y + BOSS_HEIGHT;
      if (hit) {
        health -= 1;
        score += 25;
      } else bossShots.push(shot);
    }
    playerShots = bossShots;
    if (health <= 0) {
      return { ...state, status: "won", score, playerX, aliens: [], boss: { ...boss, health: 0 }, playerShots, enemyShots, shotCooldownMs, nextId };
    }

    let bossDirection = boss.direction;
    let bossX = boss.x + bossDirection * 128 * seconds;
    if (bossX + bossHalfWidth >= INVADERS_WIDTH - 8) {
      bossX = INVADERS_WIDTH - 8 - bossHalfWidth;
      bossDirection = -1;
    } else if (bossX - bossHalfWidth <= 8) {
      bossX = 8 + bossHalfWidth;
      bossDirection = 1;
    }
    let bossShotCooldownMs = Math.max(0, boss.shotCooldownMs - delta);
    if (bossShotCooldownMs === 0) {
      for (const offset of [-25, 0, 25]) enemyShots.push({ id: nextId++, x: bossX + offset, y: boss.y + BOSS_HEIGHT, velocity: 205 });
      bossShotCooldownMs = 950;
    }
    const playerHit = enemyShots.some((shot) => Math.abs(shot.x - playerX) < (PLAYER_WIDTH + 4) / 2 && Math.abs(shot.y - PLAYER_Y) < (PLAYER_HEIGHT + 5) / 2);
    boss = { ...boss, x: bossX, health, direction: bossDirection, shotCooldownMs: bossShotCooldownMs };
    return { ...state, status: playerHit ? "over" : "playing", score, playerX, aliens: [], boss, playerShots, enemyShots, shotCooldownMs, nextId };
  }

  let alienDirection = state.alienDirection;
  let alienMoveMs = state.alienMoveMs + delta;
  const moveInterval = Math.max(105, 520 - (32 - aliens.length) * 11);
  while (alienMoveMs >= moveInterval) {
    alienMoveMs -= moveInterval;
    const left = Math.min(...aliens.map((alien) => alien.x));
    const right = Math.max(...aliens.map((alien) => alien.x + ALIEN_WIDTH));
    const hitsEdge = alienDirection < 0 ? left - 12 <= 0 : right + 12 >= INVADERS_WIDTH;
    if (hitsEdge) {
      alienDirection = alienDirection === 1 ? -1 : 1;
      aliens = aliens.map((alien) => ({ ...alien, y: alien.y + 13 }));
    } else {
      aliens = aliens.map((alien) => ({ ...alien, x: alien.x + alienDirection * 12 }));
    }
  }

  if (random() < 0.025 && aliens.length > 0) {
    const shooter = aliens[Math.floor(random() * aliens.length)]!;
    enemyShots = [...enemyShots, { id: nextId++, x: shooter.x + ALIEN_WIDTH / 2, y: shooter.y + ALIEN_HEIGHT, velocity: 165 }];
  }
  const playerHit = enemyShots.some((shot) => Math.abs(shot.x - playerX) < (PLAYER_WIDTH + 4) / 2 && Math.abs(shot.y - PLAYER_Y) < (PLAYER_HEIGHT + 5) / 2);
  const aliensReachedPlayer = aliens.some((alien) => alien.y + ALIEN_HEIGHT >= PLAYER_Y - 10);
  return { ...state, status: playerHit || aliensReachedPlayer ? "over" : "playing", score, playerX, aliens, boss, playerShots, enemyShots, alienDirection, alienMoveMs, shotCooldownMs, nextId };
}

export function clampInvadersPlayer(x: number): number {
  return clamp(x, PLAYER_WIDTH / 2, INVADERS_WIDTH - PLAYER_WIDTH / 2);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
