export type PongStatus = "ready" | "playing" | "paused" | "over";
export type PongState = {
  ball: { x: number; y: number; vx: number; vy: number };
  playerY: number;
  cpuY: number;
  playerScore: number;
  cpuScore: number;
  status: PongStatus;
};

export const PONG_WIDTH = 600;
export const PONG_HEIGHT = 360;
export const PADDLE_HEIGHT = 78;
export const PADDLE_WIDTH = 9;
export const BALL_RADIUS = 7;
export const WINNING_SCORE = 7;
const PLAYER_X = 27;
const CPU_X = PONG_WIDTH - PLAYER_X;
const PLAYER_SPEED = 330;
const CPU_SPEED = 235;
const INITIAL_BALL_SPEED = 280;

export function createPongGame(): PongState {
  return {
    ball: { x: PONG_WIDTH / 2, y: PONG_HEIGHT / 2, vx: 0, vy: 0 },
    playerY: PONG_HEIGHT / 2,
    cpuY: PONG_HEIGHT / 2,
    playerScore: 0,
    cpuScore: 0,
    status: "ready",
  };
}

export function servePong(state: PongState, random: () => number = Math.random): PongState {
  const direction = random() < 0.5 ? -1 : 1;
  const angle = (random() - 0.5) * 0.52;
  return {
    ...state,
    ball: {
      x: PONG_WIDTH / 2,
      y: PONG_HEIGHT / 2,
      vx: Math.cos(angle) * INITIAL_BALL_SPEED * direction,
      vy: Math.sin(angle) * INITIAL_BALL_SPEED,
    },
    status: "playing",
  };
}

export function movePongPaddle(y: number, direction: -1 | 0 | 1, deltaMs: number): number {
  const next = y + direction * PLAYER_SPEED * Math.min(Math.max(deltaMs, 0), 50) / 1000;
  return clamp(next, PADDLE_HEIGHT / 2, PONG_HEIGHT - PADDLE_HEIGHT / 2);
}

export function stepPong(state: PongState, deltaMs: number, playerDirection: -1 | 0 | 1 = 0): PongState {
  if (state.status !== "playing") return state;

  const seconds = Math.min(Math.max(deltaMs, 0), 50) / 1000;
  const playerY = movePongPaddle(state.playerY, playerDirection, deltaMs);
  const cpuDelta = clamp(state.ball.y - state.cpuY, -CPU_SPEED * seconds, CPU_SPEED * seconds);
  const cpuY = clamp(state.cpuY + cpuDelta, PADDLE_HEIGHT / 2, PONG_HEIGHT - PADDLE_HEIGHT / 2);
  let { x, y, vx, vy } = state.ball;
  x += vx * seconds;
  y += vy * seconds;

  if (y - BALL_RADIUS < 0) {
    y = BALL_RADIUS;
    vy = Math.abs(vy);
  } else if (y + BALL_RADIUS > PONG_HEIGHT) {
    y = PONG_HEIGHT - BALL_RADIUS;
    vy = -Math.abs(vy);
  }

  if (vx < 0 && x - BALL_RADIUS <= PLAYER_X + PADDLE_WIDTH / 2 && x >= PLAYER_X - PADDLE_WIDTH) {
    if (Math.abs(y - playerY) <= PADDLE_HEIGHT / 2 + BALL_RADIUS) {
      ({ vx, vy } = bounceFromPaddle(vx, vy, y, playerY));
      x = PLAYER_X + PADDLE_WIDTH / 2 + BALL_RADIUS;
    }
  } else if (vx > 0 && x + BALL_RADIUS >= CPU_X - PADDLE_WIDTH / 2 && x <= CPU_X + PADDLE_WIDTH) {
    if (Math.abs(y - cpuY) <= PADDLE_HEIGHT / 2 + BALL_RADIUS) {
      ({ vx, vy } = bounceFromPaddle(vx, vy, y, cpuY));
      x = CPU_X - PADDLE_WIDTH / 2 - BALL_RADIUS;
    }
  }

  if (x + BALL_RADIUS < 0) {
    const cpuScore = state.cpuScore + 1;
    const next = { ...state, playerY, cpuY, cpuScore, status: cpuScore >= WINNING_SCORE ? "over" as const : "playing" as const };
    return cpuScore >= WINNING_SCORE ? next : resetServe(next, -1);
  }
  if (x - BALL_RADIUS > PONG_WIDTH) {
    const playerScore = state.playerScore + 1;
    const next = { ...state, playerY, cpuY, playerScore, status: playerScore >= WINNING_SCORE ? "over" as const : "playing" as const };
    return playerScore >= WINNING_SCORE ? next : resetServe(next, 1);
  }

  return { ...state, playerY, cpuY, ball: { x, y, vx, vy } };
}

function resetServe(state: PongState, direction: -1 | 1): PongState {
  return {
    ...state,
    ball: { x: PONG_WIDTH / 2, y: PONG_HEIGHT / 2, vx: INITIAL_BALL_SPEED * direction, vy: 0 },
  };
}

function bounceFromPaddle(vx: number, vy: number, ballY: number, paddleY: number) {
  const offset = clamp((ballY - paddleY) / (PADDLE_HEIGHT / 2), -1, 1);
  return {
    vx: Math.sign(vx) * -Math.min(520, Math.abs(vx) * 1.045),
    vy: clamp(vy + offset * 210, -450, 450),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
