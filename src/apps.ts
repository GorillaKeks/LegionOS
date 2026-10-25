export type AppId = "settings" | "notes" | "demo" | "focus" | "snake" | "pong" | "space-invaders" | "roadwatch" | "radio";
export type InternalAppId = AppId;
export type AppIcon = "settings" | "note" | "spark" | "snake" | "pong" | "invaders" | "roadwatch" | "radio";

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
  "space-invaders": { name: "Space Invaders", subtitle: "Verteidige die Galaxie im Retro-Arcade-Stil", icon: "invaders", color: "cyan" },
  roadwatch: { name: "RoadWatch", subtitle: "Live VTC- und Spielerübersicht", icon: "roadwatch", color: "cyan" },
  radio: { name: "Radio", subtitle: "Internetradiosender entdecken und hören", icon: "radio", color: "cyan" },
};

export function isAppId(value: string): value is AppId {
  return Object.prototype.hasOwnProperty.call(appInfo, value);
}
