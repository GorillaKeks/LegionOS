import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import type { PointerEvent as ReactPointerEvent } from "react";
import "./App.css";
import { appInfo, type AppId, type InternalAppId } from "./apps";
import { getAppUsageState, selectInstalledApps, selectAvailableApps, selectInstalledCatalogApps, type LocalAppStoreSnapshot } from "./appStore";
import FocusApp from "./FocusApp";
import SnakeApp from "../apps/snake/SnakeApp";
import PongApp from "../apps/pong/PongApp";
import RoadWatchApp from "../apps/roadwatch/RoadWatchApp";
import { initialWindowState, selectOpenAppIcons, windowReducer } from "./windowManager";
import type { WindowPosition, WindowSize } from "./windowManager";
import { getGreeting } from "./greeting";
import legionMark from "./assets/legion-tray-sizes/32x32.png";

type ViewMode = "phone" | "tablet";
type UserSettings = { quietMode: boolean; accentOn: boolean; truckersmpId: string; vtcId: string };
type ConfigSnapshot = { version: number; mode: ViewMode; settings: UserSettings; notes: string; canSave: boolean; notice: string | null; overlayHotkey: string; overlayHotkeyError: string | null };
type PersistenceStatus = "loading" | "saved" | "saving" | "memory" | "error";
type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
type WindowDrag =
  | { kind: "move"; windowId: string; pointerId: number; offsetX: number; offsetY: number }
  | { kind: "resize"; windowId: string; pointerId: number; edge: ResizeEdge; startX: number; startY: number; startWidth: number; startHeight: number; pointerX: number; pointerY: number };
const defaultSettings: UserSettings = { quietMode: false, accentOn: true, truckersmpId: "", vtcId: "" };

