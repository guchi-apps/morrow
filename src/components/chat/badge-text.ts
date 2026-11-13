/** バッジに出す文字。100以上は「99+」、まだ続きがあるとき（`more`）は「N+」（#877）。 */
export function badgeText(count: number, more = false): string {
  if (count > 99) return "99+";
  return more ? `${count}+` : String(count);
}
