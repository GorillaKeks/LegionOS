import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import packageMetadata from "../package.json";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import type { PointerEvent as ReactPointerEvent } from "react";
import "./App.css";
import { appInfo, type AppId, type InternalAppId } from "./apps";
import { getAppUsageState, selectInstalledApps, selectAvailableApps, selectInstalledCatalogApps, type LocalAppStoreSnapshot } from "./appStore";
import FocusApp from "./FocusApp";
import SnakeApp from "../apps/snake/SnakeApp";
import PongApp from "../apps/pong/PongApp";
import SpaceInvadersApp from "../apps/space-invaders/SpaceInvadersApp";
import RoadWatchApp from "../apps/roadwatch/RoadWatchApp";
import RadioApp from "../apps/radio/RadioApp";
import { RadioPlaybackProvider, useRadioPlayback } from "../apps/radio/RadioPlayback";
import { initialWindowState, selectOpenAppIcons, windowReducer } from "./windowManager";
import type { WindowPosition, WindowSize } from "./windowManager";
import { getGreeting } from "./greeting";
import { localeForLanguage, t, type Language } from "./i18n";
import legionMark from "./assets/legion-tray-sizes/32x32.png";

type ViewMode = "phone" | "tablet";
type UserSettings = { quietMode: boolean; accentOn: boolean; truckersmpId: string; vtcId: string; language: Language };
type ConfigSnapshot = { version: number; mode: ViewMode; settings: UserSettings; notes: string; canSave: boolean; notice: string | null; overlayHotkey: string; overlayHotkeyError: string | null };
type PersistenceStatus = "loading" | "saved" | "saving" | "memory" | "error";
type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
type WindowDrag =
  | { kind: "move"; windowId: string; pointerId: number; offsetX: number; offsetY: number }
  | { kind: "resize"; windowId: string; pointerId: number; edge: ResizeEdge; startX: number; startY: number; startWidth: number; startHeight: number; pointerX: number; pointerY: number };
const defaultSettings: UserSettings = { quietMode: false, accentOn: true, truckersmpId: "", vtcId: "", language: "en" };

