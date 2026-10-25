import { useCallback, useEffect, useRef, useState } from "react";
import { createInvadersGame, INVADERS_HEIGHT, INVADERS_WIDTH, startInvaders, stepInvaders, type InvadersControls, type InvadersState } from "./game.ts";
import { t, type Language } from "../../src/i18n";
import "./space-invaders.css";

const RECORD_KEY = "legion-os.space-invaders.best-score.v1";

function readRecord(): number {
  try { return Math.max(0, Number(window.localStorage.getItem(RECORD_KEY)) || 0); } catch { return 0; }
}

function writeRecord(score: number): void {
  try { window.localStorage.setItem(RECORD_KEY, String(score)); } catch { /* Local storage may be unavailable. */ }
}

export default function SpaceInvadersApp({ active, language }: { active: boolean; language: Language }) {
  const [game, setGame] = useState<InvadersState>(() => createInvadersGame());
  const [best, setBest] = useState(readRecord);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const held = useRef(new Set<string>());

  const start = useCallback(() => setGame((current) => startInvaders(current)), []);
  const togglePause = useCallback(() => setGame((current) => current.status === "playing" ? { ...current, status: "paused" } : current.status === "paused" || current.status === "ready" ? startInvaders(current) : current), []);

  useEffect(() => {
    if (active || game.status !== "playing") return;
    held.current.clear();
    setGame((current) => current.status === "playing" ? { ...current, status: "paused" } : current);
  }, [active, game.status]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!["arrowleft", "arrowright", "a", "d", " "].includes(key)) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, button, [contenteditable='true']")) return;
      event.preventDefault();
      held.current.add(key);
    };
    const onKeyUp = (event: KeyboardEvent) => held.current.delete(event.key.toLowerCase());
    const onBlur = () => {
      held.current.clear();
      setGame((current) => current.status === "playing" ? { ...current, status: "paused" } : current);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      held.current.clear();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [active]);

  useEffect(() => {
    if (!active || game.status !== "playing") return;
    const timer = window.setInterval(() => {
      const controls: InvadersControls = {
        direction: (Number(held.current.has("arrowright") || held.current.has("d") || held.current.has("touchright")) - Number(held.current.has("arrowleft") || held.current.has("a") || held.current.has("touchleft"))) as -1 | 0 | 1,
        fire: held.current.has(" "),
      };
      setGame((current) => stepInvaders(current, 40, controls));
    }, 40);
    return () => window.clearInterval(timer);
  }, [active, game.status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, INVADERS_WIDTH, INVADERS_HEIGHT);
    context.fillStyle = "#08111a";
    context.fillRect(0, 0, INVADERS_WIDTH, INVADERS_HEIGHT);
    context.strokeStyle = "rgba(99,177,196,.075)";
    context.lineWidth = 1;
    for (let x = 0; x < INVADERS_WIDTH; x += 32) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, INVADERS_HEIGHT); context.stroke(); }
    for (let y = 0; y < INVADERS_HEIGHT; y += 32) { context.beginPath(); context.moveTo(0, y); context.lineTo(INVADERS_WIDTH, y); context.stroke(); }
    context.shadowBlur = 12;
    context.shadowColor = "#61dff1";
    context.fillStyle = "#61dff1";
    for (const alien of game.aliens) {
      context.fillRect(alien.x + 3, alien.y + 4, 18, 10);
      context.fillRect(alien.x, alien.y + 8, 5, 6);
      context.fillRect(alien.x + 19, alien.y + 8, 5, 6);
      context.fillRect(alien.x + 5, alien.y + 14, 4, 4);
      context.fillRect(alien.x + 15, alien.y + 14, 4, 4);
    }
    if (game.boss) {
      const left = game.boss.x - 46;
      context.shadowColor = "#b58cff";
      context.fillStyle = "#8063b8";
      context.fillRect(left + 13, game.boss.y + 8, 66, 24);
      context.fillRect(left + 4, game.boss.y + 14, 84, 16);
      context.fillRect(left + 20, game.boss.y + 3, 52, 8);
      context.fillRect(left, game.boss.y + 20, 16, 10);
      context.fillRect(left + 76, game.boss.y + 20, 16, 10);
      context.fillStyle = "#d7c5ff";
      context.fillRect(game.boss.x - 15, game.boss.y + 15, 10, 6);
      context.fillRect(game.boss.x + 5, game.boss.y + 15, 10, 6);
      context.shadowColor = "#f3ad72";
      context.fillStyle = "#f3ad72";
      context.fillRect(left + 9, game.boss.y + 31, 7, 7);
      context.fillRect(left + 76, game.boss.y + 31, 7, 7);
    }
    context.fillRect(game.playerX - 16, 280, 32, 8);
    context.fillRect(game.playerX - 7, 273, 14, 7);
    context.fillRect(game.playerX - 2, 267, 4, 6);
    context.shadowColor = "#c4f6ff";
    context.fillStyle = "#c4f6ff";
    for (const shot of game.playerShots) context.fillRect(shot.x - 2, shot.y - 6, 4, 12);
    context.shadowColor = "#f3ad72";
    context.fillStyle = "#f3ad72";
    for (const shot of game.enemyShots) context.fillRect(shot.x - 2, shot.y - 5, 4, 10);
    context.shadowBlur = 0;
    context.fillStyle = "rgba(103,219,189,.55)";
    context.fillRect(12, 305, INVADERS_WIDTH - 24, 1);
  }, [game]);

  useEffect(() => {
    if (game.score <= best) return;
    setBest(game.score);
    writeRecord(game.score);
  }, [best, game.score]);

  const setControl = (key: string, pressed: boolean) => {
    if (pressed) held.current.add(key);
    else held.current.delete(key);
  };
  const statusKey = { ready: "invaders.ready", playing: "invaders.playing", paused: "invaders.paused", over: "invaders.over", won: "invaders.won" }[game.status];
  const status = t(language, game.boss && game.status === "playing" ? "invaders.bossApproach" : statusKey);

  return <section className="space-invaders-app" aria-label={t(language, "invaders.label")}>
    <header className="invaders-heading"><div><span className="invaders-kicker">LEGION ARCADE</span><h2>Space Invaders<span>.</span></h2></div><div className="invaders-scores"><div><small>{t(language, "invaders.score")}</small><strong>{game.score.toString().padStart(3, "0")}</strong></div><div><small>{t(language, "invaders.best")}</small><strong>{best.toString().padStart(3, "0")}</strong></div></div></header>
    {game.boss && game.status === "playing" && <div className="invaders-boss-health"><span>{t(language, "invaders.boss")}</span><progress max={game.boss.maxHealth} value={game.boss.health}/><strong>{game.boss.health}/{game.boss.maxHealth}</strong></div>}
    <div className={`invaders-field invaders-status-${game.status}`} role="group" aria-label={`${t(language, "invaders.label")}: ${status}. ${t(language, "invaders.score")}: ${game.score}`}>
      <canvas ref={canvasRef} width={INVADERS_WIDTH} height={INVADERS_HEIGHT} aria-hidden="true"/>
      {game.status !== "playing" && <div className="invaders-overlay"><strong>{t(language, game.status === "ready" ? "invaders.title" : statusKey)}</strong><span>{t(language, game.status === "ready" ? "invaders.instructions" : game.status === "over" ? "invaders.gameOverText" : game.status === "won" ? "invaders.victoryText" : "invaders.pausedText")}</span><button type="button" onClick={game.status === "paused" ? togglePause : start}>{t(language, game.status === "ready" ? "invaders.start" : game.status === "paused" ? "invaders.resume" : "invaders.playAgain")}</button></div>}
    </div>
    <div className="invaders-controls"><div className="invaders-dpad"><button type="button" aria-label={t(language, "invaders.left")} onPointerDown={(event) => { event.preventDefault(); setControl("touchleft", true); }} onPointerUp={() => setControl("touchleft", false)} onPointerCancel={() => setControl("touchleft", false)} onPointerLeave={() => setControl("touchleft", false)}>←</button><button type="button" aria-label={t(language, "invaders.right")} onPointerDown={(event) => { event.preventDefault(); setControl("touchright", true); }} onPointerUp={() => setControl("touchright", false)} onPointerCancel={() => setControl("touchright", false)} onPointerLeave={() => setControl("touchright", false)}>→</button><button type="button" aria-label={t(language, "invaders.fire")} onPointerDown={(event) => { event.preventDefault(); setControl(" ", true); }} onPointerUp={() => setControl(" ", false)} onPointerCancel={() => setControl(" ", false)} onPointerLeave={() => setControl(" ", false)}>{t(language, "invaders.fire")}</button></div><small>{t(language, "invaders.controls")}</small><div className="invaders-actions"><button type="button" onClick={togglePause} disabled={game.status === "ready" || game.status === "over" || game.status === "won"}>{game.status === "paused" ? t(language, "invaders.resume") : t(language, "common.pause")}</button><button type="button" onClick={() => setGame(createInvadersGame())}>{t(language, "common.restart")}</button></div></div>
  </section>;
}
