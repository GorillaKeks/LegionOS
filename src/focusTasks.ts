export function setFocusTaskChecked(checked: boolean[], taskIndex: number, value: boolean): boolean[] {
  if (taskIndex < 0 || taskIndex >= checked.length) return checked;
  return checked.map((previous, index) => index === taskIndex ? value : previous);
}
