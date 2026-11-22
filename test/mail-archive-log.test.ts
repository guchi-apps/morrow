import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ARCHIVE_LOG_DAYS, archiveCutoff, archiveDayLabel, groupArchiveByDay } from "../src/lib/mail/archive-log-core.ts";

// 日本時間 2026-11-23 15:00（= UTC 06:00）
const NOW = new Date("2026-11-23T06:00:00Z");
const jst = (iso: string) => new Date(`${iso}+09:00`).getTime();

describe("最近のアーカイブ（#1122）", () => {
  it("日付の見出しは今日・昨日・それ以前で分かれる", () => {
    assert.equal(archiveDayLabel(jst("2026-11-23T09:05:00"), NOW), "今日");
    assert.equal(archiveDayLabel(jst("2026-11-22T21:10:00"), NOW), "昨日（11月22日）");
    assert.equal(archiveDayLabel(jst("2026-11-20T10:00:00"), NOW), "11月20日");
  });

  it("新しい順に並べ、日本時間の同じ日でまとめる", () => {
    const groups = groupArchiveByDay(
      [
        { id: "a", archivedAt: jst("2026-11-22T21:10:00") },
        { id: "b", archivedAt: jst("2026-11-23T14:32:00") },
        { id: "c", archivedAt: jst("2026-11-23T09:05:00") },
        { id: "d", archivedAt: jst("2026-11-20T10:00:00") },
      ],
      NOW,
    );
    assert.deepEqual(
      groups.map((g) => [g.label, g.items.map((i) => i.id)]),
      [
        ["今日", ["b", "c"]],
        ["昨日（11月22日）", ["a"]],
        ["11月20日", ["d"]],
      ],
    );
  });

  it("日本時間の0時をまたぐ境目で日が分かれる", () => {
    const groups = groupArchiveByDay(
      [
        { id: "late", archivedAt: jst("2026-11-22T23:59:00") },
        { id: "early", archivedAt: jst("2026-11-23T00:01:00") },
      ],
      NOW,
    );
    assert.equal(groups.length, 2);
    assert.equal(groups[0].items[0].id, "early");
  });

  it("控えの期限は7日前", () => {
    assert.equal(NOW.getTime() - archiveCutoff(NOW).getTime(), ARCHIVE_LOG_DAYS * 24 * 60 * 60 * 1000);
  });

  it("空でも落ちない", () => {
    assert.deepEqual(groupArchiveByDay([], NOW), []);
  });
});
