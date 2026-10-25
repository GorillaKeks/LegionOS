export type AppId = "settings" | "notes" | "demo" | "focus" | "snake" | "pong" | "spotify" | "roadwatch";
export type InternalAppId = Exclude<AppId, "spotify">;
export type AppIcon = "settings" | "note" | "spark" | "snake" | "pong" | "roadwatch";

export type AppDefinition = {
  name: string;
  subtitle: string;
  icon: AppIcon;
  color: "cyan" | "violet" | "orange";
};

export const appInfo: Record<AppId, AppDefinition> = {
  settings: { name: "Einstellungen", subtitle: "Dein LegionOS", icon: "settings", color: "cyan" },
  notes: { name: "Notizen", subtitle: "Gedanken festhalten", icon: "note", color: "violet" },
  demo: { name: "Demo", subtitle: "Ein kleiner Spielplatz", icon: "spark", color: "orange" },
  focus: { name: "Fokus", subtitle: "Kurze Fokus-Checkliste", icon: "spark", color: "cyan" },
  snake: { name: "Snake", subtitle: "Klassisches Snake im futuristischen Legion-Design", icon: "snake", color: "cyan" },
  pong: { name: "Pong", subtitle: "Der Arcade-Klassiker gegen die LegionOS-KI", icon: "pong", color: "cyan" },
  spotify: { name: "Spotify", subtitle: "Spotify Desktop in eigenem Fenster starten", icon: "spark", color: "cyan" },
  roadwatch: { name: "RoadWatch", subtitle: "Live VTC- und Spielerübersicht", icon: "roadwatch", color: "cyan" },
};

export function isAppId(value: string): value is AppId {
  return Object.prototype.hasOwnProperty.call(appInfo, value);
}
