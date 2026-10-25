import { useState } from "react";
import { setFocusTaskChecked } from "./focusTasks";
import { t, type Language } from "./i18n";

const taskKeys = ["focus.task1", "focus.task2", "focus.task3"] as const;

export default function FocusApp({ onActivate, language }: { onActivate: () => void; language: Language }) {
  const [checked, setChecked] = useState<boolean[]>(() => taskKeys.map(() => false));
  return <div className="focus-view" onPointerDownCapture={(event) => { event.stopPropagation(); onActivate(); }}>
    <div className="window-section-heading"><span className="section-kicker">{t(language, "focus.kicker")}</span><h2>{t(language, "focus.title")} <span>{t(language, "focus.titleAccent")}</span></h2><p>{t(language, "focus.subtitle")}</p></div>
    <div className="focus-checklist">{taskKeys.map((key, index) => <label className={`focus-task${checked[index] ? " focus-task-done" : ""}`} key={key}><input type="checkbox" checked={checked[index]} onChange={(event) => { const isChecked = event.currentTarget.checked; setChecked((previous) => setFocusTaskChecked(previous, index, isChecked)); }}/><span>{t(language, key)}</span></label>)}</div>
    <p className="ephemeral-note"><span className="note-dot"/> {t(language, "focus.notSaved")}</p>
  </div>;
}
