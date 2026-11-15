/**
 * メールのAI検索（#998）の関連度と並べ替えの順。画面（`mail-search.tsx`）とサーバーで共有する。
 * **プロンプトを持ち込まないよう `search-core.ts` から分けてある**（クライアントのバンドルに入るため）。
 */

/** 関連度。3＝とても近い、2＝近い、1＝関連は薄い、0＝関係ない。 */
export type SearchLevel = 0 | 1 | 2 | 3;
export type SearchRank = { level: SearchLevel; reason: string };

export const SEARCH_LEVEL_LABELS: Record<SearchLevel, string> = {
  3: "とても近い",
  2: "近い",
  1: "関連は薄い",
  0: "関係なさそう",
};

/** 並べ替えの後、この関連度以上を上に出す（未満は畳む）。 */
export const SEARCH_LEVEL_SHOWN = 2;

/**
 * 並べ替えの順。関連度の高い順で、同じ関連度は見つかった順（キーワード一致が先）。
 * 関連度が付かなかった候補（並べ替えに渡さなかった・答えが欠けた）は「関連は薄い」と同じ扱い。
 */
export function orderByRank<T extends { id: string }>(
  items: readonly T[],
  ranks: ReadonlyMap<string, SearchRank>,
): { shown: { item: T; level: SearchLevel }[]; folded: { item: T; level: SearchLevel }[] } {
  const sorted = items
    .map((item, index) => ({ item, index, level: ranks.get(item.id)?.level ?? (1 as SearchLevel) }))
    .sort((a, b) => b.level - a.level || a.index - b.index)
    .map(({ item, level }) => ({ item, level }));
  return {
    shown: sorted.filter((entry) => entry.level >= SEARCH_LEVEL_SHOWN),
    folded: sorted.filter((entry) => entry.level < SEARCH_LEVEL_SHOWN),
  };
}
