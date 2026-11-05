import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { isTauri } from "@tauri-apps/api/core";
import type { Language } from "../../src/i18n";
import { spotifyBackend, toBackendError, type BackendError, type PlaylistSummary, type SpotifyProfile, type SpotifyStatus } from "./backend.ts";
import { spotifyPlayer } from "./player.ts";
import { currentPosition, nextRepeatMode } from "./playerController.ts";
import { backendErrorMessage, formatTime, st } from "./strings.ts";
import "./spotify.css";

type Props = { language: Language };
type Tab = "player" | "playlists" | "account";

const EXAMPLE_CONFIG = `{\n  "clientId": "YOUR_32_CHARACTER_CLIENT_ID",\n  "redirectPort": 0\n}`;

export default function SpotifyApp({ language }: Props) {
  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  const [statusError, setStatusError] = useState<BackendError | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<BackendError | null>(null);
  const [tab, setTab] = useState<Tab>("player");
  const mounted = useRef(true);

  const refreshStatus = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const next = await spotifyBackend.status();
      if (mounted.current) { setStatus(next); setStatusError(null); }
    } catch (error) {
      if (mounted.current) setStatusError(toBackendError(error));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refreshStatus();
    return () => { mounted.current = false; };
  }, [refreshStatus]);

  const connect = async () => {
    setConnecting(true);
    setConnectError(null);
    try {
      await spotifyBackend.connect();
    } catch (error) {
      if (mounted.current) setConnectError(toBackendError(error));
    } finally {
      if (mounted.current) setConnecting(false);
      await refreshStatus();
    }
  };

  if (!isTauri()) return <Shell language={language}><p className="spotify-message">{st(language, "error.not_configured")}</p></Shell>;
  if (!status) {
    return <Shell language={language}>
      {statusError ? <ErrorBox language={language} error={statusError} onRetry={() => void refreshStatus()}/> : <p className="spotify-muted" role="status">{st(language, "status.loading")}</p>}
    </Shell>;
  }

  if (!status.configured) {
    return <Shell language={language}>
      <section className="spotify-card">
        <h3>{st(language, "setup.title")}</h3>
        <p>{st(language, "setup.body")}</p>
        {status.configError && <p className="spotify-message spotify-error" role="alert">{st(language, "setup.invalid")} {status.configError}</p>}
        <span className="spotify-label">{st(language, "setup.example")}</span>
        <pre className="spotify-code">{EXAMPLE_CONFIG}</pre>
        <span className="spotify-label">{st(language, "setup.redirect")}</span>
        <pre className="spotify-code">{status.redirectUri}</pre>
        <button type="button" className="spotify-button" onClick={() => void refreshStatus()}>{st(language, "setup.recheck")}</button>
      </section>
      <Requirements language={language}/>
    </Shell>;
  }

  if (!status.connected) {
    return <Shell language={language}>
      <section className="spotify-card spotify-connect">
        <h3>{st(language, "connect.title")}</h3>
        <p>{st(language, "connect.body")}</p>
        {connectError && <ErrorBox language={language} error={connectError}/>}
        {connecting || status.loginInProgress
          ? <div className="spotify-row"><p className="spotify-muted" role="status">{st(language, "connect.waiting")}</p><button type="button" className="spotify-button spotify-secondary" onClick={() => void spotifyBackend.cancelConnect()}>{st(language, "connect.cancel")}</button></div>
          : <button type="button" className="spotify-button spotify-primary" onClick={() => void connect()}>{st(language, "connect.button")}</button>}
      </section>
      <Requirements language={language}/>
    </Shell>;
  }

  return <Shell language={language}>
    <nav className="spotify-tabs" role="tablist">
      {(["player", "playlists", "account"] as Tab[]).map((id) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}>{st(language, `tab.${id}`)}</button>)}
    </nav>
    {tab === "player" && <PlayerView language={language} onChoosePlaylist={() => setTab("playlists")} onSignedOut={() => void refreshStatus()}/>}
    {tab === "playlists" && <PlaylistsView language={language} onStarted={() => setTab("player")} onSignedOut={() => void refreshStatus()}/>}
    {tab === "account" && <AccountView language={language} onDisconnected={() => void refreshStatus()}/>}
  </Shell>;
}

function Shell({ language, children }: { language: Language; children: ReactNode }) {
  return <section className="spotify-app">
    <header className="spotify-heading"><span className="spotify-kicker">{st(language, "kicker")}</span><h2>Spotify<span>.</span></h2></header>
    {children}
  </section>;
}

