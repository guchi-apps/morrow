import { parseCalendarChoices, type CalendarChoice } from "@/lib/mail/link-core";
import { callToolJson, connectedServerFor } from "@/lib/mcp/direct-call";

/**
 * 予定の保存先に選べるカレンダーの候補（#908）。**サーバー専用。** AIDEの読み取り道具 `aide_schedule` だけを呼ぶ（書き込みはしない）。
 * 結果は返すだけでDB・メモリに残さない（台帳の複製の正を作らない。#732）。
 */
export async function eventCalendarChoices(userId: string): Promise<{ ok: true; calendars: CalendarChoice[] } | { ok: false }> {
  try {
    const server = await connectedServerFor(userId, "aide");
    if (!server) return { ok: false };
    return { ok: true, calendars: parseCalendarChoices(await callToolJson(server, "aide_schedule", { offsetDays: -7, days: 14 })) };
  } catch (error) {
    console.error("[aide-bot] 保存先カレンダーの候補を取得できなかった", error instanceof Error ? error.message : error);
    return { ok: false };
  }
}
