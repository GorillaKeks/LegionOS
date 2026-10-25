import { useCallback, useEffect, useRef, useState } from "react";
import { BALL_RADIUS, PADDLE_HEIGHT, PADDLE_WIDTH, PONG_HEIGHT, PONG_WIDTH, WINNING_SCORE, createPongGame, servePong, stepPong, type PongState } from "./game.ts";
import "./pong.css";

const RECORD_KEY = "legion-os.pong.best-score.v1";
const keys = new Set(["arrowup", "arrowdown", "w", "s"]);

function readRecord(): number {
  try { return Math.max(0, Number(window.localStorage.getItem(RECORD_KEY)) || 0); } catch { return 0; }
}

function writeRecord(score: number): void {
  try { window.localStorage.setItem(RECORD_KEY, String(score)); } catch { /* Local storage may be unavailable. */ }
}

export default function PongApp({ active }: { active: boolean }) {
  const [game, setGame] = useState<PongState>(() => createPongGame());
  const [best, setBest] = useState(readRecord);
  const held = useRef(new Set<string>());
  const gameRef = useRef(game);
  gameRef.current = game;

  const start = useCallback(() => setGame((current) => servePong(current.status === "over" ? createPongGame() : current)), []);
  const togglePause = useCallback(() => setGame((current) => {
    if (current.status === "playing") return { ...current, status: "paused" };
    if (current.status === "paused") return { ...current, status: "playing" };
    if (current.status === "ready") return servePong(current);
    return current;
  }), []);

  useEffect(() => {
    if (active || gameRef.current.status !== "playing") return;
    held.current.clear();
    setGame((current) => current.status === "playing" ? { ...current, status: "paused" } : current);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!keys.has(key)) {
        if (event.code === "Space" && !event.repeat) {
          const target = event.target;
          if (!(target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true']"))) {
            event.preventDefault();
            togglePause();
          }
        }
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      held.current.add(key);
    };
    const onKeyUp = (event: KeyboardEvent) => { held.current.delete(event.key.toLowerCase()); };
    const onBlur = () => {
      held.current.clear();
      setGame((current) => current.status === "playing" ? { ...current, status: "paused" } : current);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [active, togglePause]);

  useEffect(() => {
    if (!active || game.status !== "playing") return;
    let frame = 0;
    let lastTime = 0;
    const animate = (time: number) => {
      const delta = lastTime === 0 ? 16 : Math.min(50, time - lastTime);
      lastTime = time;
      const up = held.current.has("arrowup") || held.current.has("w") || held.current.has("touchup");
      const down = held.current.has("arrowdown") || held.current.has("s") || held.current.has("touchdown");
      const direction = up === down ? 0 : up ? -1 : 1;
      setGame((current) => stepPong(current, delta, direction));
      frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [active, game.status]);

  useEffect(() => {
    if (game.playerScore > best) {
      setBest(game.playerScore);
      writeRecord(game.playerScore);
    }
  }, [best, game.playerScore]);

  const setTouchDirection = (direction: -1 | 1, pressed: boolean) => {
    const key = direction < 0 ? "touchup" : "touchdown";
    if (pressed) held.current.add(key);
    else held.current.delete(key);
  };
  const up = held.current.has("arrowup") || held.current.has("w") || held.current.has("touchup");
  const down = held.current.has("arrowdown") || held.current.has("s") || held.current.has("touchdown");
  const startPosition = (y: number) => `${(y / PONG_HEIGHT) * 100}%`;
  const statusText = game.status === "ready" ? "Bereit für den Aufschlag" : game.status === "playing" ? "Runde läuft" : game.status === "paused" ? "Pausiert" : game.playerScore >= WINNING_SCORE ? "Du hast gewonnen" : "Die CPU gewinnt";

  return <section className="pong-app" aria-label="Pong gegen LegionOS">
    <header className="pong-heading"><div><span className="pong-kicker">LEGION ARCADE</span><h2>Pong<span>.</span></h2></div><div className="pong-scoreboard" aria-label={`Spielstand ${game.playerScore} zu ${game.cpuScore}`}><div><small>DU</small><strong>{game.playerScore}</strong></div><i aria-hidden="true">:</i><div><small>CPU</small><strong>{game.cpuScore}</strong></div><span className="pong-best">BEST <b>{best}</b></span></div></header>
    <div className={`pong-court pong-status-${game.status}`} role="group" aria-label={`Pong-Spielfeld. ${statusText}. Spielstand ${game.playerScore} zu ${game.cpuScore}.`}>
      <div className="pong-center-line" aria-hidden="true"/>
      <div className="pong-center-mark" aria-hidden="true"/>
      <span className="pong-paddle pong-player" style={{ top: startPosition(game.playerY), height: `${(PADDLE_HEIGHT / PONG_HEIGHT) * 100}%`, width: `${(PADDLE_WIDTH / PONG_WIDTH) * 100}%` }}/>
      <span className="pong-paddle pong-cpu" style={{ top: startPosition(game.cpuY), height: `${(PADDLE_HEIGHT / PONG_HEIGHT) * 100}%`, width: `${(PADDLE_WIDTH / PONG_WIDTH) * 100}%` }}/>
      <span className="pong-ball" style={{ left: `${(game.ball.x / PONG_WIDTH) * 100}%`, top: `${(game.ball.y / PONG_HEIGHT) * 100}%`, width: `${(BALL_RADIUS * 2 / PONG_WIDTH) * 100}%` }}/>
      {game.status !== "playing" && <div className="pong-overlay"><strong>{game.status === "ready" ? "Pong Arcade" : game.status === "paused" ? "Pausiert" : statusText}</strong><span>{game.status === "ready" ? `Erreiche ${WINNING_SCORE} Punkte vor der CPU.` : game.status === "paused" ? "Setze die Runde fort, wenn du bereit bist." : `Endstand ${game.playerScore} : ${game.cpuScore}`}</span><button type="button" onClick={game.status === "paused" ? togglePause : start}>{game.status === "ready" ? "Spiel starten" : game.status === "paused" ? "Fortsetzen" : "Neue Runde"}</button></div>}
    </div>
    <div className="pong-controls"><span>Steuerung</span><div className="pong-touch-controls"><button type="button" aria-label="Schläger nach oben bewegen" aria-pressed={up} onPointerDown={(event) => { event.preventDefault(); setTouchDirection(-1, true); }} onPointerUp={() => setTouchDirection(-1, false)} onPointerCancel={() => setTouchDirection(-1, false)} onPointerLeave={() => setTouchDirection(-1, false)}>↑</button><button type="button" aria-label="Schläger nach unten bewegen" aria-pressed={down} onPointerDown={(event) => { event.preventDefault(); setTouchDirection(1, true); }} onPointerUp={() => setTouchDirection(1, false)} onPointerCancel={() => setTouchDirection(1, false)} onPointerLeave={() => setTouchDirection(1, false)}>↓</button></div><small>Pfeiltasten oder W / S · Erster bis {WINNING_SCORE}</small><div className="pong-actions"><button type="button" onClick={togglePause} disabled={game.status === "over" || game.status === "ready"}>{game.status === "paused" ? "Fortsetzen" : "Pause"}</button><button type="button" onClick={() => setGame(createPongGame())}>Neustart</button></div></div>
  </section>;
}
