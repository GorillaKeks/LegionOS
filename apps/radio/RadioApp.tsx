import { useEffect, useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Language } from "../../src/i18n";
import { t } from "../../src/i18n";
import { useRadioPlayback, type RadioStation } from "./RadioPlayback";
import "./radio.css";

export default function RadioApp({ language }: { language: Language }) {
  const [stations, setStations] = useState<RadioStation[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const { current, playing, volume, error, playStation, togglePlayback, setVolume } = useRadioPlayback();
  const requestRef = useRef(0);

  const loadStations = async (search = "") => {
    const request = ++requestRef.current;
    setLoading(true);
    setMessage("");
    try {
      const result = await invoke<RadioStation[]>("radio_search_stations", { query: search.trim() || null });
      if (request === requestRef.current) {
        setStations(result.filter((station) => station.stationuuid && station.name));
        if (result.length === 0) setMessage(t(language, "radio.noStations"));
      }
    } catch {
      if (request === requestRef.current) setMessage(t(language, "radio.loadFailed"));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void loadStations();
    return () => { requestRef.current += 1; };
  }, []);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    void loadStations(query);
  };

  return <section className="radio-app">
    <div className="radio-heading"><span className="section-kicker">{t(language, "radio.kicker")}</span><h2>{t(language, "radio.title")}</h2><p>{t(language, "radio.subtitle")}</p></div>
    <form className="radio-search" onSubmit={submitSearch}>
      <input value={query} onChange={(event) => setQuery(event.currentTarget.value)} maxLength={100} placeholder={t(language, "radio.searchPlaceholder")} aria-label={t(language, "radio.searchLabel")}/>
      <button type="submit" disabled={loading}>{t(language, "radio.search")}</button>
    </form>
    {(message || error) && <p className="radio-message" role="status">{t(language, error ?? message)}</p>}
    <div className="radio-station-list" aria-busy={loading}>
      {loading ? <p className="radio-empty">{t(language, "radio.loading")}</p> : stations.map((station) => <button key={station.stationuuid} type="button" className={`radio-station${current?.stationuuid === station.stationuuid ? " radio-station-current" : ""}`} onClick={() => void playStation(station)}>
        <span className="radio-station-icon" aria-hidden="true">♫</span>
        <span className="radio-station-copy"><strong>{station.name}</strong><small>{[station.country, station.codec && station.codec.toUpperCase(), station.bitrate ? `${station.bitrate} kbps` : ""].filter(Boolean).join(" · ") || t(language, "radio.station")}</small></span>
        <span className="radio-play-mark" aria-hidden="true">{current?.stationuuid === station.stationuuid && playing ? "Ⅱ" : "▶"}</span>
      </button>)}
    </div>
    <section className="radio-player" aria-label={t(language, "radio.player")}>
      <div className="radio-now-icon" aria-hidden="true">♫</div>
      <div className="radio-now-copy"><span>{t(language, "radio.nowPlaying")}</span><strong title={current?.name}>{current?.name ?? t(language, "radio.nothingPlaying")}</strong></div>
      <button className="radio-toggle" type="button" onClick={() => void togglePlayback()} disabled={!current} aria-label={t(language, playing ? "radio.pause" : "radio.play")}>{playing ? "Ⅱ" : "▶"}</button>
      <label className="radio-volume" title={t(language, "radio.volume")}><span>♪</span><input type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => setVolume(Number(event.currentTarget.value))} aria-label={t(language, "radio.volume")}/></label>
    </section>
    <p className="radio-attribution">{t(language, "radio.attribution")}</p>
  </section>;
}
