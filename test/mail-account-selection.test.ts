import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FILL_MAX_EXTRA_PAGES,
  accountParamOf,
  fetchFilteredPage,
  messageAllowed,
  parseAccountFilter,
  selectedAccountKeys,
  singleAccountKey,
  toggleAccountKey,
} from "@/lib/mail/account-filter";
import { inferMailAccounts, type MailListPage, type MailSummary } from "@/lib/mail/contract";

const ALL = ["main", "sub", "formal"];

function msg(id: string): MailSummary {
  return { id, threadId: id, from: "a", subject: "s", snippet: "", receivedAt: null, labelIds: ["INBOX"], unread: false, starred: false };
}

function page(ids: string[], next: string | null): MailListPage {
  return { owner: "o", supportsLabels: true, partial: false, failedAccounts: [], accounts: null, labels: [], messages: ids.map(msg), nextPageToken: next, resultSizeEstimate: 0 };
}

describe("アカウント絞り込み（#829）", () => {
  it("?acct が無い・読めない値は既定（サブを除く）", () => {
    assert.deepEqual(parseAccountFilter(undefined), { kind: "default" });
    assert.deepEqual(parseAccountFilter("!!,,"), { kind: "default" });
    assert.deepEqual(selectedAccountKeys({ kind: "default" }, ALL), ["main", "formal"]);
  });

  it("サブしか無い構成では既定でも空にしない", () => {
    assert.deepEqual(selectedAccountKeys({ kind: "default" }, ["sub"]), ["sub"]);
  });

  it("カンマ区切りを読み、重複を除く", () => {
    assert.deepEqual(parseAccountFilter("main,formal,main"), { kind: "keys", keys: ["main", "formal"] });
    assert.equal(singleAccountKey(parseAccountFilter("sub")), "sub");
    assert.equal(singleAccountKey(parseAccountFilter("main,sub")), null);
  });

  it("行は既定ではサブを出さず、鍵の無い行は常に出す", () => {
    const d = { kind: "default" } as const;
    assert.equal(messageAllowed(d, msg("sub~1")), false);
    assert.equal(messageAllowed(d, msg("main~1")), true);
    assert.equal(messageAllowed(d, msg("plain")), true);
    assert.equal(messageAllowed(parseAccountFilter("sub,main"), msg("sub~1")), true);
    assert.equal(messageAllowed(parseAccountFilter("main"), msg("formal~1")), false);
  });

  it("チップの切り替え。最後の1つはオフにできない", () => {
    assert.deepEqual(toggleAccountKey(["main", "formal"], ALL, "sub"), ["main", "sub", "formal"]);
    assert.deepEqual(toggleAccountKey(["main", "formal"], ALL, "formal"), ["main"]);
    assert.deepEqual(toggleAccountKey(["main"], ALL, "main"), ["main"]);
  });

  it("既定と同じ選択はURLに載せない", () => {
    assert.equal(accountParamOf(["main", "formal"], ALL), null);
    assert.equal(accountParamOf(["formal", "main"], ALL), null);
    assert.equal(accountParamOf(["main", "sub", "formal"], ALL), "main,sub,formal");
    assert.equal(accountParamOf(["main"], ALL), "main");
  });

  it("絞った件数が足りない間は次のページを足す", async () => {
    const pages: Record<string, MailListPage> = {
      "": page(["sub~1", "sub~2", "main~1"], "p2"),
      p2: page(["sub~3", "formal~1"], null),
    };
    const calls: string[] = [];
    const result = await fetchFilteredPage(
      async (t) => {
        calls.push(t ?? "");
        return { ok: true as const, value: pages[t ?? ""]! };
      },
      { kind: "default" },
      null,
      inferMailAccounts,
    );
    assert.ok(result.ok);
    assert.deepEqual(calls, ["", "p2"]);
    assert.deepEqual(result.value.messages.map((m) => m.id), ["main~1", "formal~1"]);
    assert.equal(result.value.nextPageToken, null);
    // チップの元は絞る前の全行（サブも含む）
    assert.deepEqual(result.value.accounts?.map((a) => a.key).sort(), ["formal", "main", "sub"]);
  });

  it("追加取得は上限で止まり、0件でも次ページの鍵を返す", async () => {
    let n = 0;
    const result = await fetchFilteredPage(
      async () => {
        n += 1;
        return { ok: true as const, value: page(["sub~1"], `p${n}`) };
      },
      { kind: "default" },
      null,
      inferMailAccounts,
    );
    assert.ok(result.ok);
    assert.equal(n, 1 + FILL_MAX_EXTRA_PAGES);
    assert.equal(result.value.messages.length, 0);
    assert.equal(result.value.nextPageToken, `p${n}`);
  });

  it("追加取得が失敗しても、取れた分は出す", async () => {
    let n = 0;
    const result = await fetchFilteredPage(
      async () => {
        n += 1;
        return n === 1 ? { ok: true as const, value: page(["main~1"], "p2") } : { ok: false as const, kind: "failed", message: null };
      },
      { kind: "default" },
      null,
      inferMailAccounts,
    );
    assert.ok(result.ok);
    assert.deepEqual(result.value.messages.map((m) => m.id), ["main~1"]);
  });
});
