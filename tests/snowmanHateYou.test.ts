import assert from "node:assert/strict";
import test from "node:test";
import { SNOWMAN_GROUND, SNOWMAN_GAPS, createSnowmanGame, startSnowmanGame, stepSnowmanGame } from "../apps/snowman-hate-you/game.ts";

test("starts a fresh winter hike with three tries", () => {
  const game = createSnowmanGame(240);
  assert.equal(game.status, "ready");
  assert.equal(game.lives, 3);
  assert.equal(game.bestDistance, 240);
  assert.equal(startSnowmanGame(game).status, "playing");
});

test("moves, jumps once per press, and lands back on the snow", () => {
  let game = startSnowmanGame(createSnowmanGame());
  game = stepSnowmanGame(game, 40, { direction: 1, jump: true });
  assert.ok(game.x > 40);
  assert.ok(game.y < SNOWMAN_GROUND - 34);
  for (let i = 0; i < 20; i++) game = stepSnowmanGame(game, 40, { direction: 0, jump: true });
  assert.equal(game.grounded, true);
  assert.equal(game.jumpReady, false);
  const heldJump = stepSnowmanGame(game, 40, { direction: 0, jump: true });
  assert.equal(heldJump.grounded, true);
  assert.equal(heldJump.y, SNOWMAN_GROUND - 34);
});

test("falling into a gap costs a try and respawns at the checkpoint", () => {
  let game = startSnowmanGame(createSnowmanGame());
  game = { ...game, x: SNOWMAN_GAPS[0]![0] - 10, snowmanCooldowns: [5000, 5000, 5000, 5000] };
  for (let i = 0; i < 45 && game.lives === 3; i++) game = stepSnowmanGame(game, 40, { direction: 1, jump: false });
  assert.equal(game.lives, 2);
  assert.equal(game.x, 32);
  assert.equal(game.grounded, true);
});

test("snowmen throw dodgeable snowballs and the last hit ends the run", () => {
  let game = startSnowmanGame(createSnowmanGame());
  game = { ...game, x: 190, snowmanCooldowns: [0, 5000, 5000, 5000] };
  for (let i = 0; i < 100 && game.lives === 3; i++) game = stepSnowmanGame(game, 40, { direction: 0, jump: false });
  assert.equal(game.lives, 2);

  game = { ...game, lives: 1, x: 200, y: SNOWMAN_GROUND - 34, velocityY: 0, grounded: true, snowballs: [{ id: 99, x: 211, y: SNOWMAN_GROUND - 14, direction: -1 }] };
  const over = stepSnowmanGame(game, 0, { direction: 0, jump: false });
  assert.equal(over.status, "over");
  assert.equal(over.lives, 0);
});

test("reaching home wins and remembers the furthest distance", () => {
  let game = startSnowmanGame(createSnowmanGame());
  game = { ...game, x: 2012, snowmanCooldowns: [5000, 5000, 5000, 5000] };
  const won = stepSnowmanGame(game, 40, { direction: 1, jump: false });
  assert.equal(won.status, "won");
  assert.ok(won.bestDistance >= Math.floor(won.x));
});
