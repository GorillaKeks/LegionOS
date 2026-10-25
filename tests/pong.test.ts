import test from "node:test";
import assert from "node:assert/strict";
import { BALL_RADIUS, PADDLE_HEIGHT, PONG_HEIGHT, PONG_WIDTH, WINNING_SCORE, createPongGame, movePongPaddle, servePong, stepPong } from "../apps/pong/game.ts";

test("Pong starts centered and serves into the field", () => {
  const ready = createPongGame();
  assert.equal(ready.status, "ready");
  assert.deepEqual(ready.ball, { x: PONG_WIDTH / 2, y: PONG_HEIGHT / 2, vx: 0, vy: 0 });
  const playing = servePong(ready, () => 0.75);
  assert.equal(playing.status, "playing");
  assert.ok(playing.ball.vx > 0);
});

test("paddle movement clamps to court bounds", () => {
  assert.equal(movePongPaddle(PADDLE_HEIGHT / 2, -1, 50), PADDLE_HEIGHT / 2);
  assert.equal(movePongPaddle(PONG_HEIGHT - PADDLE_HEIGHT / 2, 1, 50), PONG_HEIGHT - PADDLE_HEIGHT / 2);
});

test("ball bounces from the top wall and a player paddle", () => {
  const wallBounce = stepPong({ ...servePong(createPongGame(), () => 0.25), ball: { x: 300, y: BALL_RADIUS + 1, vx: 0, vy: -200 } }, 16);
  assert.ok(wallBounce.ball.vy > 0);

  const paddleBounce = stepPong({ ...createPongGame(), status: "playing", playerY: 180, ball: { x: 42, y: 180, vx: -280, vy: 0 } }, 16);
  assert.ok(paddleBounce.ball.vx > 0);
});

test("missed ball awards a point and the first to seven wins", () => {
  let state = { ...createPongGame(), status: "playing" as const, ball: { x: 6, y: 20, vx: -300, vy: 0 } };
  state = stepPong(state, 50);
  assert.equal(state.cpuScore, 1);
  assert.equal(state.ball.x, PONG_WIDTH / 2);
  assert.equal(state.status, "playing");

  state = { ...state, cpuScore: WINNING_SCORE - 1, ball: { x: 6, y: 20, vx: -300, vy: 0 } };
  state = stepPong(state, 50);
  assert.equal(state.cpuScore, WINNING_SCORE);
  assert.equal(state.status, "over");
});

test("inactive game states do not advance", () => {
  const state = createPongGame();
  assert.equal(stepPong(state, 16), state);
});