type IconName = "settings" | "note" | "spark" | "snake" | "pong" | "invaders" | "roadwatch" | "radio" | "chevron" | "close" | "minus" | "home" | "grid" | "sun" | "sunset" | "moon" | "check" | "power";

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  const paths: Record<IconName, ReactNode> = {
    settings: <><path d="M12 8.3a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Z"/><path d="m19.4 15 .1.1a1.7 1.7 0 1 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 1 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 1 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 1 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 1 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 1 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 1 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 1 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z" transform="translate(1 1) scale(.92)"/></>,
    note: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></>,
    spark: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="m19 16 .9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9L19 16Z"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>, close: <path d="m18 6-12 12M6 6l12 12"/>,
    minus: <path d="M5 12h14"/>, snake: <><path d="M5 7h7a3 3 0 0 1 3 3v4a3 3 0 0 0 3 3h1"/><path d="M5 7v4a3 3 0 0 0 3 3h4a3 3 0 0 1 3 3v0"/><circle cx="7" cy="7" r="1" fill="currentColor"/><circle cx="19" cy="17" r="1" fill="currentColor"/></>, pong: <><path d="M5 5v5M5 14v5M19 5v5M19 14v5"/><path d="M12 3v18" strokeDasharray="2 3"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/></>, invaders: <><path d="M7 5h10v3h3v8h-3v3h-3v-3h-4v3H7v-3H4V8h3z"/><circle cx="9" cy="10" r="1" fill="currentColor"/><circle cx="15" cy="10" r="1" fill="currentColor"/><path d="M2 22h20M12 18v4"/></>, roadwatch: <><path d="m8 3-4 18M16 3l4 18"/><path d="M12 4v3m0 4v3m0 4v3" strokeDasharray="2 1"/><path d="M12 5a3 3 0 0 1 3 3c0 2-3 5-3 5S9 10 9 8a3 3 0 0 1 3-3Z"/><circle cx="12" cy="8" r=".8" fill="currentColor" stroke="none"/></>, radio: <><path d="M4 8.5 19 4"/><rect x="3" y="8" width="18" height="12" rx="2"/><circle cx="9" cy="14" r="3"/><path d="M15 12h3m-3 4h3"/></>, home: <><path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9M9 20v-7h6v7"/></>,
    grid: <><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></>,
    sunset: <><path d="M3 18h18M5 14a7 7 0 0 1 14 0M12 2v3m-7 1 2 2m12-2-2 2m-8 8h2m2 0h2"/></>,
    moon: <path d="M20.9 13A8.5 8.5 0 0 1 11 3.1 8.5 8.5 0 1 0 20.9 13Z"/>, check: <path d="m5 12 4 4L19 6"/>, power: <><path d="M12 2v10"/><path d="M6.2 5.8a8 8 0 1 0 11.6 0"/></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function AppContent() {
  const { stopPlayback } = useRadioPlayback();
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
  const [hotkeySaved, setHotkeySaved] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [updaterMessage, setUpdaterMessage] = useState(() => t(defaultSettings.language, "updater.notChecked"));
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
    document.documentElement.lang = settings.language;
  }, [settings.language]);

  useEffect(() => {
    if (!loaded) return;
    if (!isTauri()) {
      setAppStoreLoading(false);
      setAppStoreError(t(settings.language, "store.desktopOnly"));
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
      setAppStoreError(`${t(settings.language, "store.configError")} ${String(error)}`);
    }).finally(() => { if (!cancelled) setAppStoreLoading(false); });
    return () => { cancelled = true; };
  }, [loaded]);

  useEffect(() => {
    if (!isTauri()) {
      setPersistence("memory");
      setPersistenceNotice(t(settings.language, "persistence.browserPreview"));
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
      setPersistenceNotice(`${t(settings.language, "settings.configLoadError")} ${String(error)}`);
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
    setUpdaterMessage(t(settings.language, "updater.startSearch"));
    void check({ timeout: 20_000 }).then((update) => {
      if (cancelled) {
        if (update) void update.close().catch(() => undefined);
        return;
      }
      if (!update) {
        setUpdaterMessage(t(settings.language, "updater.current"));
        return;
      }
      setAvailableUpdate(update);
      setUpdaterMessage(t(settings.language, "updater.available", { version: update.version }));
    }).catch((error: unknown) => {
      if (!cancelled) setUpdaterMessage(`${t(settings.language, "updater.failed")} ${String(error)}`);
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
        setPersistenceNotice(`${t(settings.language, "settings.configSaveError")} ${String(error)}`);
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

  const language = settings.language;
  const time = useMemo(() => new Intl.DateTimeFormat(localeForLanguage(language), { hour: "2-digit", minute: "2-digit" }).format(now), [now, language]);
  const date = useMemo(() => new Intl.DateTimeFormat(localeForLanguage(language), { weekday: "long", day: "numeric", month: "long" }).format(now), [now, language]);
  const greeting = useMemo(() => getGreeting(now, language), [now, language]);
  const activeWindow = windowState.windows.find((window) => window.id === windowState.activeId);
  const activeLayout = activeWindow ? windowState.layouts[activeWindow.appId] : undefined;
  const minimized = windowState.windows.filter((window) => window.minimized);
  const visibleWindows = windowState.windows.filter((window) => !window.minimized);
  const installedApps = useMemo(() => appStore ? selectInstalledApps(appStore) : isTauri() ? [] : selectInstalledApps(null), [appStore]);
  const openAppIcons = useMemo(() => selectOpenAppIcons(windowState), [windowState]);
  const availableStoreApps = useMemo(() => selectAvailableApps(appStore), [appStore]);
  const installedStoreApps = useMemo(() => selectInstalledCatalogApps(appStore), [appStore]);
  const runtimeAppInfo = useMemo(() => Object.fromEntries(installedApps.map(({ id, info }) => [id, info])) as Partial<Record<AppId, typeof appInfo[AppId]>>, [installedApps]);
  const getAppInfo = (appId: AppId) => {
    const info = runtimeAppInfo[appId] ?? appInfo[appId];
    return { ...info, name: t(language, `app.${appId}.name`), subtitle: t(language, `app.${appId}.subtitle`) };
  };
  const manifestName = (id: string, fallback: string) => {
    const translated = t(language, `app.${id}.name`);
    return translated === `app.${id}.name` ? fallback : translated;
  };
  const manifestDescription = (id: string, fallback: string) => t(language, `app.${id}.description`) === `app.${id}.description` ? fallback : t(language, `app.${id}.description`);
  const openApp = (appId: InternalAppId) => {
    setActiveNav(null);
    dispatch({ type: "open", appId });
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
    if (!install && id === "settings") return;
    if (!isTauri() || appStoreBusyId) return;
    setAppStoreBusyId(id);
    setAppStoreError(null);
    try {
      const snapshot = await invoke<LocalAppStoreSnapshot>(install ? "install_local_app" : "uninstall_local_app", { id });
      setAppStore(snapshot);
      if (!install) {
        if (id === "radio") stopPlayback();
        const session = windowState.windows.find((window) => window.appId === id);
        if (session) dispatch({ type: "close", id: session.id });
      }
    } catch (error) {
      setAppStoreError(`${t(language, "store.actionError")} ${t(language, install ? "store.installWord" : "store.removeWord")}: ${String(error)}`);
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
      setHotkeyError(t(language, "hotkey.desktopOnly"));
      return;
    }
    setHotkeySaving(true);
    setHotkeyError(null);
    setHotkeySaved(false);
    try {
      const saved = await invoke<string>("set_overlay_hotkey", { hotkey: hotkeyInput.trim() });
      setHotkey(saved);
      setHotkeyInput(saved);
      setHotkeySaved(true);
    } catch (error) {
      setHotkeyError(String(error));
    } finally {
      setHotkeySaving(false);
    }
  };

  const checkForUpdates = async () => {
    if (!isTauri()) {
      setUpdaterMessage(t(language, "updater.notDesktop"));
      return;
    }
    setUpdaterBusy(true);
    setUpdaterMessage(t(language, "updater.startSearch"));
    setDownloadedBytes(0);
    setDownloadTotal(null);
    if (availableUpdate) await availableUpdate.close().catch(() => undefined);
    setAvailableUpdate(null);
    try {
      const update = await check({ timeout: 20_000 });
      if (!update) {
        setUpdaterMessage(t(language, "updater.current"));
        return;
      }
      setAvailableUpdate(update);
      setUpdaterMessage(t(language, "updater.available", { version: update.version }));
    } catch (error) {
      setUpdaterMessage(`${t(language, "updater.failed")} ${String(error)}`);
    } finally {
      setUpdaterBusy(false);
    }
  };

  const installAvailableUpdate = async () => {
    if (!availableUpdate || updaterBusy) return;
    const notes = availableUpdate.body?.trim();
    const detail = notes ? `\n\n${t(language, "updater.notes")}\n${notes}` : `\n\n${t(language, "updater.noNotes")}`;
    if (!window.confirm(`${t(language, "updater.confirm", { version: availableUpdate.version })}${detail}`)) return;
    setUpdaterBusy(true);
    setUpdaterMessage(t(language, "updater.downloading"));
    setDownloadedBytes(0);
    setDownloadTotal(null);
    try {
      await availableUpdate.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          setDownloadTotal(event.data.contentLength ?? null);
          setUpdaterMessage(t(language, "updater.downloading"));
        } else if (event.event === "Progress") {
          setDownloadedBytes((bytes) => bytes + event.data.chunkLength);
        } else if (event.event === "Finished") {
          setUpdaterMessage(t(language, "updater.installing"));
        }
      });
    } catch (error) {
      setUpdaterMessage(`${t(language, "updater.installFailed")} ${String(error)}`);
      setUpdaterBusy(false);
    }
  };

  if (!loaded) {
    return <main className="boot-screen"><span className="boot-mark"/><span>{t(settings.language, "boot.loading")}</span></main>;
  }

  return (
    <main className={`phone-shell mode-${mode}${settings.accentOn ? " accent-on" : " accent-off"}`}>
      <div className="device-hardware" aria-hidden="true"><span className="hardware-camera"/><span className="hardware-speaker"/><span className="hardware-home"/></div>
      {mode === "tablet" && <nav className="side-panel" aria-label={t(language, "nav.main")}>
        <div className="side-brand"><img src={legionMark} alt="LΣ" title="LΣGIΦN ΦS"/></div>
        <div className="side-nav">
          <button className={`side-nav-button${!activeWindow && activeNav === "home" ? " side-nav-active" : ""}`} type="button" aria-label={t(language, "nav.home")} title={t(language, "nav.home")} aria-current={!activeWindow && activeNav === "home" ? "page" : undefined} onClick={openHome}><Icon name="home" size={23}/></button>
          <button className={`side-nav-button${!activeWindow && activeNav === "store" ? " side-nav-active" : ""}`} type="button" aria-label={t(language, "nav.store")} title={t(language, "nav.store")} aria-current={!activeWindow && activeNav === "store" ? "page" : undefined} onClick={openStore}><Icon name="grid" size={22}/></button>
          {openAppIcons.length > 0 && <span className="side-nav-divider" aria-hidden="true"/>}
          {openAppIcons.map(({ window: session, active, minimized: isMinimized }) => {
            const info = getAppInfo(session.appId);
            const hint = isMinimized ? `${info.name} (${t(language, "window.minimized")})` : info.name;
            return <button key={session.id} className={`side-nav-button side-nav-app${active ? " side-nav-active" : ""}${isMinimized ? " side-nav-minimized" : ""}`} type="button" aria-label={isMinimized ? `${hint}; ${t(language, "nav.minimized.restore")}` : t(language, "nav.focus", { name: info.name })} title={hint} aria-current={active ? "page" : undefined} onClick={() => focusApp(session.id)}><Icon name={info.icon} size={22}/></button>;
          })}
        </div>
        <span className="side-status" role="status" aria-label={t(language, "nav.ready")} title={t(language, "nav.ready")}/>
      </nav>}

      <section className="phone-stage" ref={phoneStageRef}>
        <header className={`topbar${mode === "phone" && availableUpdate ? " topbar-has-update" : ""}`}>
          <div className="topbar-context" data-tauri-drag-region><span className="eyebrow">{t(language, "header.digitalSpace")}</span><span className="topbar-greeting">{greeting.text} <span className="greeting-spark"><Icon name={greeting.icon} size={13}/></span></span></div>
          <div className="topbar-brand" aria-label="LΣGIΦN ΦS" data-tauri-drag-region>LΣGIΦN ΦS</div>
          <div className="topbar-right" data-tauri-drag-region><span className="date-label">{date}</span><span className="topbar-divider"/><span className="clock">{time}</span><span className="online-indicator" title={t(language, "header.ready")} /></div>
          {mode === "phone" && availableUpdate && <button className="topbar-update-notice" type="button" onClick={() => openApp("settings")} title={t(language, "updater.openTitle", { version: availableUpdate.version })} aria-label={`${t(language, "updater.availableBanner")}. ${t(language, "settings.installUpdate", { version: availableUpdate.version })}`}>{t(language, "updater.availableBanner")}</button>}
        </header>

        <div className={`workspace${activeNav === "store" ? " workspace-store" : ""}`} ref={workspaceRef}>
        {activeNav === "store" ? <div className="store-view">
          <div className="store-heading"><div><p className="section-kicker">{t(language, "store.kicker")}</p><h1>{t(language, "store.title")}<span>.</span></h1><p className="welcome-copy">{t(language, "store.subtitle")}</p></div><span className="store-local-badge"><span className="status-dot"/> {t(language, "store.localOnly")}</span></div>
          {appStoreError && <div className="store-message store-error" role="alert">{appStoreError}</div>}
          {appStoreLoading && <div className="store-message" role="status">{t(language, "store.checking")}</div>}
          {!appStoreLoading && !appStoreError && appStore && <>
            <section className="store-section"><div className="store-section-heading"><h2>{t(language, "store.install")}</h2><span>{availableStoreApps.length.toString().padStart(2, "0")}</span></div>
              {availableStoreApps.length === 0 ? <p className="store-empty">{t(language, "store.allInstalled")}</p> : <div className="store-grid">{availableStoreApps.map((item) => {
                const manifest = item.manifest!;
                const info = appInfo[manifest.id as AppId];
                return <article className={`store-card app-${info.color}`} key={`${item.folder}-${manifest.id}`}><span className="app-icon-wrap"><Icon name={manifest.icon} size={23}/></span><div className="store-card-copy"><h3>{manifestName(manifest.id, manifest.name)}</h3><span>{t(language, "store.version", { version: manifest.version })}</span><p>{manifestDescription(manifest.id, manifest.description)}</p></div><button type="button" className="store-action" title={!canSave ? t(language, "store.readOnly") : undefined} disabled={appStoreBusyId !== null || !canSave} onClick={() => void changeInstallation(manifest.id, true)}>{appStoreBusyId === manifest.id ? t(language, "store.installing") : t(language, "store.installButton")}</button></article>;
              })}</div>}
            </section>
            <section className="store-section"><div className="store-section-heading"><h2>{t(language, "store.installed")}</h2><span>{installedStoreApps.length.toString().padStart(2, "0")}</span></div>
              {installedStoreApps.length === 0 ? <p className="store-empty">{t(language, "store.noneInstalled")}</p> : <div className="store-grid">{installedStoreApps.map((item) => {
                const manifest = item.manifest!;
                const info = appInfo[manifest.id as AppId];
                const usageState = getAppUsageState(manifest.id, appStore, windowState);
                const usageLabel = t(language, `store.usage.${usageState}`);
                const protectedApp = manifest.id === "settings";
                return <article className={`store-card app-${info.color}`} key={`${item.folder}-${manifest.id}`}><span className="app-icon-wrap"><Icon name={manifest.icon} size={23}/></span><div className="store-card-copy"><h3>{manifestName(manifest.id, manifest.name)}</h3><span>{t(language, "store.version", { version: manifest.version })}</span><p>{manifestDescription(manifest.id, manifest.description)}</p><span className={`store-state store-state-${usageState}`}>{usageLabel}</span></div><button type="button" className="store-action store-remove" title={protectedApp ? t(language, "store.required") : !canSave ? t(language, "store.readOnly") : undefined} disabled={protectedApp || appStoreBusyId !== null || !canSave} onClick={() => void changeInstallation(manifest.id, false)}>{protectedApp ? t(language, "store.required") : appStoreBusyId === manifest.id ? t(language, "store.uninstalling") : t(language, "store.uninstall")}</button></article>;
              })}</div>}
            </section>
            {appStore.apps.some((item) => item.error) && <section className="store-section store-invalid"><div className="store-section-heading"><h2>{t(language, "store.skipped")}</h2></div><ul>{appStore.apps.filter((item) => item.error).map((item) => <li key={item.folder}><strong>{item.folder}</strong><span>{item.error}</span></li>)}</ul></section>}
          </>}
        </div> : <>
          <div className="welcome-row">
            <div><p className="section-kicker">{t(language, "home.kicker")}</p><h1>{t(language, "home.titlePrefix")} <span>{t(language, "home.titleAccent")}</span></h1><p className="welcome-copy">{t(language, "home.subtitle")}</p></div>
            <div className="welcome-date"><span className="date-day">{now.toLocaleDateString(localeForLanguage(language), { day: "2-digit" })}</span><span className="date-month">{now.toLocaleDateString(localeForLanguage(language), { month: "short" }).replace(".", "").toUpperCase()}</span></div>
          </div>

          {persistenceNotice && <div className={`persistence-banner${persistence === "error" ? " persistence-error" : ""}`} role="status">{persistenceNotice}</div>}

          <div className="apps-heading"><div><h2>{t(language, "home.apps")}</h2><span className="apps-count">{installedApps.length.toString().padStart(2, "0")} {t(language, "home.appsCount")}</span></div><span className="apps-hint">{t(language, "home.openHint")}</span></div>
          <div className="app-grid">
            {installedApps.map(({ id, info }, index) => {
              const session = windowState.windows.find((window) => window.appId === id);
              const localizedInfo = getAppInfo(id);
              return <button className={`app-card app-${info.color}${session && !session.minimized ? " app-running" : ""}`} key={id} onClick={() => openApp(id)}>
                <span className="app-card-index">0{index + 1}</span><span className="app-icon-wrap"><Icon name={localizedInfo.icon} size={25}/><span className="app-icon-glow" /></span>
                <span className="app-card-title">{localizedInfo.name}</span><span className="app-card-subtitle">{localizedInfo.subtitle}</span>
                <span className="app-card-arrow"><Icon name="chevron" size={15}/></span>{session && <span className={`running-dot${session.minimized ? " running-muted" : ""}`} title={session.minimized ? t(language, "window.minimized") : t(language, "window.opened")}/>}
              </button>;
            })}
          </div>

          <div className="workspace-lower">
            <div className="tip-card"><div className="tip-icon"><Icon name="spark" size={17}/></div><div><span className="tip-label">{t(language, "home.tipLabel")}</span><p>{t(language, "home.tip")}</p></div></div>
            <div className="session-card"><span className="session-label">{t(language, "home.session")}</span><span className="session-value">{windowState.windows.length.toString().padStart(2, "0")} <span>{t(language, "home.openWindows")}</span></span><span className="session-foot">{t(language, "home.sessionFoot")}</span></div>
          </div>
        </>}
        </div>

        <footer className="bottom-dock">
          <button className={`dock-home${!activeWindow && activeNav === "home" ? " dock-nav-active" : ""}`} type="button" aria-label={t(language, "nav.home")} title={t(language, "nav.home")} aria-current={!activeWindow && activeNav === "home" ? "page" : undefined} onClick={openHome}><span className="dock-home-icon"><Icon name="home" size={16}/></span><span>{t(language, "nav.home.label")}</span></button>
          {mode === "phone" && <div className="dock-windows" aria-label={t(language, "nav.windows")}>
            {windowState.windows.filter((window) => !window.minimized).map((window) => <button key={window.id} className={`dock-window${window.id === activeWindow?.id ? " dock-active" : ""}`} onClick={() => dispatch({ type: "activate", id: window.id })} title={getAppInfo(window.appId).name}><Icon name={getAppInfo(window.appId).icon} size={15}/><span>{getAppInfo(window.appId).name}</span></button>)}
            {minimized.map((window) => <button key={window.id} className="dock-window dock-minimized" onClick={() => dispatch({ type: "activate", id: window.id })} title={getAppInfo(window.appId).name} aria-label={getAppInfo(window.appId).name}><Icon name={getAppInfo(window.appId).icon} size={15}/><span>{getAppInfo(window.appId).name}</span></button>)}
          </div>}
          {mode === "phone" && <button className={`dock-store${!activeWindow && activeNav === "store" ? " dock-nav-active" : ""}`} type="button" aria-label={t(language, "nav.store")} title={t(language, "nav.store")} aria-current={!activeWindow && activeNav === "store" ? "page" : undefined} onClick={openStore}><Icon name="grid" size={19}/></button>}
          {mode === "tablet" && availableUpdate && <button className="dock-update-notice" type="button" onClick={() => openApp("settings")} title={t(language, "updater.openTitle", { version: availableUpdate.version })} aria-label={`${t(language, "updater.availableBanner")}. ${t(language, "settings.installUpdate", { version: availableUpdate.version })}`}>{t(language, "updater.availableBanner")}</button>}
          <span className="dock-session"><span className="status-dot"/> {t(language, "nav.session")} <span className="dock-version">{packageMetadata.version}</span></span>
          <button className="dock-power" type="button" aria-label={t(language, "settings.exit")} title={t(language, "settings.exit")} onClick={() => void invoke("exit_phone")}><Icon name="power" size={17}/></button>
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
            aria-label={t(language, "window.label", { name: getAppInfo(shownWindow.appId).name })}
          >
          <div className={`window-titlebar${mode === "tablet" ? " window-titlebar-draggable" : ""}`} onPointerDown={(event) => handleWindowPointerDown(shownWindow.id, event)} onPointerMove={handleWindowPointerMove} onPointerUp={handleWindowPointerEnd} onPointerCancel={handleWindowPointerEnd}>
            <div className="window-app-mark"><Icon name={getAppInfo(shownWindow.appId).icon} size={16}/></div>
            <div className="window-title"><strong>{getAppInfo(shownWindow.appId).name}</strong><span>{getAppInfo(shownWindow.appId).subtitle}</span></div>
            <div className="window-actions"><button onClick={() => dispatch({ type: "minimize", id: shownWindow.id })} aria-label={t(language, "window.minimize")}><Icon name="minus" size={16}/></button><button className="window-close" onClick={() => { if (shownWindow.appId === "radio") stopPlayback(); dispatch({ type: "close", id: shownWindow.id }); }} aria-label={t(language, "window.close")}><Icon name="close" size={16}/></button></div>
          </div>
          <div className="window-content">
            {shownWindow.appId === "settings" && <div className="settings-view"><div className="window-section-heading"><span className="section-kicker">{t(language, "settings.kicker")}</span><h2>{t(language, "settings.title")}</h2><p>{t(language, "settings.subtitle")}</p></div>
              <div className="language-settings"><div><label className="device-mode-label" htmlFor="ui-language">{t(language, "settings.language.label")}</label><span>{t(language, "settings.language.description")}</span></div><select id="ui-language" value={language} onChange={(event) => changeSetting({ language: event.currentTarget.value as Language })}><option value="en">{t(language, "settings.language.en")}</option><option value="de">{t(language, "settings.language.de")}</option><option value="nl">{t(language, "settings.language.nl")}</option></select></div>
              <div className="device-mode-settings"><span className="device-mode-label">{t(language, "settings.device.label")}</span><div className="device-mode-options" role="group" aria-label={t(language, "settings.device.label")}>
                <button className={`device-mode-option${mode === "phone" ? " selected" : ""}`} onClick={() => void changeMode("phone")} aria-pressed={mode === "phone"} disabled={modeChanging}><span className="device-icon device-phone"/><span><strong>{t(language, "settings.phone")}</strong><small>{t(language, "settings.phone.orientation")}</small></span></button>
                <button className={`device-mode-option${mode === "tablet" ? " selected" : ""}`} onClick={() => void changeMode("tablet")} aria-pressed={mode === "tablet"} disabled={modeChanging}><span className="device-icon device-tablet"/><span><strong>{t(language, "settings.tablet")}</strong><small>{t(language, "settings.tablet.orientation")}</small></span></button>
              </div>{modeChanging && <span className="device-mode-status" role="status">{t(language, "settings.modeChanging")}</span>}</div>
              <div className="settings-group"><div className="settings-row"><div className="settings-row-icon settings-cyan"><Icon name="moon" size={17}/></div><div className="settings-row-copy"><strong>{t(language, "settings.quiet")}</strong><span>{t(language, "settings.example")}</span></div><Toggle checked={settings.quietMode} onChange={(checked) => changeSetting({ quietMode: checked })} label={t(language, "settings.quiet")}/></div>
                <div className="settings-row"><div className="settings-row-icon settings-violet"><Icon name="sun" size={17}/></div><div className="settings-row-copy"><strong>{t(language, "settings.accent")}</strong><span>{t(language, "settings.accentDescription")}</span></div><Toggle checked={settings.accentOn} onChange={(checked) => changeSetting({ accentOn: checked })} label={t(language, "settings.accent")}/></div></div>
              <section className="roadwatch-settings" aria-labelledby="roadwatch-settings-title"><div><span className="section-kicker">{t(language, "settings.roadwatch")}</span><h3 id="roadwatch-settings-title">{t(language, "settings.roadwatchTitle")}</h3><p>{t(language, "settings.roadwatchDescription")}</p></div><label htmlFor="roadwatch-truckersmp-id">{t(language, "settings.yourTruckersmpId")}</label><input id="roadwatch-truckersmp-id" type="text" inputMode="numeric" autoComplete="off" maxLength={20} value={truckersmpIdDraft} onChange={(event) => setTruckersmpIdDraft(event.currentTarget.value.replace(/\D/g, "").slice(0, 20))} placeholder="12345678"/><label htmlFor="roadwatch-vtc-id">{t(language, "settings.vtcId")}</label><input id="roadwatch-vtc-id" type="text" inputMode="numeric" autoComplete="off" maxLength={20} value={vtcIdDraft} onChange={(event) => setVtcIdDraft(event.currentTarget.value.replace(/\D/g, "").slice(0, 20))} placeholder="12345"/><button className="roadwatch-settings-save" type="button" onClick={saveRoadWatchIds} disabled={!canSave || persistence === "saving" || (truckersmpIdDraft === savedRoadWatchIds.truckersmpId && vtcIdDraft === savedRoadWatchIds.vtcId)}>{persistence === "saving" && (truckersmpIdDraft !== savedRoadWatchIds.truckersmpId || vtcIdDraft !== savedRoadWatchIds.vtcId) ? t(language, "settings.saving") : persistence === "error" ? t(language, "settings.retrySave") : truckersmpIdDraft === savedRoadWatchIds.truckersmpId && vtcIdDraft === savedRoadWatchIds.vtcId ? t(language, "settings.saved") : t(language, "settings.saveIds")}</button></section>
              <section className="updater-settings" aria-labelledby="updater-heading">
                <div className="updater-heading"><div><span className="section-kicker">LEGIONOS</span><h3 id="updater-heading">{t(language, "settings.updates")}</h3></div><span className="updater-lock" title={t(language, "settings.signed")}><Icon name="check" size={15}/> {t(language, "settings.signed")}</span></div>
                <p className="updater-description">{t(language, "settings.updaterDescription")}</p>
                <div className="updater-actions"><button className="updater-button" type="button" onClick={() => void checkForUpdates()} disabled={updaterBusy}>{updaterBusy && !availableUpdate ? t(language, "settings.checking") : t(language, "settings.checkUpdates")}</button>
                  {availableUpdate && <button className="updater-button updater-install" type="button" onClick={() => void installAvailableUpdate()} disabled={updaterBusy}>{updaterBusy ? t(language, "settings.installingUpdate") : t(language, "settings.installUpdate", { version: availableUpdate.version })}</button>}</div>
                {availableUpdate?.body && <p className="updater-notes"><strong>{t(language, "settings.releaseNotes")}</strong><br/>{availableUpdate.body}</p>}
                {downloadTotal !== null && downloadTotal > 0 && <div className="updater-progress"><progress max={downloadTotal} value={Math.min(downloadedBytes, downloadTotal)}/><span>{Math.round(Math.min(downloadedBytes / downloadTotal, 1) * 100)} %</span></div>}
                {updaterBusy && availableUpdate && (downloadTotal === null || downloadTotal <= 0) && downloadedBytes > 0 && <p className="updater-bytes">{t(language, "updater.downloaded", { size: (downloadedBytes / 1_048_576).toFixed(1) })}</p>}
                <p className="updater-status" role="status" aria-live="polite">{updaterMessage}</p>
              </section>
              <div className="hotkey-settings"><label htmlFor="overlay-hotkey">{t(language, "settings.hotkeyLabel")}</label><div className="hotkey-input-row"><input id="overlay-hotkey" value={hotkeyInput} onChange={(event) => { setHotkeyInput(event.currentTarget.value); setHotkeyError(null); setHotkeySaved(false); }} onKeyDown={(event) => { if (event.key === "Enter" && !hotkeySaving && hotkeyInput.trim() !== hotkey) { event.preventDefault(); void saveHotkey(); } }} placeholder="F8, A or ctrl+shift+space" autoComplete="off" spellCheck={false} aria-describedby="hotkey-help"/><button type="button" onClick={() => void saveHotkey()} disabled={hotkeySaving || !canSave || !hotkeyInput.trim() || hotkeyInput.trim() === hotkey}>{hotkeySaving ? t(language, "settings.saving") : t(language, "settings.saveHotkey")}</button></div><p id="hotkey-help">{t(language, "settings.current")}: <strong>{hotkey}</strong>. {t(language, "settings.hotkeyHelp")}</p>{hotkeySaved && <p className="hotkey-saved" role="status">{t(language, "settings.hotkeySaved")}</p>}{hotkeyError && <p className="hotkey-error" role="alert">{hotkeyError}</p>}<p className="ephemeral-note"><span className="note-dot"/> {t(language, "settings.exitDescription")}</p><button className="exit-phone-button" onClick={() => void invoke("exit_phone")}>{t(language, "settings.exit")}</button></div>
              <p className="ephemeral-note"><span className="note-dot"/> {persistence === "error" ? t(language, "settings.saveFailed") : persistence === "memory" ? t(language, "settings.memoryOnly") : t(language, "settings.savedLocally")}</p></div>}
            {shownWindow.appId === "notes" && <div className="notes-view"><div className="window-section-heading"><span className="section-kicker">{t(language, "notes.kicker")}</span><h2>{t(language, "notes.title")}</h2><p>{t(language, "notes.subtitle")}</p></div><label className="note-label" htmlFor="quick-note">{t(language, "notes.label")}</label><textarea id="quick-note" value={note} onChange={(event) => setNote(event.currentTarget.value)} onBlur={() => { if (isTauri() && canSaveRef.current && note !== lastSavedNote.current) { const value = note; void enqueueSave(async () => { await invoke("save_notes", { notes: value }); lastSavedNote.current = value; }); } }} placeholder={t(language, "notes.placeholder")}/><div className="note-footer"><span>{note.length} {t(language, "notes.characters")}</span><span className={`save-indicator save-${persistence}`}><span className="status-dot"/> {t(language, persistence === "saving" ? "notes.saving" : persistence === "error" ? "notes.saveProblem" : persistence === "memory" ? "notes.memory" : "notes.saved")}</span></div></div>}
            {shownWindow.appId === "demo" && <div className="demo-view"><div className="window-section-heading"><span className="section-kicker">{t(language, "demo.kicker")}</span><h2>{t(language, "demo.title")}</h2><p>{t(language, "demo.subtitle")}</p></div><div className="counter-card"><div className="counter-orbit"><Icon name="spark" size={28}/></div><span className="counter-label">{t(language, "demo.counter")}</span><strong className="counter-number">{count.toString().padStart(2, "0")}</strong><button className="counter-button" onClick={() => setCount((value) => value + 1)}>{t(language, "demo.next")} <Icon name="chevron" size={16}/></button><span className="ephemeral-note"><span className="note-dot"/> {t(language, "demo.notSaved")}</span></div><button className="reset-button" onClick={() => setCount(0)}>{t(language, "demo.reset")}</button></div>}
            {shownWindow.appId === "focus" && <FocusApp language={language} onActivate={() => { setActiveNav(null); dispatch({ type: "activate", id: shownWindow.id }); }}/>}
            {shownWindow.appId === "snake" && <SnakeApp active={isActive} language={language}/>}
            {shownWindow.appId === "pong" && <PongApp active={isActive} language={language}/>}
            {shownWindow.appId === "space-invaders" && <SpaceInvadersApp active={isActive} language={language}/>}
            {shownWindow.appId === "roadwatch" && <RoadWatchApp active={isActive} truckersmpId={settings.truckersmpId} vtcId={settings.vtcId} language={language} onOpenSettings={() => openApp("settings")}/>}
            {shownWindow.appId === "radio" && <RadioApp language={language}/>}
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

function App() {
  return <RadioPlaybackProvider><AppContent/></RadioPlaybackProvider>;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return <button type="button" className={`toggle${checked ? " toggle-on" : ""}`} role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}><span/></button>;
}

export default App;
