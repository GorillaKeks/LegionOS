import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import "./RoadWatchApp.css";

type RoadWatchMember = {
  id: number;
  truckersmpId: number;
  username: string;
  role: string;
  avatarUrl: string | null;
  online: boolean;
  game: "ets2" | "ats" | null;
  server: string | null;
  distanceKm: number | null;
  isCurrentUser: boolean;
};

type RoadWatchData = {
  members: RoadWatchMember[];
  onlineCount: number;
  liveDataAvailable: boolean;
  liveError: string | null;
};

type Props = {
  active: boolean;
  truckersmpId: string;
  vtcId: string;
  onOpenSettings: () => void;
};

type StatusFilter = "all" | "online" | "offline";

export default function RoadWatchApp({ active, truckersmpId, vtcId, onOpenSettings }: Props) {
  const [data, setData] = useState<RoadWatchData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const generation = useRef(0);
  const requestRunning = useRef(false);

  const refresh = useCallback(async () => {
    if (!isTauri()) {
      setError("RoadWatch-Daten sind nur in der LegionOS-Desktop-App verfügbar.");
      return;
    }
    if (!vtcId || !truckersmpId) return;
    if (requestRunning.current) return;
    requestRunning.current = true;
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<RoadWatchData>("load_roadwatch_data");
      if (generation.current !== request) return;
      setData(result);
      setLastUpdated(new Date());
    } catch (reason) {
      if (generation.current === request) setError(String(reason));
    } finally {
      requestRunning.current = false;
      if (generation.current === request) setLoading(false);
    }
  }, [truckersmpId, vtcId]);

  useEffect(() => {
    if (!active || !vtcId || !truckersmpId) return;
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60_000);
    return () => {
      window.clearInterval(interval);
      generation.current += 1;
    };
  }, [active, refresh, truckersmpId, vtcId]);

  const visibleMembers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (data?.members ?? []).filter((member) => {
      const matchesStatus = status === "all" || (status === "online" ? member.online : !member.online);
      const matchesSearch = !query || member.username.toLocaleLowerCase().includes(query) || member.role.toLocaleLowerCase().includes(query) || String(member.truckersmpId).includes(query);
      return matchesStatus && matchesSearch;
    }).sort((left, right) => {
      if (left.distanceKm !== null && right.distanceKm !== null && left.distanceKm !== right.distanceKm) {
        return left.distanceKm - right.distanceKm;
      }
      if (left.distanceKm !== null && right.distanceKm === null) return -1;
      if (left.distanceKm === null && right.distanceKm !== null) return 1;
      if (left.online !== right.online) return left.online ? -1 : 1;
      return left.username.localeCompare(right.username, "de", { sensitivity: "base" });
    });
  }, [data, search, status]);

  const lastUpdatedLabel = lastUpdated
    ? `Aktualisiert ${new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(lastUpdated)}`
    : "Noch nicht aktualisiert";

  if (!vtcId || !truckersmpId) {
    return <section className="roadwatch-app roadwatch-empty-setup">
      <span className="roadwatch-kicker">TRUCKERSMP · VTC LIVE</span>
      <div className="roadwatch-empty-icon" aria-hidden="true">RW</div>
      <h2>RoadWatch einrichten</h2>
      <p>Hinterlege deine persönliche TruckersMP-ID und die VTC-ID in den LegionOS-Einstellungen. Danach lädt RoadWatch Mitglieder und Live-Status.</p>
      <button type="button" className="roadwatch-primary-button" onClick={onOpenSettings}>Einstellungen öffnen</button>
    </section>;
  }

  return <section className="roadwatch-app">
    <header className="roadwatch-heading">
      <div><span className="roadwatch-kicker">TRUCKERSMP · VTC LIVE</span><h2>RoadWatch<span>.</span></h2><p>Fahrer mit Live-Entfernung automatisch von nah nach fern</p></div>
      <button type="button" className="roadwatch-refresh" onClick={() => void refresh()} disabled={loading} aria-label="RoadWatch-Daten aktualisieren" title="Jetzt aktualisieren"><span className={loading ? "roadwatch-refresh-glyph spinning" : "roadwatch-refresh-glyph"}>↻</span><span>{loading ? "Lädt …" : "Aktualisieren"}</span></button>
    </header>

    {error && <div className="roadwatch-message roadwatch-error" role="alert">{error}</div>}
    {data?.liveError && <div className="roadwatch-message" role="status">Die VTC-Mitglieder sind geladen, aber Live-Positionen sind momentan nicht erreichbar. {data.liveError}</div>}

    <div className="roadwatch-stats">
      <article><span>VTC-MITGLIEDER</span><strong>{data?.members.length ?? "—"}</strong></article>
      <article><span>ONLINE</span><strong className="roadwatch-stat-online">{data?.liveDataAvailable ? data.onlineCount : "—"}</strong></article>
      <article><span>LIVE-STATUS</span><strong className={data?.liveDataAvailable ? "roadwatch-stat-online" : "roadwatch-stat-muted"}>{data?.liveDataAvailable ? "LIVE" : loading ? "…" : "—"}</strong></article>
    </div>

    <div className="roadwatch-list-toolbar"><label><span className="roadwatch-sr-only">Mitglieder suchen</span><input value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Mitglieder suchen …"/></label><select value={status} onChange={(event) => setStatus(event.currentTarget.value as StatusFilter)} aria-label="Nach Status filtern"><option value="all">Alle</option><option value="online">Online</option><option value="offline">Offline</option></select></div>

    <div className="roadwatch-list" aria-live="polite">
      {loading && !data && <p className="roadwatch-list-empty">TruckersMP- und Live-Daten werden geladen …</p>}
      {!loading && !error && data && visibleMembers.length === 0 && <p className="roadwatch-list-empty">Keine passenden Mitglieder gefunden.</p>}
      {visibleMembers.map((member) => <article className={`roadwatch-member${member.isCurrentUser ? " roadwatch-member-own" : ""}`} key={`${member.id}-${member.truckersmpId}`}>
        <span className={`roadwatch-status-dot${member.online ? " is-online" : ""}`} title={member.online ? "Online" : data?.liveDataAvailable ? "Offline" : "Status unbekannt"}/>
        <span className="roadwatch-avatar" aria-hidden="true">
          {member.username.trim().charAt(0).toLocaleUpperCase() || "?"}
          {safeAvatarUrl(member.avatarUrl) && <img src={safeAvatarUrl(member.avatarUrl)!} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = "none"; }}/ >}
        </span>
        <div className="roadwatch-member-main"><strong>{member.username}{member.isCurrentUser && <small>DU</small>}</strong><span>{member.role}</span>{member.online && <div className="roadwatch-member-meta"><span>{member.game === "ets2" ? "ETS2" : member.game === "ats" ? "ATS" : "TruckersMP"}</span>{member.server && <span>{member.server}</span>}</div>}</div>
        <div className="roadwatch-distance">{member.distanceKm === null ? "—" : member.distanceKm < 10 ? `${member.distanceKm.toFixed(1)} km` : `${Math.round(member.distanceKm)} km`}</div>
      </article>)}
    </div>
    <footer className="roadwatch-footer"><span>{lastUpdatedLabel}</span><span>TruckersMP · ETS2Map</span></footer>
  </section>;
}

function safeAvatarUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