function Requirements({ language }: { language: Language }) {
  return <section className="spotify-card spotify-requirements">
    <span className="spotify-label">{st(language, "requirements.title")}</span>
    <ul><li>{st(language, "requirements.premium")}</li><li>{st(language, "requirements.devmode")}</li></ul>
  </section>;
}

function ErrorBox({ language, error, onRetry }: { language: Language; error: BackendError; onRetry?: () => void }) {
  return <div className="spotify-message spotify-error" role="alert">
    <span>{backendErrorMessage(language, error)}</span>
    {onRetry && <button type="button" className="spotify-button spotify-secondary" onClick={onRetry}>{st(language, "error.retry")}</button>}
  </div>;
}

const SIGNED_OUT = new Set(["revoked", "not_connected"]);

function usePlayer() {
  return useSyncExternalStore(spotifyPlayer.subscribe, spotifyPlayer.getSnapshot);
}

function PlayerView({ language, onChoosePlaylist, onSignedOut }: { language: Language; onChoosePlaylist: () => void; onSignedOut: () => void }) {
  const player = usePlayer();
  const [actionError, setActionError] = useState<BackendError | null>(null);
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const playback = player.playback;
  const track = playback?.track ?? null;
  const ready = player.status === "ready";

  // Idempotent: the controller never creates a second SDK player.
  useEffect(() => { void spotifyPlayer.start(); }, []);

  useEffect(() => {
    if (player.error?.kind === "token" && player.error.code && SIGNED_OUT.has(player.error.code)) onSignedOut();
  }, [player.error, onSignedOut]);

  // Local clock for the progress bar only while music plays; no network polling.
  useEffect(() => {
    if (!playback || playback.paused) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [playback]);

  useEffect(() => {
    if (!player.notice) return;
    const timer = window.setTimeout(() => spotifyPlayer.clearNotice(), 6000);
    return () => window.clearTimeout(timer);
  }, [player.notice]);

  const runBackend = async (action: () => Promise<void>) => {
    setActionError(null);
    try {
      await action();
    } catch (error) {
      const backendError = toBackendError(error);
      setActionError(backendError);
      if (SIGNED_OUT.has(backendError.code)) onSignedOut();
    }
  };

  const playHere = async () => {
    if (!player.deviceId) return;
    await spotifyPlayer.activate();
    await runBackend(() => spotifyBackend.transferPlayback(player.deviceId!, true));
  };

  const position = playback ? (seekDraft ?? currentPosition(playback, now)) : 0;
  const duration = playback?.durationMs ?? 0;
  const repeatLabel = st(language, `player.repeat.${playback?.repeat ?? "off"}`);

  return <div className="spotify-player">
    <div className="spotify-status-row" role="status">
      <span className={`spotify-dot spotify-dot-${player.status}`} aria-hidden="true"/>
      <span>{st(language, `status.${player.status}`)}</span>
      <span className="spotify-muted">· {st(language, "player.device")}: {st(language, "player.deviceName")}</span>
    </div>

    {player.error && <div className="spotify-message spotify-error" role="alert">
      <span>{st(language, `player.error.${player.error.kind}`)}{player.error.code ? ` ${backendErrorMessage(language, { code: player.error.code })}` : ""}</span>
      <button type="button" className="spotify-button spotify-secondary" onClick={() => void spotifyPlayer.reconnect()}>{st(language, "player.reconnect")}</button>
    </div>}
    {player.status === "offline" && <div className="spotify-message" role="status"><span>{st(language, "status.offline")}</span><button type="button" className="spotify-button spotify-secondary" onClick={() => void spotifyPlayer.reconnect()}>{st(language, "player.reconnect")}</button></div>}
    {actionError && <ErrorBox language={language} error={actionError}/>}
    {player.notice && <p className="spotify-message" role="status">{st(language, `notice.${player.notice}`) === `notice.${player.notice}` ? st(language, "notice.playback_error") : st(language, `notice.${player.notice}`)}</p>}

    {!track ? <section className="spotify-card spotify-empty">
      <p><strong>{st(language, "player.nothing")}</strong></p>
      <p className="spotify-muted">{st(language, "player.nothingHint")}</p>
      <div className="spotify-row">
        <button type="button" className="spotify-button spotify-primary" disabled={!ready} onClick={() => void playHere()}>{st(language, "player.playHere")}</button>
        <button type="button" className="spotify-button spotify-secondary" onClick={onChoosePlaylist}>{st(language, "player.choosePlaylist")}</button>
      </div>
    </section> : <section className="spotify-now">
      <Artwork url={track.imageUrl} label={st(language, "player.noArtwork")}/>
      <div className="spotify-meta">
        <strong className="spotify-title" title={track.name}>{track.name}</strong>
        <span className="spotify-artist" title={track.artists}>{track.artists || st(language, "player.unknownArtist")}</span>
        {track.album && <span className="spotify-album" title={track.album}>{track.album}</span>}
      </div>
      <div className="spotify-progress">
        <span>{formatTime(position)}</span>
        <input type="range" min={0} max={Math.max(duration, 1)} step={1000} value={Math.min(position, Math.max(duration, 1))} disabled={!ready || duration === 0} aria-label={st(language, "player.seek")} aria-valuetext={`${formatTime(position)} / ${formatTime(duration)}`}
          onChange={(event) => setSeekDraft(Number(event.currentTarget.value))}
          onPointerUp={() => { if (seekDraft !== null) { void spotifyPlayer.seek(seekDraft); setSeekDraft(null); } }}
          onKeyUp={() => { if (seekDraft !== null) { void spotifyPlayer.seek(seekDraft); setSeekDraft(null); } }}/>
        <span>{formatTime(duration)}</span>
      </div>
      <div className="spotify-controls">
        <button type="button" className={playback?.shuffle ? "is-on" : ""} disabled={!ready || !player.deviceId} aria-pressed={!!playback?.shuffle} aria-label={st(language, playback?.shuffle ? "player.shuffleOn" : "player.shuffleOff")} title={st(language, playback?.shuffle ? "player.shuffleOn" : "player.shuffleOff")}
          onClick={() => void runBackend(() => spotifyBackend.setShuffle(player.deviceId!, !playback?.shuffle))}><Glyph name="shuffle"/></button>
        <button type="button" disabled={!ready} aria-label={st(language, "player.previous")} title={st(language, "player.previous")} onClick={() => void spotifyPlayer.previousTrack()}><Glyph name="previous"/></button>
        <button type="button" className="spotify-play" disabled={!ready} aria-label={st(language, playback?.paused ? "player.play" : "player.pause")} title={st(language, playback?.paused ? "player.play" : "player.pause")}
          onClick={() => { void spotifyPlayer.activate(); void spotifyPlayer.togglePlay(); }}><Glyph name={playback?.paused ? "play" : "pause"}/></button>
        <button type="button" disabled={!ready} aria-label={st(language, "player.next")} title={st(language, "player.next")} onClick={() => void spotifyPlayer.nextTrack()}><Glyph name="next"/></button>
        <button type="button" className={playback?.repeat !== "off" ? "is-on" : ""} disabled={!ready || !player.deviceId} aria-label={repeatLabel} title={repeatLabel}
          onClick={() => void runBackend(() => spotifyBackend.setRepeat(player.deviceId!, nextRepeatMode(playback?.repeat ?? "off")))}><Glyph name={playback?.repeat === "track" ? "repeatOne" : "repeat"}/></button>
      </div>
    </section>}

    <label className="spotify-volume"><span>{st(language, "player.volume")}</span>
      <input type="range" min={0} max={100} value={Math.round(player.volume * 100)} disabled={!ready} onChange={(event) => void spotifyPlayer.setVolume(Number(event.currentTarget.value) / 100)}/>
      <span>{Math.round(player.volume * 100)} %</span>
    </label>
  </div>;
}

function Artwork({ url, label }: { url: string | null; label: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!url || failed) return <div className="spotify-art spotify-art-empty" aria-label={label} role="img"><Glyph name="note"/></div>;
  return <img className="spotify-art" src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)}/>;
}