type IconName = "settings" | "note" | "spark" | "snake" | "pong" | "roadwatch" | "chevron" | "close" | "minus" | "home" | "grid" | "sun" | "sunset" | "moon" | "check";

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  const paths: Record<IconName, ReactNode> = {
    settings: <><path d="M12 8.3a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Z"/><path d="m19.4 15 .1.1a1.7 1.7 0 1 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 1 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 1 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 1 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 1 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 1 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 1 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 1 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z" transform="translate(1 1) scale(.92)"/></>,
    note: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></>,
    spark: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="m19 16 .9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9L19 16Z"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>, close: <path d="m18 6-12 12M6 6l12 12"/>,
    minus: <path d="M5 12h14"/>, snake: <><path d="M5 7h7a3 3 0 0 1 3 3v4a3 3 0 0 0 3 3h1"/><path d="M5 7v4a3 3 0 0 0 3 3h4a3 3 0 0 1 3 3v0"/><circle cx="7" cy="7" r="1" fill="currentColor"/><circle cx="19" cy="17" r="1" fill="currentColor"/></>, pong: <><path d="M5 5v5M5 14v5M19 5v5M19 14v5"/><path d="M12 3v18" strokeDasharray="2 3"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/></>, roadwatch: <><path d="m8 3-4 18M16 3l4 18"/><path d="M12 4v3m0 4v3m0 4v3" strokeDasharray="2 1"/><path d="M12 5a3 3 0 0 1 3 3c0 2-3 5-3 5S9 10 9 8a3 3 0 0 1 3-3Z"/><circle cx="12" cy="8" r=".8" fill="currentColor" stroke="none"/></>, home: <><path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9M9 20v-7h6v7"/></>,
    grid: <><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></>,
    sunset: <><path d="M3 18h18M5 14a7 7 0 0 1 14 0M12 2v3m-7 1 2 2m12-2-2 2m-8 8h2m2 0h2"/></>,
    moon: <path d="M20.9 13A8.5 8.5 0 0 1 11 3.1 8.5 8.5 0 1 0 20.9 13Z"/>, check: <path d="m5 12 4 4L19 6"/>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function App() {
  const [mode, setMode] = useState<ViewMode>("phone");
  const [activeNav, setActiveNav] = useState<"home" | "store" | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [windowState, dispatch] = useReducer(windowReducer, initialWindowState);
  const [note, setNote] = useState("");
  const [settings, setSettings] = useState<UserSettings>(defaultSettings);
  const [hotkey, setHotkey] = useState("Tab");
  const [hotkeyInput, setHotkeyInput] = useState("Tab");
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [hotkeySaving, setHotkeySaving] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [updaterMessage, setUpdaterMessage] = useState("Noch nicht geprüft.");
  const [updaterBusy, setUpdaterBusy] = useState(false);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [downloadTotal, setDownloadTotal] = useState<number | null>(null);
  const [count, setCount] = useState(0);
  const [truckersmpIdDraft, setTruckersmpIdDraft] = useState("");
  const [vtcIdDraft, setVtcIdDraft] = useState("");
  const [savedRoadWatchIds, setSavedRoadWatchIds] = useState({ truckersmpId: "", vtcId: "" });
  const [loaded, setLoaded] = useState(false);
  const [canSave, setCanSave] = useState(true);
  const [persistence, setPersistence] = useState<PersistenceStatus>("loading");
  const [persistenceNotice, setPersistenceNotice] = useState<string | null>(null);
  const [modeChanging, setModeChanging] = useState(false);
  const [appStore, setAppStore] = useState<LocalAppStoreSnapshot | null>(null);
  const [appStoreLoading, setAppStoreLoading] = useState(true);
  const [appStoreError, setAppStoreError] = useState<string | null>(null);
  const [appStoreBusyId, setAppStoreBusyId] = useState<string | null>(null);
  const [spotifyFeedback, setSpotifyFeedback] = useState<string | null>(null);
  const [spotifyLaunching, setSpotifyLaunching] = useState(false);
  const settingsRef = useRef(settings);
  const canSaveRef = useRef(true);
  const lastSavedNote = useRef("");
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveRevision = useRef(0);
  const updaterAutoCheckStarted = useRef(false);
  const phoneStageRef = useRef<HTMLElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const appWindowElements = useRef(new Map<string, HTMLElement>());
  const dragRef = useRef<WindowDrag | null>(null);

  useEffect(() => {
    let interval: number | undefined;
    const firstMinuteTick = window.setTimeout(() => {
      setNow(new Date());
      interval = window.setInterval(() => setNow(new Date()), 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => {
      window.clearTimeout(firstMinuteTick);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (!isTauri()) {
      setAppStoreLoading(false);
      setAppStoreError("Der lokale App-Store ist nur in der LegionOS-Desktop-App verfügbar.");
      return;
    }
    let cancelled = false;
    setAppStoreLoading(true);
    invoke<LocalAppStoreSnapshot>("load_local_apps").then((snapshot) => {
      if (cancelled) return;
      setAppStore(snapshot);
      setAppStoreError(null);
    }).catch((error: unknown) => {
      if (cancelled) return;
      setAppStoreError(`Lokaler App-Katalog konnte nicht geladen werden: ${String(error)}`);
    }).finally(() => { if (!cancelled) setAppStoreLoading(false); });
    return () => { cancelled = true; };
  }, [loaded]);

  useEffect(() => {
    if (!isTauri()) {
      setPersistence("memory");
      setPersistenceNotice("Browser-Vorschau: Einstellungen und Notizen werden nur bis zum Neuladen gehalten.");
      setLoaded(true);
      return;
    }
    let cancelled = false;
    invoke<ConfigSnapshot>("load_phone_config").then((config) => {
      if (cancelled) return;
      setMode(config.mode);
      setSettings(config.settings);
      setTruckersmpIdDraft(config.settings.truckersmpId);
      setVtcIdDraft(config.settings.vtcId);
      setSavedRoadWatchIds({ truckersmpId: config.settings.truckersmpId, vtcId: config.settings.vtcId });
      setHotkey(config.overlayHotkey);
      setHotkeyInput(config.overlayHotkey);
      setHotkeyError(config.overlayHotkeyError);
      settingsRef.current = config.settings;
      setNote(config.notes);
      lastSavedNote.current = config.notes;
      setCanSave(config.canSave);
      canSaveRef.current = config.canSave;
      setPersistence(config.canSave ? "saved" : "error");
      setPersistenceNotice(config.notice);
      setLoaded(true);
    }).catch((error: unknown) => {
      if (cancelled) return;
      setPersistence("error");
      setPersistenceNotice(`Konfiguration konnte nicht geladen werden: ${String(error)}`);
      setCanSave(false);
      canSaveRef.current = false;
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!loaded || !isTauri() || updaterAutoCheckStarted.current) return;
    updaterAutoCheckStarted.current = true;
    let cancelled = false;
    setUpdaterBusy(true);
    setUpdaterMessage("Suche nach Updates …");
    void check({ timeout: 20_000 }).then((update) => {
      if (cancelled) {
        if (update) void update.close().catch(() => undefined);
        return;
      }
      if (!update) {
        setUpdaterMessage("LegionOS ist auf dem neuesten Stand.");
        return;
      }
      setAvailableUpdate(update);
      setUpdaterMessage(`Version ${update.version} ist verfügbar.`);
    }).catch((error: unknown) => {
      if (!cancelled) setUpdaterMessage(`Updateprüfung fehlgeschlagen: ${String(error)}`);
    }).finally(() => {
      if (!cancelled) setUpdaterBusy(false);
    });
    return () => { cancelled = true; };
  }, [loaded]);

  const enqueueSave = (operation: () => Promise<void>) => {
    const revision = ++saveRevision.current;
    setPersistence("saving");
    const next = saveQueue.current.catch(() => undefined).then(operation);
    saveQueue.current = next.then(() => undefined, () => undefined);
    return next.then(() => {
      if (revision === saveRevision.current) {
        setPersistence("saved");
        setPersistenceNotice(null);
      }
      return true;
    }).catch((error: unknown) => {
      if (revision === saveRevision.current) {
        setPersistence("error");
        setPersistenceNotice(`Speichern fehlgeschlagen: ${String(error)}`);
      }
      return false;
    });
  };

  useEffect(() => {
    if (!loaded || !isTauri() || !canSave || note === lastSavedNote.current) return;
    saveRevision.current += 1;
    setPersistence("saving");
    const timer = window.setTimeout(() => {
      const value = note;
      if (value === lastSavedNote.current) return;
      void enqueueSave(async () => {
        await invoke("save_notes", { notes: value });
        lastSavedNote.current = value;
      });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [note, loaded, canSave]);

  const time = useMemo(() => new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(now), [now]);
  const date = useMemo(() => new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" }).format(now), [now]);
  const greeting = useMemo(() => getGreeting(now), [now]);
  const activeWindow = windowState.windows.find((window) => window.id === windowState.activeId);
  const activeLayout = activeWindow ? windowState.layouts[activeWindow.appId] : undefined;
  const minimized = windowState.windows.filter((window) => window.minimized);
  const visibleWindows = windowState.windows.filter((window) => !window.minimized);
  const installedApps = useMemo(() => appStore ? selectInstalledApps(appStore) : isTauri() ? [] : selectInstalledApps(null), [appStore]);
  const openAppIcons = useMemo(() => selectOpenAppIcons(windowState), [windowState]);
  const installedExternalApps = installedApps.filter(({ id }) => id === "spotify");
  const availableStoreApps = useMemo(() => selectAvailableApps(appStore), [appStore]);
  const installedStoreApps = useMemo(() => selectInstalledCatalogApps(appStore), [appStore]);
  const runtimeAppInfo = useMemo(() => Object.fromEntries(installedApps.map(({ id, info }) => [id, info])) as Partial<Record<AppId, typeof appInfo[AppId]>>, [installedApps]);
  const getAppInfo = (appId: AppId) => runtimeAppInfo[appId] ?? appInfo[appId];
  const openApp = (appId: InternalAppId) => {
    setActiveNav(null);
    dispatch({ type: "open", appId });
  };
  const launchSpotify = async () => {
    if (spotifyLaunching) return;
    if (!isTauri()) {
      setSpotifyFeedback("Spotify Desktop kann nur aus der Windows-Desktop-App gestartet werden.");
      return;
    }
    setSpotifyLaunching(true);
    setSpotifyFeedback(null);
    try {
      const result = await invoke<"started" | "alreadyRequested">("launch_spotify");
      setSpotifyFeedback(result === "alreadyRequested"
        ? "Der Spotify-Start wurde gerade bereits angefordert. Ein registrierter Spotify-URI-Handler leitet den Aufruf an das laufende Spotify weiter, sofern es bereits geöffnet ist."
        : "Spotify wurde über den Windows-URI-Handler geöffnet oder in den Vordergrund geholt.");
    } catch (error) {
      setSpotifyFeedback(String(error));
    } finally {
      setSpotifyLaunching(false);
    }
  };
  const openInstalledApp = (appId: AppId) => {
    if (appId === "spotify") void launchSpotify();
    else openApp(appId);
  };
  const focusApp = (id: string) => {
    setActiveNav(null);
    dispatch({ type: "activate", id });
  };
  const showDashboard = (target: "home" | "store") => {
    for (const session of windowState.windows) {
      if (!session.minimized) dispatch({ type: "minimize", id: session.id });
    }
    setActiveNav(target);
    if (target === "home") workspaceRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    else workspaceRef.current?.scrollTo({ top: 0, behavior: "instant" });
  };
  const openHome = () => showDashboard("home");
  const openStore = () => showDashboard("store");

  const changeInstallation = async (id: string, install: boolean) => {
    if (!isTauri() || appStoreBusyId) return;
    setAppStoreBusyId(id);
    setAppStoreError(null);
    try {
      const snapshot = await invoke<LocalAppStoreSnapshot>(install ? "install_local_app" : "uninstall_local_app", { id });
      setAppStore(snapshot);
      if (!install) {
        const session = windowState.windows.find((window) => window.appId === id);
        if (session) dispatch({ type: "close", id: session.id });
      }
    } catch (error) {
      setAppStoreError(`App konnte nicht ${install ? "installiert" : "deinstalliert"} werden: ${String(error)}`);
    } finally {
      setAppStoreBusyId(null);
    }
  };

  const moveInternalWindow = (id: string, x: number, y: number) => {
    const stage = phoneStageRef.current;
    const appWindow = appWindowElements.current.get(id);
    if (!stage || !appWindow) return;
    const windowRect = appWindow.getBoundingClientRect();
    dispatch({
      type: "move",
      id,
      mode,
      position: { x, y },
      bounds: {
        displayWidth: stage.clientWidth,
        displayHeight: stage.clientHeight,
        windowWidth: windowRect.width,
        windowHeight: windowRect.height,
      },
    });
  };

  const resizeInternalWindow = (id: string, position: WindowPosition, size: WindowSize) => {
    const stage = phoneStageRef.current;
    if (!stage) return;
    dispatch({
      type: "resize",
      id,
      mode,
      position,
      size,
      bounds: {
        displayWidth: stage.clientWidth,
        displayHeight: stage.clientHeight,
        maxWidth: Math.max(1, stage.clientWidth - 32),
        maxHeight: Math.max(1, stage.clientHeight - 32),
        minWidth: 320,
        minHeight: 240,
      },
    });
  };

  const handleWindowPointerDown = (id: string, event: ReactPointerEvent<HTMLDivElement>) => {
    if (mode !== "tablet" || event.button !== 0 || !(event.target instanceof Element)) return;
    if (event.target.closest("button, input, textarea, select, a, [role='button']")) return;
    event.preventDefault();
    const stage = phoneStageRef.current;
    const appWindow = appWindowElements.current.get(id);
    if (!stage || !appWindow) return;
    const stageRect = stage.getBoundingClientRect();
    const windowRect = appWindow.getBoundingClientRect();
    dragRef.current = {
      kind: "move",
      windowId: id,
      pointerId: event.pointerId,
      offsetX: event.clientX - windowRect.left,
      offsetY: event.clientY - windowRect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    moveInternalWindow(
      id,
      windowRect.left - stageRect.left - stage.clientLeft,
      windowRect.top - stageRect.top - stage.clientTop,
    );
  };

  const handleWindowPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const stage = phoneStageRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !stage) return;
    if (drag.kind === "resize") {
      const deltaX = event.clientX - drag.pointerX;
      const deltaY = event.clientY - drag.pointerY;
      const stageWidth = Math.max(1, stage.clientWidth - 32);
      const stageHeight = Math.max(1, stage.clientHeight - 32);
      const west = drag.edge.includes("w");
      const north = drag.edge.includes("n");
      const east = drag.edge.includes("e");
      const south = drag.edge.includes("s");
      const right = drag.startX + drag.startWidth;
      const bottom = drag.startY + drag.startHeight;
      const maxWidth = Math.max(1, Math.min(stageWidth, west ? right : stageWidth - drag.startX));
      const maxHeight = Math.max(1, Math.min(stageHeight, north ? bottom : stageHeight - drag.startY));
      const minWidth = Math.min(320, maxWidth);
      const minHeight = Math.min(240, maxHeight);
      const width = Math.min(maxWidth, Math.max(minWidth, drag.startWidth + (west ? -deltaX : east ? deltaX : 0)));
      const height = Math.min(maxHeight, Math.max(minHeight, drag.startHeight + (north ? -deltaY : south ? deltaY : 0)));
      const position = {
        x: west ? right - width : drag.startX,
        y: north ? bottom - height : drag.startY,
      };
      resizeInternalWindow(drag.windowId, position, { width, height });
      return;
    }
    const stageRect = stage.getBoundingClientRect();
    moveInternalWindow(
      drag.windowId,
      event.clientX - stageRect.left - stage.clientLeft - drag.offsetX,
      event.clientY - stageRect.top - stage.clientTop - drag.offsetY,
    );
  };

  const handleResizePointerDown = (id: string, edge: ResizeEdge, event: ReactPointerEvent<HTMLDivElement>) => {
    if (mode !== "tablet" || event.button !== 0 || !phoneStageRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const stage = phoneStageRef.current;
    const appWindow = appWindowElements.current.get(id);
    if (!appWindow) return;
    dispatch({ type: "activate", id });
    const stageRect = stage.getBoundingClientRect();
    const windowRect = appWindow.getBoundingClientRect();
    const startX = windowRect.left - stageRect.left - stage.clientLeft;
    const startY = windowRect.top - stageRect.top - stage.clientTop;
    dragRef.current = {
      kind: "resize",
      windowId: id,
      pointerId: event.pointerId,
      edge,
      startX,
      startY,
      startWidth: windowRect.width,
      startHeight: windowRect.height,
      pointerX: event.clientX,
      pointerY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeInternalWindow(id, { x: startX, y: startY }, { width: windowRect.width, height: windowRect.height });
  };

  const handleWindowPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  useEffect(() => {
    const position = activeLayout?.position;
    const appWindow = activeWindow ? appWindowElements.current.get(activeWindow.id) : null;
    if (mode !== "tablet" || !activeWindow || !position || !phoneStageRef.current || !appWindow) return;
    const keepInsideDisplay = () => moveInternalWindow(activeWindow.id, position.x, position.y);
    const observer = new ResizeObserver(keepInsideDisplay);
    observer.observe(phoneStageRef.current);
    observer.observe(appWindow);
    keepInsideDisplay();
    return () => observer.disconnect();
  }, [mode, activeWindow?.id, activeLayout?.position?.x, activeLayout?.position?.y]);

  const changeSetting = (patch: Partial<UserSettings>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    if (!loaded) return;
    if (!isTauri()) {
      setPersistence("memory");
      return;
    }
    if (!canSaveRef.current) {
      setPersistence("error");
      return;
    }
    void enqueueSave(async () => { await invoke("save_user_settings", { settings: next }); });
  };

  useEffect(() => {
    if ((persistence === "saved" || persistence === "memory") && settings.truckersmpId === truckersmpIdDraft && settings.vtcId === vtcIdDraft) {
      setSavedRoadWatchIds({ truckersmpId: settings.truckersmpId, vtcId: settings.vtcId });
    }
  }, [persistence, settings.truckersmpId, settings.vtcId, truckersmpIdDraft, vtcIdDraft]);

  const saveRoadWatchIds = () => {
    changeSetting({ truckersmpId: truckersmpIdDraft, vtcId: vtcIdDraft });
  };

  const changeMode = async (nextMode: ViewMode) => {
    if (nextMode === mode || modeChanging) return;
    if (!isTauri()) {
      setMode(nextMode);
      if (nextMode === "phone") {
        dragRef.current = null;
        dispatch({ type: "resetPositions" });
      }
      setPersistence("memory");
      return;
    }
    if (!canSaveRef.current) {
      setPersistence("error");
      return;
    }
    setModeChanging(true);
    try {
      const saved = await enqueueSave(async () => { await invoke("set_view_mode", { mode: nextMode }); });
      if (saved) {
        setMode(nextMode);
        if (nextMode === "phone") {
          dragRef.current = null;
          dispatch({ type: "resetPositions" });
        }
      }
    } finally {
      setModeChanging(false);
    }
  };

  const saveHotkey = async () => {
    if (!isTauri()) {
      setHotkeyError("Globale Hotkeys sind nur in der LegionOS-Desktop-App verfügbar.");
      return;
    }
    setHotkeySaving(true);
    setHotkeyError(null);
    try {
      const saved = await invoke<string>("set_overlay_hotkey", { hotkey: hotkeyInput });
      setHotkey(saved);
      setHotkeyInput(saved);
    } catch (error) {
      setHotkeyError(String(error));
    } finally {
      setHotkeySaving(false);
    }
  };

  const checkForUpdates = async () => {
    if (!isTauri()) {
      setUpdaterMessage("Die Updateprüfung ist nur in der installierten LegionOS-Desktop-App verfügbar.");
      return;
    }
    setUpdaterBusy(true);
    setUpdaterMessage("Suche nach Updates …");
    setDownloadedBytes(0);
    setDownloadTotal(null);
    if (availableUpdate) await availableUpdate.close().catch(() => undefined);
    setAvailableUpdate(null);
    try {
      const update = await check({ timeout: 20_000 });
      if (!update) {
        setUpdaterMessage("LegionOS ist auf dem neuesten Stand.");
        return;
      }
      setAvailableUpdate(update);
      setUpdaterMessage(`Version ${update.version} ist verfügbar.`);
    } catch (error) {
      setUpdaterMessage(`Updateprüfung fehlgeschlagen: ${String(error)}`);
    } finally {
      setUpdaterBusy(false);
    }
  };

  const installAvailableUpdate = async () => {
    if (!availableUpdate || updaterBusy) return;
    const notes = availableUpdate.body?.trim();
    const detail = notes ? `\n\nVersionshinweise:\n${notes}` : "\n\nFür diese Version sind keine Versionshinweise hinterlegt.";
    if (!window.confirm(`LegionOS ${availableUpdate.version} herunterladen und installieren?${detail}`)) return;
    setUpdaterBusy(true);
    setUpdaterMessage("Update wird heruntergeladen …");
    setDownloadedBytes(0);
    setDownloadTotal(null);
    try {
      await availableUpdate.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          setDownloadTotal(event.data.contentLength ?? null);
          setUpdaterMessage("Update wird heruntergeladen …");
        } else if (event.event === "Progress") {
          setDownloadedBytes((bytes) => bytes + event.data.chunkLength);
        } else if (event.event === "Finished") {
          setUpdaterMessage("Download abgeschlossen. Installation wird gestartet …");
        }
      });
    } catch (error) {
      setUpdaterMessage(`Installation fehlgeschlagen: ${String(error)}`);
      setUpdaterBusy(false);
    }
  };

  if (!loaded) {
    return <main className="boot-screen"><span className="boot-mark"/><span>LegionOS wird vorbereitet …</span></main>;
  }

  return (
    <main className={`phone-shell mode-${mode}${settings.accentOn ? " accent-on" : " accent-off"}`}>
      <div className="device-hardware" aria-hidden="true"><span className="hardware-camera"/><span className="hardware-speaker"/><span className="hardware-home"/></div>
      {mode === "tablet" && <nav className="side-panel" aria-label="Hauptnavigation">
        <div className="side-brand"><img src={legionMark} alt="LΣ" title="LΣGIΦN ΦS"/></div>
        <div className="side-nav">
          <button className={`side-nav-button${!activeWindow && activeNav === "home" ? " side-nav-active" : ""}`} type="button" aria-label="Startseite" title="Startseite" aria-current={!activeWindow && activeNav === "home" ? "page" : undefined} onClick={openHome}><Icon name="home" size={23}/></button>
          <button className={`side-nav-button${!activeWindow && activeNav === "store" ? " side-nav-active" : ""}`} type="button" aria-label="App-Store" title="App-Store" aria-current={!activeWindow && activeNav === "store" ? "page" : undefined} onClick={openStore}><Icon name="grid" size={22}/></button>
          {openAppIcons.length > 0 && <span className="side-nav-divider" aria-hidden="true"/>}
          {openAppIcons.map(({ window: session, active, minimized: isMinimized }) => {
            const info = getAppInfo(session.appId);
            const hint = isMinimized ? `${info.name} (minimiert)` : info.name;
            return <button key={session.id} className={`side-nav-button side-nav-app${active ? " side-nav-active" : ""}${isMinimized ? " side-nav-minimized" : ""}`} type="button" aria-label={isMinimized ? `${hint}; zum Wiederherstellen aktivieren` : `${info.name} fokussieren`} title={hint} aria-current={active ? "page" : undefined} onClick={() => focusApp(session.id)}><Icon name={info.icon} size={22}/></button>;
          })}
          {installedExternalApps.map(({ id, info }) => <button key={id} className="side-nav-button side-nav-app side-nav-external" type="button" aria-label={`${info.name} starten oder in den Vordergrund holen`} title={`${info.name} in eigenem Fenster öffnen`} disabled={spotifyLaunching} onClick={() => void openInstalledApp(id)}><Icon name={info.icon} size={22}/></button>)}
        </div>
        <span className="side-status" role="status" aria-label="LegionOS bereit" title="LegionOS bereit"/>
      </nav>}

      <section className="phone-stage" ref={phoneStageRef}>
        <header className="topbar" data-tauri-drag-region>
          <div className="topbar-context"><span className="eyebrow">DEIN DIGITALER RAUM</span><span className="topbar-greeting">{greeting.text} <span className="greeting-spark"><Icon name={greeting.icon} size={13}/></span></span></div>
          <div className="topbar-brand" aria-label="LΣGIΦN ΦS">LΣGIΦN ΦS</div>
          <div className="topbar-right"><span className="date-label">{date}</span><span className="topbar-divider"/><span className="clock">{time}</span><span className="online-indicator" title="Bereit" /></div>
        </header>

        <div className={`workspace${activeNav === "store" ? " workspace-store" : ""}`} ref={workspaceRef}>
        {spotifyFeedback && <div className="spotify-feedback" role="status">{spotifyFeedback}</div>}
        {activeNav === "store" ? <div className="store-view">
          <div className="store-heading"><div><p className="section-kicker">LOKALER KATALOG</p><h1>App-Store<span>.</span></h1><p className="welcome-copy">Apps aus dem lokalen Projektkatalog; externe Desktop-Apps starten über fest registrierte Adapter.</p></div><span className="store-local-badge"><span className="status-dot"/> NUR LOKAL</span></div>
          {appStoreError && <div className="store-message store-error" role="alert">{appStoreError}</div>}
          {appStoreLoading && <div className="store-message" role="status">Lokale Manifeste werden geprüft …</div>}
          {!appStoreLoading && !appStoreError && appStore && <>
            <section className="store-section"><div className="store-section-heading"><h2>Zum Installieren</h2><span>{availableStoreApps.length.toString().padStart(2, "0")}</span></div>
              {availableStoreApps.length === 0 ? <p className="store-empty">Alle gültigen lokalen Apps sind installiert.</p> : <div className="store-grid">{availableStoreApps.map((item) => {
                const manifest = item.manifest!;
                const info = appInfo[manifest.id as AppId];
                return <article className={`store-card app-${info.color}`} key={`${item.folder}-${manifest.id}`}><span className="app-icon-wrap"><Icon name={manifest.icon} size={23}/></span><div className="store-card-copy"><h3>{manifest.name}</h3><span>Version {manifest.version}</span><p>{manifest.description}</p></div><button type="button" className="store-action" title={!canSave ? "Die Konfiguration ist schreibgeschützt." : undefined} disabled={appStoreBusyId !== null || !canSave} onClick={() => void changeInstallation(manifest.id, true)}>{appStoreBusyId === manifest.id ? "Wird installiert …" : "Installieren"}</button></article>;
              })}</div>}
            </section>
            <section className="store-section"><div className="store-section-heading"><h2>Installiert</h2><span>{installedStoreApps.length.toString().padStart(2, "0")}</span></div>
              {installedStoreApps.length === 0 ? <p className="store-empty">Keine gültigen Apps installiert.</p> : <div className="store-grid">{installedStoreApps.map((item) => {
                const manifest = item.manifest!;
                const info = appInfo[manifest.id as AppId];
                const usageState = getAppUsageState(manifest.id, appStore, windowState);
                const usageLabel = { installed: "Installiert", open: "Geöffnet", minimized: "Minimiert", active: "Aktiv", available: "Verfügbar" }[usageState];
                return <article className={`store-card app-${info.color}`} key={`${item.folder}-${manifest.id}`}><span className="app-icon-wrap"><Icon name={manifest.icon} size={23}/></span><div className="store-card-copy"><h3>{manifest.name}</h3><span>Version {manifest.version}</span><p>{manifest.description}</p><span className={`store-state store-state-${usageState}`}>{usageLabel}</span></div><button type="button" className="store-action store-remove" title={!canSave ? "Die Konfiguration ist schreibgeschützt." : undefined} disabled={appStoreBusyId !== null || !canSave} onClick={() => void changeInstallation(manifest.id, false)}>{appStoreBusyId === manifest.id ? "Wird entfernt …" : "Deinstallieren"}</button></article>;
              })}</div>}
            </section>
            {appStore.apps.some((item) => item.error) && <section className="store-section store-invalid"><div className="store-section-heading"><h2>Übersprungene Einträge</h2></div><ul>{appStore.apps.filter((item) => item.error).map((item) => <li key={item.folder}><strong>{item.folder}</strong><span>{item.error}</span></li>)}</ul></section>}
          </>}
        </div> : <>
          <div className="welcome-row">
            <div><p className="section-kicker">HOMESCREEN</p><h1>Alles an seinem <span>Platz.</span></h1><p className="welcome-copy">Deine Apps, dein Raum — ganz nach deinem Rhythmus.</p></div>
            <div className="welcome-date"><span className="date-day">{now.toLocaleDateString("de-DE", { day: "2-digit" })}</span><span className="date-month">{now.toLocaleDateString("de-DE", { month: "short" }).replace(".", "").toUpperCase()}</span></div>
          </div>

          {persistenceNotice && <div className={`persistence-banner${persistence === "error" ? " persistence-error" : ""}`} role="status">{persistenceNotice}</div>}

          <div className="apps-heading"><div><h2>Deine Apps</h2><span className="apps-count">{installedApps.length.toString().padStart(2, "0")} APPS</span></div><span className="apps-hint">Wähle eine App zum Öffnen</span></div>
          <div className="app-grid">
            {installedApps.map(({ id, info }, index) => {
              const session = windowState.windows.find((window) => window.appId === id);
              return <button className={`app-card app-${info.color}${session && !session.minimized ? " app-running" : ""}`} key={id} onClick={() => openInstalledApp(id)}>
                <span className="app-card-index">0{index + 1}</span><span className="app-icon-wrap"><Icon name={info.icon} size={25}/><span className="app-icon-glow" /></span>
                <span className="app-card-title">{info.name}</span><span className="app-card-subtitle">{info.subtitle}</span>
                <span className="app-card-arrow"><Icon name="chevron" size={15}/></span>{session && <span className={`running-dot${session.minimized ? " running-muted" : ""}`} title={session.minimized ? "Minimiert" : "Geöffnet"}/>}
              </button>;
            })}
          </div>

          <div className="workspace-lower">
            <div className="tip-card"><div className="tip-icon"><Icon name="spark" size={17}/></div><div><span className="tip-label">KLEINER TIPP</span><p>Dein Geräteformat kannst du jederzeit in den <strong>Einstellungen</strong> ändern.</p></div></div>
            <div className="session-card"><span className="session-label">DEINE SITZUNG</span><span className="session-value">{windowState.windows.length.toString().padStart(2, "0")} <span>Fenster geöffnet</span></span><span className="session-foot">Änderungen gelten nur während dieser Sitzung</span></div>
          </div>
        </>}
        </div>

        <footer className="bottom-dock">
          <button className={`dock-home${!activeWindow && activeNav === "home" ? " dock-nav-active" : ""}`} type="button" aria-label="Startseite" title="Startseite" aria-current={!activeWindow && activeNav === "home" ? "page" : undefined} onClick={openHome}><span className="dock-home-icon"><Icon name="home" size={16}/></span><span>Homescreen</span></button>
          {mode === "phone" && <div className="dock-windows" aria-label="Geöffnete Fenster">
            {windowState.windows.filter((window) => !window.minimized).map((window) => <button key={window.id} className={`dock-window${window.id === activeWindow?.id ? " dock-active" : ""}`} onClick={() => dispatch({ type: "activate", id: window.id })} title={getAppInfo(window.appId).name}><Icon name={getAppInfo(window.appId).icon} size={15}/><span>{getAppInfo(window.appId).name}</span></button>)}
            {minimized.map((window) => <button key={window.id} className="dock-window dock-minimized" onClick={() => dispatch({ type: "activate", id: window.id })} title={getAppInfo(window.appId).name} aria-label={getAppInfo(window.appId).name}><Icon name={getAppInfo(window.appId).icon} size={15}/><span>{getAppInfo(window.appId).name}</span></button>)}
          </div>}
          {mode === "phone" && <button className={`dock-store${!activeWindow && activeNav === "store" ? " dock-nav-active" : ""}`} type="button" aria-label="App-Store" title="App-Store" aria-current={!activeWindow && activeNav === "store" ? "page" : undefined} onClick={openStore}><Icon name="grid" size={19}/></button>}
          {availableUpdate && <button className="dock-update-notice" type="button" onClick={() => openApp("settings")} title={`LegionOS ${availableUpdate.version} installieren`} aria-label={`LegionOS Update ist verfügbar. Version ${availableUpdate.version}. Einstellungen öffnen.`}>LegionOS Update ist verfügbar</button>}
          <span className="dock-session"><span className="status-dot"/> LEGIONOS <span className="dock-version">PREVIEW</span></span>
        </footer>

        {visibleWindows.map((shownWindow, windowIndex) => {
          const shownLayout = windowState.layouts[shownWindow.appId];
          const isActive = shownWindow.id === activeWindow?.id;
          const stackOffset = windowIndex * 28;
          return <section
            key={shownWindow.id}
            ref={(element) => { if (element) appWindowElements.current.set(shownWindow.id, element); else appWindowElements.current.delete(shownWindow.id); }}
            className={`app-window${isActive ? " app-window-active" : ""}`}
            style={{
              zIndex: isActive ? 5 : 4,
              ...(mode === "tablet" ? {
                left: shownLayout?.position ? `${shownLayout.position.x}px` : `calc(50% + ${stackOffset}px)`,
                top: shownLayout?.position ? `${shownLayout.position.y}px` : `calc(50% + ${stackOffset}px)`,
                transform: shownLayout?.position ? "none" : "translate(-50%,-46%)",
                ...(shownLayout?.size ? { width: `${shownLayout.size.width}px`, height: `${shownLayout.size.height}px` } : {}),
              } : {}),
            }}
            onPointerDown={() => dispatch({ type: "activate", id: shownWindow.id })}
            aria-label={`${getAppInfo(shownWindow.appId).name} Fenster`}
          >
          <div className={`window-titlebar${mode === "tablet" ? " window-titlebar-draggable" : ""}`} onPointerDown={(event) => handleWindowPointerDown(shownWindow.id, event)} onPointerMove={handleWindowPointerMove} onPointerUp={handleWindowPointerEnd} onPointerCancel={handleWindowPointerEnd}>
            <div className="window-app-mark"><Icon name={getAppInfo(shownWindow.appId).icon} size={16}/></div>
            <div className="window-title"><strong>{getAppInfo(shownWindow.appId).name}</strong><span>{getAppInfo(shownWindow.appId).subtitle}</span></div>
            <div className="window-actions"><button onClick={() => dispatch({ type: "minimize", id: shownWindow.id })} aria-label="Fenster minimieren"><Icon name="minus" size={16}/></button><button className="window-close" onClick={() => dispatch({ type: "close", id: shownWindow.id })} aria-label="Fenster schließen"><Icon name="close" size={16}/></button></div>
          </div>
          <div className="window-content">
            {shownWindow.appId === "settings" && <div className="settings-view"><div className="window-section-heading"><span className="section-kicker">PERSONALISIERUNG</span><h2>Dein LegionOS. <span>Deine Regeln.</span></h2><p>Persönliche Optionen, Geräteformat und Overlay-Hotkey werden dauerhaft gespeichert.</p></div>
              <div className="device-mode-settings"><span className="device-mode-label">GERÄTEFORMAT</span><div className="device-mode-options" role="group" aria-label="Geräteformat">
                <button className={`device-mode-option${mode === "phone" ? " selected" : ""}`} onClick={() => void changeMode("phone")} aria-pressed={mode === "phone"} disabled={modeChanging}><span className="device-icon device-phone"/><span><strong>Smartphone</strong><small>Hochformat</small></span></button>
                <button className={`device-mode-option${mode === "tablet" ? " selected" : ""}`} onClick={() => void changeMode("tablet")} aria-pressed={mode === "tablet"} disabled={modeChanging}><span className="device-icon device-tablet"/><span><strong>Tablet</strong><small>Querformat</small></span></button>
              </div>{modeChanging && <span className="device-mode-status" role="status">Geräteformat wird geändert …</span>}</div>
              <div className="settings-group"><div className="settings-row"><div className="settings-row-icon settings-cyan"><Icon name="moon" size={17}/></div><div className="settings-row-copy"><strong>Ruhemodus</strong><span>Gespeicherte Beispieloption</span></div><Toggle checked={settings.quietMode} onChange={(checked) => changeSetting({ quietMode: checked })} label="Ruhemodus"/></div>
                <div className="settings-row"><div className="settings-row-icon settings-violet"><Icon name="sun" size={17}/></div><div className="settings-row-copy"><strong>Cyan-Akzent</strong><span>Leuchtende Akzente im Interface</span></div><Toggle checked={settings.accentOn} onChange={(checked) => changeSetting({ accentOn: checked })} label="Cyan-Akzent"/></div></div>
              <section className="roadwatch-settings" aria-labelledby="roadwatch-settings-title"><div><span className="section-kicker">ROADWATCH</span><h3 id="roadwatch-settings-title">TruckersMP-Verbindung</h3><p>Diese IDs werden lokal in deiner LegionOS-Konfiguration gespeichert.</p></div><label htmlFor="roadwatch-truckersmp-id">Deine TruckersMP-ID</label><input id="roadwatch-truckersmp-id" type="text" inputMode="numeric" autoComplete="off" maxLength={20} value={truckersmpIdDraft} onChange={(event) => setTruckersmpIdDraft(event.currentTarget.value.replace(/\D/g, "").slice(0, 20))} placeholder="z. B. 12345678"/><label htmlFor="roadwatch-vtc-id">TruckersMP-VTC-ID</label><input id="roadwatch-vtc-id" type="text" inputMode="numeric" autoComplete="off" maxLength={20} value={vtcIdDraft} onChange={(event) => setVtcIdDraft(event.currentTarget.value.replace(/\D/g, "").slice(0, 20))} placeholder="z. B. 12345"/><button className="roadwatch-settings-save" type="button" onClick={saveRoadWatchIds} disabled={!canSave || persistence === "saving" || (truckersmpIdDraft === savedRoadWatchIds.truckersmpId && vtcIdDraft === savedRoadWatchIds.vtcId)}>{persistence === "saving" && (truckersmpIdDraft !== savedRoadWatchIds.truckersmpId || vtcIdDraft !== savedRoadWatchIds.vtcId) ? "Speichert …" : persistence === "error" ? "Erneut speichern" : truckersmpIdDraft === savedRoadWatchIds.truckersmpId && vtcIdDraft === savedRoadWatchIds.vtcId ? "IDs gespeichert" : "IDs speichern"}</button></section>
              <section className="updater-settings" aria-labelledby="updater-heading">
                <div className="updater-heading"><div><span className="section-kicker">LEGIONOS</span><h3 id="updater-heading">Software-Updates</h3></div><span className="updater-lock" title="Signaturprüfung aktiv"><Icon name="check" size={15}/> SIGNIERT</span></div>
                <p className="updater-description">LegionOS sucht beim Start nach einer neuen Version. Updates werden vor der Installation kryptografisch geprüft. Automatische Updates verwenden derzeit NSIS; MSI-Installationen sind noch nicht getestet.</p>
                <div className="updater-actions"><button className="updater-button" type="button" onClick={() => void checkForUpdates()} disabled={updaterBusy}>{updaterBusy && !availableUpdate ? "Prüfe …" : "Nach Updates suchen"}</button>
                  {availableUpdate && <button className="updater-button updater-install" type="button" onClick={() => void installAvailableUpdate()} disabled={updaterBusy}>{updaterBusy ? "Wird installiert …" : `Version ${availableUpdate.version} installieren`}</button>}</div>
                {availableUpdate?.body && <p className="updater-notes"><strong>Versionshinweise</strong><br/>{availableUpdate.body}</p>}
                {downloadTotal !== null && downloadTotal > 0 && <div className="updater-progress"><progress max={downloadTotal} value={Math.min(downloadedBytes, downloadTotal)}/><span>{Math.round(Math.min(downloadedBytes / downloadTotal, 1) * 100)} %</span></div>}
                {updaterBusy && availableUpdate && (downloadTotal === null || downloadTotal <= 0) && downloadedBytes > 0 && <p className="updater-bytes">{(downloadedBytes / 1_048_576).toFixed(1)} MB heruntergeladen</p>}
                <p className="updater-status" role="status" aria-live="polite">{updaterMessage}</p>
              </section>
              <div className="hotkey-settings"><label htmlFor="overlay-hotkey">GLOBALER OVERLAY-HOTKEY</label><div className="hotkey-input-row"><input id="overlay-hotkey" value={hotkeyInput} onChange={(event) => setHotkeyInput(event.currentTarget.value)} placeholder="Tab" aria-describedby="hotkey-help"/><button onClick={() => void saveHotkey()} disabled={hotkeySaving || hotkeyInput.trim() === hotkey}>{hotkeySaving ? "Wird gesetzt …" : "Übernehmen"}</button></div><p id="hotkey-help">Aktuell: <strong>{hotkey}</strong>. Standard: <code>Tab</code> (einzelne Tab-Taste). Kombinationen wie <code>ctrl+shift+space</code> bleiben verfügbar.</p>{hotkeyError && <p className="hotkey-error" role="alert">{hotkeyError}</p>}<p className="ephemeral-note"><span className="note-dot"/> Der Hotkey schaltet das Overlay um. Schließen blendet es aus; „LegionOS beenden“ beendet die Anwendung.</p><button className="exit-phone-button" onClick={() => void invoke("exit_phone")}>LegionOS beenden</button></div>
              <p className="ephemeral-note"><span className="note-dot"/> {persistence === "error" ? "Speichern fehlgeschlagen — Änderungen sind noch nicht gesichert" : persistence === "memory" ? "Nur in dieser Browser-Vorschau verfügbar" : "Wird automatisch auf diesem Gerät gespeichert"}</p></div>}
            {shownWindow.appId === "notes" && <div className="notes-view"><div className="window-section-heading"><span className="section-kicker">SCHNELL NOTIERT</span><h2>Was geht dir <span>durch den Kopf?</span></h2><p>Deine Notiz wird automatisch gespeichert.</p></div><label className="note-label" htmlFor="quick-note">MEINE NOTIZ</label><textarea id="quick-note" value={note} onChange={(event) => setNote(event.currentTarget.value)} onBlur={() => { if (isTauri() && canSaveRef.current && note !== lastSavedNote.current) { const value = note; void enqueueSave(async () => { await invoke("save_notes", { notes: value }); lastSavedNote.current = value; }); } }} placeholder="Ein Gedanke, eine Idee, eine Erinnerung …"/><div className="note-footer"><span>{note.length} Zeichen</span><span className={`save-indicator save-${persistence}`}><span className="status-dot"/> {persistence === "saving" ? "Wird gespeichert" : persistence === "error" ? "Speicherproblem" : persistence === "memory" ? "Nur in dieser Vorschau" : "Gespeichert"}</span></div></div>}
            {shownWindow.appId === "demo" && <div className="demo-view"><div className="window-section-heading"><span className="section-kicker">INTERAKTIVER SPIELPLATZ</span><h2>Ein Klick. <span>Ein bisschen Freude.</span></h2><p>Tippe den Button und schau, was passiert.</p></div><div className="counter-card"><div className="counter-orbit"><Icon name="spark" size={28}/></div><span className="counter-label">DEIN KLICK-ZÄHLER</span><strong className="counter-number">{count.toString().padStart(2, "0")}</strong><button className="counter-button" onClick={() => setCount((value) => value + 1)}>Weiterklicken <Icon name="chevron" size={16}/></button><span className="ephemeral-note"><span className="note-dot"/> Zähler wird nicht gespeichert</span></div><button className="reset-button" onClick={() => setCount(0)}>Zähler zurücksetzen</button></div>}
            {shownWindow.appId === "focus" && <FocusApp onActivate={() => { setActiveNav(null); dispatch({ type: "activate", id: shownWindow.id }); }}/>}
            {shownWindow.appId === "snake" && <SnakeApp active={isActive}/>}
            {shownWindow.appId === "pong" && <PongApp active={isActive}/>}
            {shownWindow.appId === "roadwatch" && <RoadWatchApp active={isActive} truckersmpId={settings.truckersmpId} vtcId={settings.vtcId} onOpenSettings={() => openApp("settings")}/>}
          </div>
          {mode === "tablet" && (["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const).map((edge) => <div
            key={edge}
            className={`window-resize-handle resize-${edge}`}
            aria-hidden="true"
            onPointerDown={(event) => handleResizePointerDown(shownWindow.id, edge, event)}
            onPointerMove={handleWindowPointerMove}
            onPointerUp={handleWindowPointerEnd}
            onPointerCancel={handleWindowPointerEnd}
          />)}
        </section>;
        })}
      </section>
    </main>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return <button type="button" className={`toggle${checked ? " toggle-on" : ""}`} role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}><span/></button>;
}

export default App;
