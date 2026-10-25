import { useCallback, useEffect, useRef, useState } from "react";
import { BOARD_SIZE, changeDirection, createGame, nextTickMs, stepGame, type Direction, type SnakeState } from "./game.ts";
import { t, type Language } from "../../src/i18n";
import "./snake.css";

const RECORD_KEY = "legion-os.snake.high-score.v1";
const directionKeys: Record<string, Direction> = { ArrowUp: "up", w: "up", W: "up", ArrowDown: "down", s: "down", S: "down", ArrowLeft: "left", a: "left", A: "left", ArrowRight: "right", d: "right", D: "right" };
const directionGlyph: Record<Direction, string> = { up: "↑", down: "↓", left: "←", right: "→" };

function readRecord(): number {
  try { return Math.max(0, Number(window.localStorage.getItem(RECORD_KEY)) || 0); } catch { return 0; }
}
function writeRecord(score: number): void {
  try { window.localStorage.setItem(RECORD_KEY, String(score)); } catch { /* Host storage can be disabled. */ }
}

export default function SnakeApp({ active, language }: { active: boolean; language: Language }) {
  const [game, setGame] = useState<SnakeState>(() => createGame());
  const [best, setBest] = useState(readRecord);
  const gameRef = useRef(game);
  gameRef.current = game;

  const start = useCallback(() => setGame((current) => ({ ...(current.status === "ready" || current.status === "over" || current.status === "won" ? createGame() : current), status: "playing" })), []);
  const togglePause = useCallback(() => setGame((current) => current.status === "playing" ? { ...current, status: "paused" } : current.status === "paused" || current.status === "ready" ? { ...current, status: "playing" } : current), []);

  useEffect(() => {
    if (!active && gameRef.current.status === "playing") setGame((current) => current.status === "playing" ? { ...current, status: "paused" } : current);
  }, [active]);
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = directionKeys[event.key];
      if (!direction) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      setGame((current) => current.status === "playing" ? changeDirection(current, direction) : current);
    };
    const onBlur = () => setGame((current) => current.status === "playing" ? { ...current, status: "paused" } : current);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onBlur);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("blur", onBlur); };
  }, [active]);
  useEffect(() => {
    if (!active || game.status !== "playing") return;
    const timer = window.setInterval(() => setGame((current) => stepGame(current)), nextTickMs(game.score));
    return () => window.clearInterval(timer);
  }, [active, game.status, game.score]);
  useEffect(() => {
    if (game.score <= best) return;
    setBest(game.score);
    writeRecord(game.score);
  }, [best, game.score]);

  const handleDirection = (direction: Direction) => setGame((current) => current.status === "playing" ? changeDirection(current, direction) : current);
  const statusKey = { ready: "snake.ready", playing: "snake.running", paused: "snake.paused", over: "snake.over", won: "snake.wonStatus" }[game.status];
  const statusText = t(language, statusKey);

  return <section className="snake-app" aria-label={t(language, "snake.label")}>
    <header className="snake-heading"><div><span className="snake-kicker">LEGION ARCADE</span><h2>Snake<span>.</span></h2></div><div className="snake-scores"><div><small>{t(language, "snake.points")}</small><strong>{game.score.toString().padStart(2, "0")}</strong></div><div><small>{t(language, "snake.best")}</small><strong>{best.toString().padStart(2, "0")}</strong></div></div></header>
    <div className={`snake-board snake-status-${game.status}`} role="group" aria-label={`${t(language, "snake.label")}, ${game.score} ${t(language, "snake.points")}, ${statusText}`} style={{ "--snake-size": BOARD_SIZE } as React.CSSProperties}>
      {Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => {
        const x = index % BOARD_SIZE; const y = Math.floor(index / BOARD_SIZE);
        const bodyIndex = game.body.findIndex((part) => part.x === x && part.y === y);
        const isFood = game.food?.x === x && game.food?.y === y;
        return <span key={index} className={`snake-cell${bodyIndex === 0 ? " snake-head" : bodyIndex > 0 ? " snake-body" : ""}${isFood ? " snake-food" : ""}`} style={{ gridColumn: x + 1, gridRow: y + 1 }}/>;
      })}
      {game.status !== "playing" && <div className="snake-overlay"><strong>{game.status === "ready" ? t(language, "snake.title") : game.status === "paused" ? t(language, "snake.paused") : game.status === "won" ? t(language, "snake.won") : t(language, "snake.gameOver")}</strong><span>{game.status === "ready" ? t(language, "snake.collect") : game.status === "over" ? t(language, "snake.roundEnded", { score: game.score }) : game.status === "won" ? t(language, "snake.boardFull") : t(language, "snake.continueReady")}</span>{game.status !== "won" && <button type="button" onClick={game.status === "ready" ? start : game.status === "paused" ? togglePause : start}>{game.status === "ready" ? t(language, "snake.start") : game.status === "paused" ? t(language, "snake.resume") : t(language, "snake.newRound")}</button>}</div>}
    </div>
    <div className="snake-controls"><div className="snake-dpad" aria-label={t(language, "common.direction")}>
      <span/><button type="button" aria-label={t(language, "snake.up")} onClick={() => handleDirection("up")}>{directionGlyph.up}</button><span/>
      <button type="button" aria-label={t(language, "snake.left")} onClick={() => handleDirection("left")}>{directionGlyph.left}</button><button type="button" aria-label={t(language, "snake.down")} onClick={() => handleDirection("down")}>{directionGlyph.down}</button><button type="button" aria-label={t(language, "snake.right")} onClick={() => handleDirection("right")}>{directionGlyph.right}</button>
    </div><div className="snake-actions"><button type="button" onClick={togglePause} disabled={game.status === "over" || game.status === "won" || game.status === "ready"}>{game.status === "paused" ? t(language, "snake.resume") : t(language, "common.pause")}</button><button type="button" onClick={start}>{t(language, "common.restart")}</button></div></div>
    <p className="snake-hint">{t(language, "snake.controls")}</p>
  </section>;
}
