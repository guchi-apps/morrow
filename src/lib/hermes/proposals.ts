import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { callHermesWriteToolJson, connectedServerFor, McpCallError, previewDeleteEvent } from "@/lib/mcp/direct-call";

import {
  applyEdits,
  buildToolArgs,
  hermesNote,
  idempotencyKeyFor,
  parseDeletePreview,
  parseProposalEvent,
  PROPOSAL_TTL_MS,
  proposalView,
  readHermesOutcome,
  readProposalArgs,
  RETENTION_DAYS,
  RETRY_SAFE,
  STALE_EXECUTING_MS,
  UNKNOWN_KEEP_MS,
  type ProposalArgs,
  type ProposalView,
  type ToolOutcome,
} from "@/lib/hermes/proposal-core";

/**
 * Hermesの提案の保存と実行（#748）。**サーバー専用。** 純粋な部分は `proposal-core.ts`。
 *
 * - `ingestStreamToolStart()`: ストリームの `tool.start` から提案を読み、承認待ちの行を作る（#737のブリッジ・#728のチャットが呼ぶ）
 * - `executeProposal()`: 承認時にもう一度検証し、`pending → executing` を `updateMany` の件数で1回だけ進めた側が実行する
 * - 引数（値）は承認待ち・実行中・結果不明の間だけ持つ。成功・取り下げ・期限切れ・確定した失敗で消す
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** 画面に出す履歴の範囲。 */
const LIST_WINDOW_MS = DAY_MS;

function toJson(args: ProposalArgs): Prisma.InputJsonValue {
  return args as unknown as Prisma.InputJsonValue;
}

// ---- 取り込み ----

/** ストリームの道具呼び出しから提案を作る。提案でない・表に無い道具・同じ呼び出しの再取り込みは null。 */
export async function ingestStreamToolStart(input: {
  userId: string;
  sessionId: string;
  callId: string;
  name: unknown;
  args: unknown;
  now?: Date;
}): Promise<ProposalView | null> {
  const parsed = parseProposalEvent(input.name, input.args);
  if (!parsed) return null;
  const now = input.now ?? new Date();
  const args = parsed.args;

  // 予定の削除は、Morrowが先に dryRun で「消える予定の実物」を引いてカードに出す。取れなければ実行させない。
  if (parsed.tool === "aide_delete_event" && parsed.missing.length === 0) {
    try {
      const server = await connectedServerFor(input.userId, "aide");
      if (!server) throw new Error("AIDE未接続");
      args.preview = parseDeletePreview(
        await previewDeleteEvent(server, {
          eventId: String(args.values.eventId),
          calendarId: String(args.values.calendarId),
          title: String(args.values.title),
        }),
      );
    } catch (error) {
      console.error("[aide-bot] 予定削除の確認（dryRun）に失敗した", error instanceof Error ? error.message : error);
    }
    args.previewFailed = args.preview === null;
  }

  try {
    const row = await db.hermesProposal.create({
      data: {
        userId: input.userId,
        sessionId: input.sessionId.slice(0, 128),
        callId: input.callId.slice(0, 128),
        tool: parsed.tool,
        status: "pending",
        expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS),
        idempotencyKey: "pending",
        args: toJson(args),
      },
    });
    const updated = await db.hermesProposal.update({ where: { id: row.id }, data: { idempotencyKey: idempotencyKeyFor(row.id) } });
    return proposalView(updated);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null; // 同じ呼び出しは一度だけ
    throw error;
  }
}

// ---- 一覧 ----

