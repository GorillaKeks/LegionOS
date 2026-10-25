import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";

export type RadioStation = {
  stationuuid: string;
  name: string;
  country: string;
  language: string;
  codec: string;
  bitrate: number;
};

type PlaybackContextValue = {
  current: RadioStation | null;
  playing: boolean;
  volume: number;
  error: "radio.playFailed" | "radio.streamError" | null;
  playStation: (station: RadioStation) => Promise<void>;
  togglePlayback: () => Promise<void>;
  setVolume: (value: number) => void;
  stopPlayback: () => void;
};

const PlaybackContext = createContext<PlaybackContextValue | null>(null);

export function RadioPlaybackProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const requestRef = useRef(0);
  const [current, setCurrent] = useState<RadioStation | null>(null);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolumeState] = useState(0.75);
  const [error, setError] = useState<PlaybackContextValue["error"]>(null);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => () => {
    requestRef.current += 1;
    audioRef.current?.pause();
  }, []);

  const playStation = useCallback(async (station: RadioStation) => {
    const request = ++requestRef.current;
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setCurrent(station);
    setPlaying(false);
    setError(null);
    try {
      const streamUrl = await invoke<string>("radio_resolve_stream", { stationUuid: station.stationuuid });
      if (request !== requestRef.current) return;
      audio.src = streamUrl;
      await audio.play();
      if (request === requestRef.current) setPlaying(true);
    } catch {
      if (request === requestRef.current) {
        setPlaying(false);
        setError("radio.playFailed");
      }
    }
  }, []);

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    setError(null);
    if (audio.paused) {
      if (!audio.currentSrc) {
        await playStation(current);
        return;
      }
      try {
        await audio.play();
        setPlaying(true);
      } catch {
        setError("radio.playFailed");
      }
    } else {
      audio.pause();
      setPlaying(false);
    }
  }, [current, playStation]);

  const setVolume = useCallback((value: number) => {
    setVolumeState(Math.max(0, Math.min(1, value)));
  }, []);

  const stopPlayback = useCallback(() => {
    requestRef.current += 1;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setCurrent(null);
    setPlaying(false);
    setError(null);
  }, []);

  const value = useMemo(() => ({ current, playing, volume, error, playStation, togglePlayback, setVolume, stopPlayback }), [current, playing, volume, error, playStation, togglePlayback, setVolume, stopPlayback]);
  return <PlaybackContext.Provider value={value}>
    <audio ref={audioRef} aria-hidden="true" tabIndex={-1} style={{ display: "none" }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => { setPlaying(false); setError("radio.streamError"); }}/>
    {children}
  </PlaybackContext.Provider>;
}

export function useRadioPlayback() {
  const value = useContext(PlaybackContext);
  if (!value) throw new Error("useRadioPlayback must be used inside RadioPlaybackProvider");
  return value;
}