function PlaylistsView({ language, onStarted, onSignedOut }: { language: Language; onStarted: () => void; onSignedOut: () => void }) {
  const player = usePlayer();
  const [playlists, setPlaylists] = useState<PlaylistSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<BackendError | null>(null);
  const [startingUri, setStartingUri] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPlaylists(await spotifyBackend.playlists());
    } catch (reason) {
      const backendError = toBackendError(reason);
      setError(backendError);
      if (SIGNED_OUT.has(backendError.code)) onSignedOut();
    } finally {
      setLoading(false);
    }
  }, [onSignedOut]);

  useEffect(() => { void load(); }, [load]);

  const start = async (uri: string) => {
    if (!player.deviceId || player.status !== "ready") return;
    setStartingUri(uri);
    setError(null);
    try {
      await spotifyPlayer.activate();
      await spotifyBackend.playContext(player.deviceId, uri);
      onStarted();
    } catch (reason) {
      setError(toBackendError(reason));
    } finally {
      setStartingUri(null);
    }
  };

  return <section className="spotify-playlists">
    <div className="spotify-row spotify-between"><h3>{st(language, "playlists.title")}</h3><button type="button" className="spotify-button spotify-secondary" disabled={loading} onClick={() => void load()}>{st(language, "playlists.refresh")}</button></div>
    {player.status !== "ready" && <p className="spotify-muted">{st(language, "playlists.notReady")}</p>}
    {error && <ErrorBox language={language} error={error}/>}
    {loading && !playlists && <p className="spotify-muted" role="status">{st(language, "playlists.loading")}</p>}
    {playlists && playlists.length === 0 && <p className="spotify-muted">{st(language, "playlists.empty")}</p>}
    <ul>
      {playlists?.map((playlist) => <li key={playlist.uri}>
        <button type="button" disabled={player.status !== "ready" || startingUri !== null} onClick={() => void start(playlist.uri)}>
          <Artwork url={playlist.imageUrl} label={st(language, "player.noArtwork")}/>
          <span className="spotify-playlist-text"><strong title={playlist.name}>{playlist.name}</strong><span>{[playlist.owner, playlist.trackCount !== null ? st(language, "playlists.tracks", { count: playlist.trackCount }) : null].filter(Boolean).join(" · ")}</span></span>
        </button>
      </li>)}
    </ul>
  </section>;
}

