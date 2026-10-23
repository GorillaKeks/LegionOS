export type Direction = "up" | "down" | "left" | "right";
export type Point = { x: number; y: number };
export type GameStatus = "ready" | "playing" | "paused" | "over" | "won";
export type SnakeState = { body: Point[]; direction: Direction; food: Point | null; score: number; status: GameStatus };
export const BOARD_SIZE = 20;
export const STARTING_SNAKE: Point[] = [{ x: 8, y: 10 }, { x: 7, y: 10 }, { x: 6, y: 10 }];

export function placeFood(body: Point[], random: () => number = Math.random, size = BOARD_SIZE): Point | null {
  const free: Point[] = [];
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    if (!body.some((part) => part.x === x && part.y === y)) free.push({ x, y });
  }
  if (free.length === 0) return null;
  return free[Math.min(free.length - 1, Math.floor(random() * free.length))];
}

export function createGame(random: () => number = Math.random): SnakeState {
  return { body: STARTING_SNAKE.map((part) => ({ ...part })), direction: "right", food: placeFood(STARTING_SNAKE, random), score: 0, status: "ready" };
}

export function changeDirection(state: SnakeState, next: Direction): SnakeState {
  const opposite: Record<Direction, Direction> = { up: "down", down: "up", left: "right", right: "left" };
  if (opposite[state.direction] === next) return state;
  return { ...state, direction: next };
}

export function stepGame(state: SnakeState, random: () => number = Math.random, size = BOARD_SIZE): SnakeState {
  if (state.status !== "playing") return state;
  const vector: Record<Direction, Point> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
  const delta = vector[state.direction];
  const head = { x: state.body[0].x + delta.x, y: state.body[0].y + delta.y };
  const eating = state.food !== null && head.x === state.food.x && head.y === state.food.y;
  const collisionBody = eating ? state.body : state.body.slice(0, -1);
  if (head.x < 0 || head.y < 0 || head.x >= size || head.y >= size || collisionBody.some((part) => part.x === head.x && part.y === head.y)) {
    return { ...state, status: "over" };
  }
  const body = [head, ...state.body.slice(0, eating ? undefined : -1)];
  const food = eating ? placeFood(body, random, size) : state.food;
  return { ...state, body, food, score: state.score + (eating ? 1 : 0), status: food === null ? "won" : state.status };
}

export function nextTickMs(score: number): number {
  return Math.max(65, 145 - Math.floor(Math.max(0, score) / 3) * 8);
}
