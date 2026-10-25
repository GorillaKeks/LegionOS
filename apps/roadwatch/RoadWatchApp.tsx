import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { localeForLanguage, t, type Language } from "../../src/i18n";
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
  language: Language;
  onOpenSettings: () => void;
};

type StatusFilter = "all" | "online" | "offline";

export default function RoadWatchApp({ active, truckersmpId, vtcId, language, onOpenSettings }: Props) {
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
      setError(t(language, "roadwatch.desktopOnly"));
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
  }, [language, truckersmpId, vtcId]);

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
      return left.username.localeCompare(right.username, localeForLanguage(language), { sensitivity: "base" });
    });
  }, [data, language, search, status]);

  const lastUpdatedLabel = lastUpdated
    ? t(language, "roadwatch.updated", { time: new Intl.DateTimeFormat(localeForLanguage(language), { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(lastUpdated) })
    : t(language, "roadwatch.notUpdated");

  if (!vtcId || !truckersmpId) {
    return <section className="roadwatch-app roadwatch-empty-setup">
      <span className="roadwatch-kicker">TRUCKERSMP · VTC LIVE</span>
      <div className="roadwatch-empty-icon" aria-hidden="true">RW</div>
      <h2>{t(language, "roadwatch.setupTitle")}</h2>
      <p>{t(language, "roadwatch.setupDescription")}</p>
      <button type="button" className="roadwatch-primary-button" onClick={onOpenSettings}>{t(language, "roadwatch.openSettings")}</button>
    </section>;
  }

  return <section className="roadwatch-app">
    <header className="roadwatch-heading">
      <div><span className="roadwatch-kicker">TRUCKERSMP · VTC LIVE</span><h2>RoadWatch<span>.</span></h2><p>{t(language, "roadwatch.sort")}</p></div>
      <button type="button" className="roadwatch-refresh" onClick={() => void refresh()} disabled={loading} aria-label={t(language, "roadwatch.refresh")} title={t(language, "roadwatch.refreshNow")}><span className={loading ? "roadwatch-refresh-glyph spinning" : "roadwatch-refresh-glyph"}>↻</span><span>{loading ? t(language, "roadwatch.loading") : t(language, "roadwatch.update")}</span></button>
    </header>

    {error && <div className="roadwatch-message roadwatch-error" role="alert">{error}</div>}
    {data?.liveError && <div className="roadwatch-message" role="status">{t(language, "roadwatch.liveError")} {data.liveError}</div>}

    <div className="roadwatch-stats">
      <article><span>{t(language, "roadwatch.members")}</span><strong>{data?.members.length ?? "—"}</strong></article>
      <article><span>{t(language, "roadwatch.online")}</span><strong className="roadwatch-stat-online">{data?.liveDataAvailable ? data.onlineCount : "—"}</strong></article>
      <article><span>{t(language, "roadwatch.liveStatus")}</span><strong className={data?.liveDataAvailable ? "roadwatch-stat-online" : "roadwatch-stat-muted"}>{data?.liveDataAvailable ? "LIVE" : loading ? "…" : "—"}</strong></article>
    </div>

    <div className="roadwatch-list-toolbar"><label><span className="roadwatch-sr-only">{t(language, "roadwatch.searchLabel")}</span><input value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder={t(language, "roadwatch.searchPlaceholder")}/></label><select value={status} onChange={(event) => setStatus(event.currentTarget.value as StatusFilter)} aria-label={t(language, "roadwatch.filterStatus")}><option value="all">{t(language, "roadwatch.all")}</option><option value="online">{t(language, "roadwatch.online")}</option><option value="offline">{t(language, "roadwatch.offline")}</option></select></div>

    <div className="roadwatch-list" aria-live="polite">
      {loading && !data && <p className="roadwatch-list-empty">{t(language, "roadwatch.loadingMembers")}</p>}
      {!loading && !error && data && visibleMembers.length === 0 && <p className="roadwatch-list-empty">{t(language, "roadwatch.noneFound")}</p>}
      {visibleMembers.map((member) => <article className={`roadwatch-member${member.isCurrentUser ? " roadwatch-member-own" : ""}`} key={`${member.id}-${member.truckersmpId}`}>
        <span className={`roadwatch-status-dot${member.online ? " is-online" : ""}`} title={member.online ? t(language, "roadwatch.online") : data?.liveDataAvailable ? t(language, "roadwatch.offline") : t(language, "roadwatch.statusUnknown")}/>
        <span className="roadwatch-avatar" aria-hidden="true">
          {member.username.trim().charAt(0).toLocaleUpperCase() || "?"}
          {safeAvatarUrl(member.avatarUrl) && <img src={safeAvatarUrl(member.avatarUrl)!} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = "none"; }}/ >}
        </span>
        <div className="roadwatch-member-main"><strong>{member.username}{member.isCurrentUser && <small>{t(language, "roadwatch.you")}</small>}</strong><span>{member.role}</span>{member.online && <div className="roadwatch-member-meta"><span>{member.game === "ets2" ? "ETS2" : member.game === "ats" ? "ATS" : "TruckersMP"}</span>{member.server && <span>{member.server}</span>}</div>}</div>
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
