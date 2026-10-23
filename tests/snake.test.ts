import assert from "node:assert/strict";
import test from "node:test";
import { changeDirection, createGame, nextTickMs, placeFood, stepGame, type SnakeState } from "../apps/snake/game.ts";

test("Snake rejects an immediate reverse direction", () => {
  const game = createGame(() => 0);
  assert.equal(changeDirection(game, "left"), game);
  assert.equal(changeDirection(game, "up").direction, "up");
});

test("food is placed on a free cell and reports a full board", () => {
  assert.deepEqual(placeFood([{ x: 0, y: 0 }], () => 0, 2), { x: 1, y: 0 });
  assert.equal(placeFood([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }], () => 0, 2), null);
});

test("eating grows the snake and increases score", () => {
  const game: SnakeState = { body: [{ x: 1, y: 1 }, { x: 0, y: 1 }], direction: "right", food: { x: 2, y: 1 }, score: 0, status: "playing" };
  const next = stepGame(game, () => 0, 4);
  assert.equal(next.score, 1);
  assert.equal(next.body.length, 3);
  assert.notDeepEqual(next.food, next.body[0]);
});

test("wall and body collisions end the round", () => {
  const atWall: SnakeState = { body: [{ x: 1, y: 0 }], direction: "up", food: { x: 3, y: 3 }, score: 0, status: "playing" };
  assert.equal(stepGame(atWall).status, "over");
  const intoBody: SnakeState = { body: [{ x: 2, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }], direction: "left", food: { x: 3, y: 3 }, score: 0, status: "playing" };
  assert.equal(stepGame(intoBody).status, "over");
});

test("filling the final cell wins and speed has a lower time bound", () => {
  const finalFood: SnakeState = { body: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }], direction: "right", food: { x: 1, y: 0 }, score: 2, status: "playing" };
  const won = stepGame(finalFood, () => 0, 2);
  assert.equal(won.status, "won");
  assert.equal(won.body.length, 4);
  assert.equal(nextTickMs(1000), 65);
});
