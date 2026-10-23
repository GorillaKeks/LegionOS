import type { InternalAppId } from "./apps.ts";

export type WindowMode = "phone" | "tablet";
export type WindowPosition = { x: number; y: number };
export type WindowSize = { width: number; height: number };
export type WindowMoveBounds = {
  displayWidth: number;
  displayHeight: number;
  windowWidth: number;
  windowHeight: number;
};
export type WindowResizeBounds = {
  displayWidth: number;
  displayHeight: number;
  maxWidth: number;
  maxHeight: number;
  minWidth: number;
  minHeight: number;
};
export type WindowGeometry = { position: WindowPosition | null; size: WindowSize | null };
export type WindowSession = { id: string; appId: InternalAppId; minimized: boolean };
export type WindowState = { windows: WindowSession[]; activeId: string | null; layouts: Partial<Record<InternalAppId, WindowGeometry>> };
export type OpenAppIcon = { window: WindowSession; active: boolean; minimized: boolean };
export type WindowAction =
  | { type: "open"; appId: InternalAppId }
  | { type: "activate"; id: string }
  | { type: "move"; id: string; mode: WindowMode; position: WindowPosition; bounds: WindowMoveBounds }
  | { type: "resize"; id: string; mode: WindowMode; position: WindowPosition; size: WindowSize; bounds: WindowResizeBounds }
  | { type: "resetPositions" }
  | { type: "minimize"; id: string }
  | { type: "close"; id: string };

export const initialWindowState: WindowState = { windows: [], activeId: null, layouts: {} };

/** Derives the tablet's open-app icons from the existing window manager state. */
export function selectOpenAppIcons(state: WindowState): OpenAppIcon[] {
  return state.windows.map((window) => ({
    window,
    active: window.id === state.activeId && !window.minimized,
    minimized: window.minimized,
  }));
}

export function clampWindowPosition(position: WindowPosition, bounds: WindowMoveBounds): WindowPosition {
  const maxX = Math.max(0, bounds.displayWidth - bounds.windowWidth);
  const maxY = Math.max(0, bounds.displayHeight - bounds.windowHeight);
  return {
    x: Math.min(maxX, Math.max(0, position.x)),
    y: Math.min(maxY, Math.max(0, position.y)),
  };
}

export function clampWindowSize(size: WindowSize, bounds: WindowResizeBounds): WindowSize {
  const maxWidth = Math.max(1, bounds.maxWidth);
  const maxHeight = Math.max(1, bounds.maxHeight);
  return {
    width: Math.min(maxWidth, Math.max(Math.min(bounds.minWidth, maxWidth), size.width)),
    height: Math.min(maxHeight, Math.max(Math.min(bounds.minHeight, maxHeight), size.height)),
  };
}

export function windowReducer(state: WindowState, action: WindowAction): WindowState {
  switch (action.type) {
    case "open": {
      const existing = state.windows.find((window) => window.appId === action.appId);
      if (existing) {
        return {
          ...state,
          windows: state.windows.map((window) =>
            window.id === existing.id ? { ...window, minimized: false } : window,
          ),
          activeId: existing.id,
        };
      }
      const id = `${action.appId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      return { ...state, windows: [...state.windows, { id, appId: action.appId, minimized: false }], activeId: id };
    }
    case "activate":
      return {
        ...state,
        windows: state.windows.map((window) =>
          window.id === action.id ? { ...window, minimized: false } : window,
        ),
        activeId: action.id,
      };
    case "move":
      if (action.mode !== "tablet") return state;
      {
        const app = state.windows.find((window) => window.id === action.id)?.appId;
        if (!app) return state;
        const previous = state.layouts[app] ?? { position: null, size: null };
        return {
          ...state,
          layouts: { ...state.layouts, [app]: { ...previous, position: clampWindowPosition(action.position, action.bounds) } },
        };
      }
    case "resize": {
      if (action.mode !== "tablet") return state;
      const app = state.windows.find((window) => window.id === action.id)?.appId;
      if (!app) return state;
      const size = clampWindowSize(action.size, action.bounds);
      const position = clampWindowPosition(action.position, {
        displayWidth: action.bounds.displayWidth,
        displayHeight: action.bounds.displayHeight,
        windowWidth: size.width,
        windowHeight: size.height,
      });
      return {
        ...state,
        layouts: { ...state.layouts, [app]: { position, size } },
      };
    }
    case "resetPositions":
      return {
        ...state,
        layouts: Object.fromEntries(Object.entries(state.layouts).map(([app, layout]) => [app, { ...layout, position: null }])) as WindowState["layouts"],
      };
    case "minimize": {
      const windows = state.windows.map((window) =>
        window.id === action.id ? { ...window, minimized: true } : window,
      );
      const activeId = state.activeId === action.id
        ? [...windows].reverse().find((window) => !window.minimized)?.id ?? null
        : state.activeId;
      return { ...state, windows, activeId };
    }
    case "close": {
      const windows = state.windows.filter((window) => window.id !== action.id);
      const activeId = state.activeId === action.id
        ? [...windows].reverse().find((window) => !window.minimized)?.id ?? null
        : state.activeId;
      return { ...state, windows, activeId };
    }
  }
}
