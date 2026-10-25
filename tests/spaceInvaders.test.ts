import assert from "node:assert/strict";
import test from "node:test";
import { INVADERS_HEIGHT, INVADERS_WIDTH, createInvadersGame, startInvaders, stepInvaders } from "../apps/space-invaders/game.ts";

test("starts with a ready formation and begins on request", () => {
  const ready = createInvadersGame();
  assert.equal(ready.aliens.length, 32);
  assert.equal(ready.status, "ready");
  assert.equal(startInvaders(ready).status, "playing");
});

test("player movement stays inside the field and held fire produces shots", () => {
  const playing = startInvaders(createInvadersGame());
  const moved = stepInvaders(playing, 50, { direction: -1, fire: true }, () => 1);
  assert.ok(moved.playerX >= 16 && moved.playerX < playing.playerX);
  assert.equal(moved.playerShots.length, 1);
  let atLeftEdge = { ...playing, playerX: 16 };
  for (let i = 0; i < 20; i++) atLeftEdge = stepInvaders(atLeftEdge, 50, { direction: -1, fire: false }, () => 1);
  assert.equal(atLeftEdge.playerX, 16);
  let atRightEdge = { ...playing, playerX: INVADERS_WIDTH - 16 };
  for (let i = 0; i < 20; i++) atRightEdge = stepInvaders(atRightEdge, 50, { direction: 1, fire: false }, () => 1);
  assert.equal(atRightEdge.playerX, INVADERS_WIDTH - 16);
});

test("the final alien starts a multi-hit boss fight instead of ending the round", () => {
  const game = startInvaders(createInvadersGame());
  const target = game.aliens[0]!;
  const state = { ...game, aliens: [target], playerX: target.x + 12, playerShots: [{ id: 99, x: target.x + 12, y: target.y + 18, velocity: 330 }], shotCooldownMs: 10_000 };
  const bossFight = stepInvaders(state, 40, { direction: 0, fire: false }, () => 1);
  assert.equal(bossFight.score, 10);
  assert.equal(bossFight.aliens.length, 0);
  assert.equal(bossFight.status, "playing");
  assert.equal(bossFight.boss?.health, 12);
  assert.equal(bossFight.boss?.maxHealth, 12);
});

test("boss takes repeated hits, moves and fires a three-shot volley", () => {
  const game = startInvaders(createInvadersGame());
  const bossFight = stepInvaders({ ...game, aliens: [] }, 40, { direction: 0, fire: false }, () => 1);
  const boss = bossFight.boss!;
  const volley = stepInvaders({ ...bossFight, boss: { ...boss, shotCooldownMs: 1 } }, 10, { direction: 0, fire: false }, () => 1);
  assert.equal(volley.enemyShots.length, 3);
  assert.ok(volley.boss!.x > boss.x);
  const finalHits = { ...bossFight, boss: { ...boss, health: 2 }, playerShots: [1, 2].map((id) => ({ id, x: boss.x, y: boss.y + 20, velocity: 330 })) };
  const won = stepInvaders(finalHits, 0, { direction: 0, fire: false }, () => 1);
  assert.equal(won.boss?.health, 0);
  assert.equal(won.status, "won");
  assert.equal(won.score, bossFight.score + 50);
});

test("enemy fire can end a round, and paused games do not advance", () => {
  const game = startInvaders(createInvadersGame());
  const hit = stepInvaders({ ...game, enemyShots: [{ id: 77, x: game.playerX, y: 286, velocity: 1 }] }, 40, { direction: 0, fire: false }, () => 1);
  assert.equal(hit.status, "over");
  const paused = { ...game, status: "paused" as const };
  assert.equal(stepInvaders(paused, 40, { direction: 1, fire: true }), paused);
  assert.equal(INVADERS_HEIGHT, 320);
});
