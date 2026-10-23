import { useState } from "react";
import { setFocusTaskChecked } from "./focusTasks";

const initialTasks = ["Ablenkungen schließen", "Ein Ziel festlegen", "25 Minuten konzentrieren"];

export default function FocusApp({ onActivate }: { onActivate: () => void }) {
  const [checked, setChecked] = useState<boolean[]>(() => initialTasks.map(() => false));
  return <div className="focus-view" onPointerDownCapture={(event) => { event.stopPropagation(); onActivate(); }}>
    <div className="window-section-heading"><span className="section-kicker">LOKALE BEISPIEL-APP</span><h2>Ein klarer Kopf. <span>Ein Schritt nach dem anderen.</span></h2><p>Eine kleine Checkliste als registrierter Phone-App-Einstieg.</p></div>
    <div className="focus-checklist">{initialTasks.map((task, index) => <label className={`focus-task${checked[index] ? " focus-task-done" : ""}`} key={task}><input type="checkbox" checked={checked[index]} onChange={(event) => { const isChecked = event.currentTarget.checked; setChecked((previous) => setFocusTaskChecked(previous, index, isChecked)); }}/><span>{task}</span></label>)}</div>
    <p className="ephemeral-note"><span className="note-dot"/> Diese Beispiel-Checkliste wird nicht gespeichert.</p>
  </div>;
}