function AccountView({ language, onDisconnected }: { language: Language; onDisconnected: () => void }) {
  const [profile, setProfile] = useState<SpotifyProfile | null>(null);
  const [error, setError] = useState<BackendError | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    let alive = true;
    spotifyBackend.profile().then((value) => { if (alive) setProfile(value); }, (reason) => { if (alive) setError(toBackendError(reason)); });
    return () => { alive = false; };
  }, []);

  const disconnect = async () => {
    setDisconnecting(true);
    setError(null);
    spotifyPlayer.shutdown();
    try {
      await spotifyBackend.disconnect();
      onDisconnected();
    } catch (reason) {
      setError(toBackendError(reason));
      setDisconnecting(false);
    }
  };

  return <section className="spotify-card spotify-account">
    <span className="spotify-label">{st(language, "account.connectedAs")}</span>
    <div className="spotify-row">
      {profile?.imageUrl && <img className="spotify-avatar" src={profile.imageUrl} alt="" referrerPolicy="no-referrer"/>}
      <strong>{profile?.displayName ?? st(language, "account.unknownName")}</strong>
    </div>
    <p className="spotify-muted">{st(language, "account.credentials")}</p>
    {error && <ErrorBox language={language} error={error}/>}
    <button type="button" className="spotify-button spotify-danger" disabled={disconnecting} onClick={() => void disconnect()}>{st(language, disconnecting ? "account.disconnecting" : "account.disconnect")}</button>
    <p className="spotify-muted">{st(language, "account.disconnectHint")}</p>
    <Requirements language={language}/>
    <p className="spotify-muted spotify-small">{st(language, "account.policy")}</p>
  </section>;
}

type GlyphName = "play" | "pause" | "next" | "previous" | "shuffle" | "repeat" | "repeatOne" | "note";

function Glyph({ name }: { name: GlyphName }) {
  const paths: Record<GlyphName, ReactNode> = {
    play: <path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>,
    pause: <><rect x="7" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none"/></>,
    next: <><path d="M6 6l9 6-9 6z" fill="currentColor" stroke="none"/><path d="M18 6v12"/></>,
    previous: <><path d="M18 6l-9 6 9 6z" fill="currentColor" stroke="none"/><path d="M6 6v12"/></>,
    shuffle: <><path d="M3 7h3c4 0 6 10 10 10h3"/><path d="M3 17h3c1.6 0 2.8-1.5 3.9-3.3M13.5 9.5C14.4 8 15.4 7 16 7h3"/><path d="m17 4 3 3-3 3M17 14l3 3-3 3"/></>,
    repeat: <><path d="M4 11V9a3 3 0 0 1 3-3h12"/><path d="m16 3 3 3-3 3"/><path d="M20 13v2a3 3 0 0 1-3 3H5"/><path d="m8 21-3-3 3-3"/></>,
    repeatOne: <><path d="M4 11V9a3 3 0 0 1 3-3h12"/><path d="m16 3 3 3-3 3"/><path d="M20 13v2a3 3 0 0 1-3 3H5"/><path d="m8 21-3-3 3-3"/><path d="M12 10v5"/></>,
    note: <><path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></>,
  };
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
