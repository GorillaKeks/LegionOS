import { useEffect, useRef, useState } from "react";
import { createSnowmanGame, SNOWMAN_GAPS, SNOWMAN_GOAL, SNOWMAN_GROUND, SNOWMAN_HEIGHT, SNOWMAN_POSITIONS, SNOWMAN_WIDTH, SNOWMAN_WORLD_WIDTH, startSnowmanGame, stepSnowmanGame, type SnowmanControls, type SnowmanGameState } from "./game.ts";
import { t, type Language } from "../../src/i18n";
import "./snowman.css";

const BEST_KEY = "legion-os.snowman-hate-you.best-distance.v1";
function readBest(): number { try { return Math.max(0, Number(localStorage.getItem(BEST_KEY)) || 0); } catch { return 0; } }
function saveBest(value: number): void { try { localStorage.setItem(BEST_KEY, String(value)); } catch { /* Local storage may be unavailable. */ } }

export default function SnowmanHateYouApp({ active, language }: { active: boolean; language: Language }) {
  const [game, setGame] = useState<SnowmanGameState>(() => createSnowmanGame(readBest()));
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const held = useRef(new Set<string>());
  useEffect(() => {
    if (active || game.status !== "playing") return;
    held.current.clear();
    setGame((state) => state.status === "playing" ? { ...state, status: "paused" } : state);
  }, [active, game.status]);

  useEffect(() => {
    if (!active) return;
    const keyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!["arrowleft", "arrowright", "a", "d", "arrowup", "w", " "].includes(key)) return;
      if (event.target instanceof HTMLElement && event.target.closest("input,textarea,select,button,[contenteditable='true']")) return;
      event.preventDefault();
      held.current.add(key);
    };
    const keyUp = (event: KeyboardEvent) => held.current.delete(event.key.toLowerCase());
    const blur = () => {
      held.current.clear();
      setGame((state) => state.status === "playing" ? { ...state, status: "paused" } : state);
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", blur);
    return () => { held.current.clear(); window.removeEventListener("keydown", keyDown); window.removeEventListener("keyup", keyUp); window.removeEventListener("blur", blur); };
  }, [active]);

  useEffect(() => {
    if (!active || game.status !== "playing") return;
    const timer = window.setInterval(() => {
      const controls: SnowmanControls = {
        direction: (Number(held.current.has("arrowright") || held.current.has("d") || held.current.has("touchright")) - Number(held.current.has("arrowleft") || held.current.has("a") || held.current.has("touchleft"))) as -1 | 0 | 1,
        jump: ["arrowup", "w", " ", "touchjump"].some((key) => held.current.has(key)),
      };
      setGame((state) => stepSnowmanGame(state, 40, controls));
    }, 40);
    return () => window.clearInterval(timer);
  }, [active, game.status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const camera = Math.max(0, Math.min(SNOWMAN_WORLD_WIDTH - SNOWMAN_WIDTH, game.x - 170));
    const sky = ctx.createLinearGradient(0, 0, 0, SNOWMAN_HEIGHT);
    sky.addColorStop(0, "#102332"); sky.addColorStop(1, "#1a3342");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, SNOWMAN_WIDTH, SNOWMAN_HEIGHT);
    ctx.fillStyle = "rgba(190,233,245,.16)";
    for (let i = 0; i < 30; i++) { const x = (i * 97 + 23) % SNOWMAN_WIDTH; const y = (i * 61 + 17) % 230; ctx.fillRect(x, y, i % 4 === 0 ? 2 : 1, i % 4 === 0 ? 2 : 1); }
    for (let i = 0; i < 7; i++) {
      const x = ((i * 173 - camera * .24) % (SNOWMAN_WIDTH + 100) + SNOWMAN_WIDTH + 100) % (SNOWMAN_WIDTH + 100) - 50;
      ctx.fillStyle = i % 2 ? "#112630" : "#142c38"; ctx.beginPath(); ctx.moveTo(x - 82, SNOWMAN_GROUND); ctx.quadraticCurveTo(x, 104 + (i % 3) * 16, x + 82, SNOWMAN_GROUND); ctx.fill();
    }
    ctx.fillStyle = "#dcecf0";
    let segment = 0;
    for (const [a, b] of SNOWMAN_GAPS) { const left = segment - camera; ctx.fillRect(left, SNOWMAN_GROUND, a - segment, SNOWMAN_HEIGHT - SNOWMAN_GROUND); segment = b; }
    ctx.fillRect(segment - camera, SNOWMAN_GROUND, SNOWMAN_WIDTH + camera - segment, SNOWMAN_HEIGHT - SNOWMAN_GROUND);
    ctx.fillStyle = "rgba(98,202,221,.22)"; ctx.fillRect(0, SNOWMAN_GROUND, SNOWMAN_WIDTH, 3);
    for (const point of [760, 1450]) {
      const px = point - camera; if (px < -15 || px > SNOWMAN_WIDTH + 15) continue;
      ctx.fillStyle = point <= game.checkpoint ? "#6de0c1" : "#7d9baa"; ctx.fillRect(px, SNOWMAN_GROUND - 39, 3, 39); ctx.beginPath(); ctx.arc(px + 8, SNOWMAN_GROUND - 34, 8, 0, Math.PI * 2); ctx.fill();
    }
    const goalX = SNOWMAN_GOAL - camera;
    ctx.fillStyle = "#65d8e9"; ctx.fillRect(goalX, SNOWMAN_GROUND - 66, 3, 66); ctx.fillRect(goalX + 3, SNOWMAN_GROUND - 64, 45, 17);
    ctx.fillStyle = "#0b202b"; ctx.font = "bold 8px sans-serif"; ctx.fillText("HOME", goalX + 8, SNOWMAN_GROUND - 53);
    for (let i = 0; i < SNOWMAN_POSITIONS.length; i++) {
      const x = SNOWMAN_POSITIONS[i]! - camera; if (x < -35 || x > SNOWMAN_WIDTH + 35) continue;
      ctx.shadowBlur = 10; ctx.shadowColor = "rgba(168,232,246,.3)";
      ctx.fillStyle = "#dce8eb"; ctx.beginPath(); ctx.arc(x, SNOWMAN_GROUND - 17, 14, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(x, SNOWMAN_GROUND - 38, 10, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = "#15242c"; ctx.fillRect(x - 4, SNOWMAN_GROUND - 41, 2, 2); ctx.fillRect(x + 3, SNOWMAN_GROUND - 41, 2, 2);
      ctx.fillStyle = "#f0a36f"; ctx.beginPath(); ctx.moveTo(x, SNOWMAN_GROUND - 37); ctx.lineTo(x + 8, SNOWMAN_GROUND - 35); ctx.lineTo(x, SNOWMAN_GROUND - 33); ctx.fill();
      ctx.fillStyle = "#7bb9c8"; ctx.fillRect(x - 10, SNOWMAN_GROUND - 28, 20, 4);
      ctx.fillStyle = "#1a2730"; ctx.fillRect(x - 8, SNOWMAN_GROUND - 51, 16, 3); ctx.fillRect(x - 5, SNOWMAN_GROUND - 60, 10, 10);
    }
    for (const ball of game.snowballs) { ctx.fillStyle = "#f5fbff"; ctx.shadowBlur = 8; ctx.shadowColor = "#a8e8f6"; ctx.beginPath(); ctx.arc(ball.x - camera, ball.y, 8, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; }
    const px = game.x - camera;
    ctx.fillStyle = "#62d8e9"; ctx.shadowBlur = 9; ctx.shadowColor = "#62d8e9"; ctx.fillRect(px + 4, game.y + 13, 14, 18); ctx.shadowBlur = 0;
    ctx.fillStyle = "#d5f8ff"; ctx.beginPath(); ctx.arc(px + 11, game.y + 9, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#172a35"; ctx.fillRect(px + 3, game.y + 1, 16, 3); ctx.fillRect(px + 7, game.y - 5, 9, 7);
    ctx.fillStyle = "#f0a36f"; ctx.fillRect(px + 14, game.y + 9, 6, 2);
  }, [game]);

  useEffect(() => { if (game.bestDistance > readBest()) saveBest(game.bestDistance); }, [game.bestDistance]);
  const touch = (key: string, down: boolean) => { if (down) held.current.add(key); else held.current.delete(key); };
  const statusKey = ({ ready: "snowman.ready", playing: "snowman.playing", paused: "snowman.paused", over: "snowman.over", won: "snowman.won" } as const)[game.status];
  const statusLabel = t(language, statusKey);
  return <section className="snowman-game" aria-label={t(language, "snowman.label")}>
    <header className="snowman-head"><div><span className="snowman-kicker">LEGION ARCADE</span><h2>Snowman Hate You<span>.</span></h2></div><div className="snowman-stats"><div><small>{t(language, "snowman.lives")}</small><strong>{"♥".repeat(game.lives)}{"♡".repeat(3 - game.lives)}</strong></div><div><small>{t(language, "snowman.best")}</small><strong>{game.bestDistance} m</strong></div></div></header>
    <div className="snowman-field" role="group" aria-label={`${t(language, "snowman.label")}: ${statusLabel}`}><canvas ref={canvasRef} width={SNOWMAN_WIDTH} height={SNOWMAN_HEIGHT} aria-hidden="true"/>
      {game.status !== "playing" && <div className="snowman-overlay"><strong>{t(language, game.status === "ready" ? "snowman.title" : statusKey)}</strong><span>{t(language, game.status === "ready" ? "snowman.instructions" : game.status === "over" ? "snowman.gameOverText" : game.status === "won" ? "snowman.victoryText" : "snowman.pausedText")}</span><button type="button" onClick={() => setGame((state) => state.status === "paused" ? { ...state, status: "playing" } : startSnowmanGame(state))}>{t(language, game.status === "ready" ? "snowman.start" : game.status === "paused" ? "snowman.resume" : "snowman.playAgain")}</button></div>}
    </div>
    <div className="snowman-controls"><div className="snowman-pad">{([["touchleft", "←"], ["touchright", "→"], ["touchjump", t(language, "snowman.jump")]] as const).map(([key, label]) => <button key={key} type="button" className={key === "touchjump" ? "snowman-jump" : ""} aria-label={key === "touchjump" ? t(language, "snowman.jump") : key === "touchleft" ? t(language, "snowman.left") : t(language, "snowman.right")} onPointerDown={(event) => { event.preventDefault(); touch(key, true); }} onPointerUp={() => touch(key, false)} onPointerCancel={() => touch(key, false)} onPointerLeave={() => touch(key, false)}>{label}</button>)}</div><small>{t(language, "snowman.controls")}</small></div>
  </section>;
}
