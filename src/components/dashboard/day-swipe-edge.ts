/**
 * 横にスクロールできる枠（1時間ごとの帯など）の上で始めた操作を、日めくりへ引き継ぐ判定（#620）。純粋関数。
 *
 * 枠がまだ動く間はブラウザのスクロールに任せ、枠が端に着いたあとにさらに同じ向きへ引いたぶんだけを
 * 日めくりの移動量にする。指を戻して端から離れたら移動量は0に戻る（戻して離せば移らない）。
 */

export type ScrollEdge = "start" | "end" | null;

/** 枠が左端（`start`）・右端（`end`）にいるか。端に無ければnull。小数のずれを見込んで1px許す。 */
export function scrollEdge(scrollLeft: number, clientWidth: number, scrollWidth: number): ScrollEdge {
  if (scrollWidth <= clientWidth) return null;
  if (scrollLeft <= 1) return "start";
  if (scrollLeft + clientWidth >= scrollWidth - 1) return "end";
  return null;
}

/**
 * 端でのさらなる引きの量。`origin` は「端に着いた（引き始めた）ときの指のx」で、端から離れている間はnull。
 * 左端では右へ（前の日）、右端では左へ（次の日）引いたぶんだけを数え、逆向きは枠の中へ戻るスクロールなので0。
 */
export function pullFromEdge(edge: ScrollEdge, x: number, origin: number | null): { dx: number; origin: number | null } {
  if (edge === null) return { dx: 0, origin: null };
  if (origin === null) return { dx: 0, origin: x };
  const dx = x - origin;
  const pulling = edge === "start" ? dx > 0 : dx < 0;
  return pulling ? { dx, origin } : { dx: 0, origin: x };
}
