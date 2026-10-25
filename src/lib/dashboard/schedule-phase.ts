/**
 * 予定カードの行を「これから／終わった予定／記録」に分ける（#626）。
 *
 * 記録（実績）はAIDEが `calendarName: "活動記録"` で返す（DaySpanの活動記録。睡眠・風呂など）。
 * 専用の項目は無いので名前で見る——変わっても薄くならないだけで、表示は壊れない。
 * 「終わった」は今日だけ現在時刻（日本時間の `HH:MM`）との比較、前の日は全部、後の日は無し。
 * 予定（`event`）と移動（`travel`）だけが対象で、タスク・リマインドは終わったかを持てないので分けない。
 * DBにもネットワークにも触れない純粋なモジュール（`test/schedule-phase.test.ts`）。
 */

export const RECORD_CALENDAR_NAME = "活動記録";

export type SchedulePhase = "upcoming" | "done" | "record";

type PhaseInput = {
  kind: "event" | "travel" | "reminder" | "task";
  start: string | null;
  end: string | null;
  record: boolean;
};

/** `nowTime` は日本時間の `HH:MM`（`jstTimeLabel()`）。`offset` は今日からの日数のずれ。 */
export function schedulePhase(
  item: PhaseInput,
  nowTime: string,
  offset: number,
): SchedulePhase {
  if (item.record) return "record";
  if (item.kind !== "event" && item.kind !== "travel") return "upcoming";
  if (item.start === null) return "upcoming";
  if (offset < 0) return "done";
  if (offset > 0) return "upcoming";
  return (item.end ?? item.start) < nowTime ? "done" : "upcoming";
}