export async function listProposals(userId: string, now = new Date()): Promise<ProposalView[]> {
  await sweepProposals(now);
  const rows = await db.hermesProposal.findMany({
    where: { userId, createdAt: { gt: new Date(now.getTime() - LIST_WINDOW_MS) } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return rows.map((row) => proposalView(row)).filter((view): view is ProposalView => view !== null);
}

// ---- 実行 ----

export type ExecuteResult =
  | { ok: true; view: ProposalView }
  | { ok: false; status: number; message: string; view?: ProposalView };

export async function executeProposal(userId: string, id: string, edits: unknown, now = new Date()): Promise<ExecuteResult> {
  let row = await db.hermesProposal.findFirst({ where: { id, userId } });
  if (!row) return { ok: false, status: 404, message: "提案が見つかりません。" };

  if (row.status === "pending" && row.expiresAt <= now) {
    await sweepProposals(now);
    return { ok: false, status: 410, message: "期限（1時間）が過ぎたため実行できません。同じことをするなら頼み直してください。" };
  }

  const tool = proposalView(row)?.tool;
  const stored = readProposalArgs(row.args);
  if (!tool || !stored) return { ok: false, status: 409, message: "この提案は実行できません。" };
  const retrying = row.status === "unknown";
  if (row.status !== "pending" && !(retrying && RETRY_SAFE[tool])) {
    return { ok: false, status: 409, message: "この提案はすでに処理されています。" };
  }

  // 承認時にもう一度検証する（カードで直した値も、サーバーで検証し直す）
  const values = retrying ? stored.values : applyEdits(tool, stored.values, edits);
  const built = buildToolArgs(tool, values);
  if (!built.ok) return { ok: false, status: 400, message: built.reason };
  if (tool === "aide_delete_event" && !stored.preview) {
    return { ok: false, status: 409, message: "消える予定を確認できていないため実行できません。頼み直してください。" };
  }

  const server = await connectedServerFor(userId, "aide");
  if (!server) return { ok: false, status: 503, message: "AIDEが接続されていません。設定の接続から繋いでください。" };

  // pending → executing（unknown → executing）を1回だけ進めた側が実行する
  const claimed = await db.hermesProposal.updateMany({
    where: {
      id,
      userId,
      status: row.status,
      ...(row.status === "pending" ? { expiresAt: { gt: now } } : {}),
    },
    data: { status: "executing", args: toJson({ ...stored, values: built.args as ProposalArgs["values"] }) },
  });
  if (claimed.count !== 1) return { ok: false, status: 409, message: "この提案はすでに処理されています。" };

  let outcome: ToolOutcome | null = null;
  let reason: string | null = null;
  const attempts = RETRY_SAFE[tool] ? 2 : 1;
  for (let attempt = 0; attempt < attempts && outcome === null; attempt += 1) {
    try {
      outcome = readHermesOutcome(tool, await callHermesWriteToolJson(server, tool, built.args));
    } catch (error) {
      console.error(`[aide-bot] Hermesの提案（${tool}）の実行に失敗した`, error instanceof Error ? error.message : error);
      if (error instanceof McpCallError && error.reason !== null) {
        // 道具が理由つきで断った＝実行されていない（確定した失敗）
        outcome = { kind: "failed", code: "error", targetId: null, reason: error.reason };
      }
      // それ以外（通信・タイムアウト・結果が読めない）は結果不明。同じ入力で再試行してよい道具だけもう一度呼ぶ
    }
  }
  if (outcome?.kind === "failed") reason = outcome.reason;

  if (outcome === null) {
    // 結果不明。引数は持ったまま、利用者に確かめさせる（または安全な道具だけ「もう一度実行」）
    await db.hermesProposal.updateMany({ where: { id, userId, status: "executing" }, data: { status: "unknown", outcome: "unknown" } });
  } else {
    await db.hermesProposal.updateMany({
      where: { id, userId, status: "executing" },
      data: {
        status: outcome.kind === "failed" ? "failed" : "done",
        outcome: outcome.code,
        targetId: outcome.targetId,
        args: Prisma.DbNull,
      },
    });
  }

  row = await db.hermesProposal.findFirst({ where: { id, userId } });
  const view = row ? proposalView(row) : null;
  if (!view) return { ok: false, status: 500, message: "結果を読めませんでした。" };
  return { ok: true, view: { ...view, reason } };
}

// ---- 取り下げ ----

export async function cancelProposal(userId: string, id: string): Promise<ExecuteResult> {
  const result = await db.hermesProposal.updateMany({
    where: { id, userId, status: { in: ["pending", "unknown"] } },
    data: { status: "cancelled", args: Prisma.DbNull },
  });
  const row = await db.hermesProposal.findFirst({ where: { id, userId } });
  if (!row) return { ok: false, status: 404, message: "提案が見つかりません。" };
  const view = proposalView(row);
  if (result.count !== 1) return { ok: false, status: 409, message: "この提案はすでに処理されています。", ...(view ? { view } : {}) };
  return view ? { ok: true, view } : { ok: false, status: 500, message: "結果を読めませんでした。" };
}

// ---- 期限切れ・結果不明・古い記録の掃除 ----

/**
 * 期限切れ（承認待ち1時間）・実行中のまま止まった行（→結果不明。引数は残す）・結果不明の長期放置（→期限切れ。引数を消す）を進め、
 * 90日を過ぎた記録を消す。画面の一覧と `/api/briefing` の `after()` から呼ぶ。
 */
export async function sweepProposals(now = new Date()): Promise<{ expired: number; stale: number; purged: number }> {
  const expired = await db.hermesProposal.updateMany({
    where: { status: "pending", expiresAt: { lte: now } },
    data: { status: "expired", args: Prisma.DbNull },
  });
  const stale = await db.hermesProposal.updateMany({
    where: { status: "executing", updatedAt: { lt: new Date(now.getTime() - STALE_EXECUTING_MS) } },
    data: { status: "unknown", outcome: "unknown" },
  });
  await db.hermesProposal.updateMany({
    where: { status: "unknown", updatedAt: { lt: new Date(now.getTime() - UNKNOWN_KEEP_MS) } },
    data: { status: "expired", outcome: "unknown_expired", args: Prisma.DbNull },
  });
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
  const proposals = await db.hermesProposal.deleteMany({
    where: { createdAt: { lt: cutoff }, status: { in: ["done", "cancelled", "expired", "failed"] } },
  });
  const logs = await db.hermesActionLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return { expired: expired.count, stale: stale.count, purged: proposals.count + logs.count };
}

// ---- Hermesへの伝言 ----

/** 次の発言の先頭に付ける、実行・取り下げの結果。送れたら `markNotesReported()` で伝達済みにする。 */
export async function pendingHermesNotes(userId: string, sessionId: string): Promise<{ text: string; ids: string[] }> {
  const rows = await db.hermesProposal.findMany({
    where: { userId, sessionId: sessionId.slice(0, 128), reportedAt: null, status: { in: ["done", "cancelled", "failed", "expired"] } },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  return { text: hermesNote(rows), ids: rows.map((row) => row.id) };
}

export async function markNotesReported(userId: string, ids: string[], now = new Date()): Promise<void> {
  if (ids.length === 0) return;
  await db.hermesProposal.updateMany({ where: { userId, id: { in: ids }, reportedAt: null }, data: { reportedAt: now } });
}

// ---- 自動の書き込みの記録 ----

/**
 * Hermesが自動で行った書き込み（取り消せるもの）の記録。ストリームの `tool.complete` から**道具名と成否だけ**を残す
 * （引数・結果の本文は残さない）。失敗しても本筋は止めない。
 */
export async function recordAutoAction(input: { userId: string; sessionId: string; tool: string; ok: boolean }): Promise<void> {
  try {
    await db.hermesActionLog.create({
      data: { userId: input.userId, sessionId: input.sessionId.slice(0, 128), tool: input.tool.slice(0, 64), ok: input.ok },
    });
  } catch (error) {
    console.error("[aide-bot] Hermesの自動実行の記録に失敗した", error instanceof Error ? error.message : error);
  }
}
