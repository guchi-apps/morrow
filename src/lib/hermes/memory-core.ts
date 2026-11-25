/**
 * Hermesの記憶の確認・承認（#1155）で、ブリッジ（素のNode）とMorrowの両方が使う純粋な部分。
 * **Prismaにも `@/` にも触れない。** スキル版は `skill-core.ts`（#1154）。設計は `docs/hermes-route.md`「記憶の確認・承認」。
 *
 * 保留（`<HERMES_HOME>/pending/memory/<id>.json`）の `payload` は、Hermesの `memory` 道具の呼び出しそのもの:
 * 単発 `{action, target, content, old_text, matched_entry}` か、`{action: "batch", target, operations: [...]}`。
 * 記憶の実体は `<HERMES_HOME>/memories/{MEMORY,USER}.md` で、項目は `\n§\n` で区切られる（2026-11-24に実走して確認。
 * 末尾の改行は無い）。Hermesはセッションの開始時に記憶を読み込んで固定するので、承認・削除は**新しい会話から**効く。
 */

import { PENDING_ID_PATTERN, detectSensitive, type SensitiveHit } from "./skill-core.ts";

export { PENDING_ID_PATTERN, detectSensitive, type SensitiveHit };

/** 記憶ファイルの項目の区切り（Hermesの `ENTRY_DELIMITER`）。 */
export const MEMORY_ENTRY_DELIMITER = "\n§\n";

/** 記憶の置き場。`user`＝利用者についての事実（USER.md）、`memory`＝Hermes自身のメモ（MEMORY.md）。 */
export type MemoryTarget = "user" | "memory";

export const MEMORY_TARGETS: readonly MemoryTarget[] = ["user", "memory"];

/** Hermesの既定の上限（`memory_char_limit` / `user_char_limit`）。 */
export const MEMORY_CHAR_LIMITS: Record<MemoryTarget, number> = { memory: 2200, user: 1375 };

/** 1項目の長さの上限（Morrowの確認基準。上限の合計より小さくして、1件で占有されないようにする）。 */
export const MEMORY_ENTRY_MAX = 300;
/** 1回の保留が持てる操作の上限。 */
export const MEMORY_OPS_MAX = 10;
/** 保留の有効期間。過ぎたものはブリッジが消す。 */
export const MEMORY_PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const MEMORY_TARGET_LABELS: Record<MemoryTarget, string> = {
  user: "あなたについての記憶",
  memory: "Hermesのメモ",
};

export type MemoryAction = "add" | "patch" | "remove" | "replace";

const ACTIONS: readonly string[] = ["add", "patch", "remove", "replace"];

export const MEMORY_ACTION_LABELS: Record<MemoryAction, string> = {
  add: "追加",
  patch: "一部の書き換え",
  remove: "削除",
  replace: "書き換え",
};

/** 保留の中の1操作。本文は画面に出すために持つ（確定したらMorrowは保存しない）。 */
export interface MemoryOp {
  action: MemoryAction;
  target: MemoryTarget;
  /** `add` は追加する文、`patch`・`replace` は新しい文。 */
  content?: string;
  /** `patch`・`remove`・`replace` の対象を選ぶ語（項目の一部）。 */
  oldText?: string;
  /** Hermesが保留に固定した、対象の項目の全文（削除・書き換えの前の姿）。 */
  matchedEntry?: string;
}

export interface PendingMemory {
  id: string;
  /** `foreground`＝利用者との会話の中で作った／`background_review`＝自動の見直しが作った。 */
  origin: "foreground" | "background_review";
  /** 保留ができた時刻（epochミリ秒）。分からなければ null。 */
  createdAt: number | null;
  /** Hermesが付けた1行の要約。 */
  summary: string;
  ops: MemoryOp[];
}

/** 保存済みの記憶の1項目（`memories/*.md` の1区切り）。 */
export interface MemoryEntry {
  target: MemoryTarget;
  /** 項目の全文。削除はこの全文が一致したものだけを消す。 */
  text: string;
}

export interface PendingMemoriesBody {
  pending: PendingMemory[];
}

export interface MemoryEntriesBody {
  entries: MemoryEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optString(value: unknown, max: number): string | undefined {
  return typeof value === "string" ? value.slice(0, max) : undefined;
}

function isTarget(value: unknown): value is MemoryTarget {
  return value === "user" || value === "memory";
}

/** 保留1件の `payload` から操作の並びを取り出す（単発は1件、`batch` は `operations[]`）。読めない操作は落とす。 */
export function memoryOpsFromPayload(payload: unknown): MemoryOp[] {
  if (!isRecord(payload)) return [];
  const target = isTarget(payload.target) ? payload.target : "memory";
  const raw = payload.action === "batch" && Array.isArray(payload.operations) ? payload.operations : [payload];
  const ops: MemoryOp[] = [];
  for (const item of raw.slice(0, MEMORY_OPS_MAX)) {
    if (!isRecord(item)) continue;
    const action = item.action;
    if (typeof action !== "string" || !ACTIONS.includes(action)) continue;
    // 新しい文は `content`（`patch` では古い版の `new_text` のこともある）
    const content = optString(item.content ?? item.new_text, MEMORY_ENTRY_MAX * 4);
    const oldText = optString(item.old_text, MEMORY_ENTRY_MAX * 4);
    const matchedEntry = optString(item.matched_entry, MEMORY_ENTRY_MAX * 4);
    ops.push({
      action: action as MemoryAction,
      target: isTarget(item.target) ? item.target : target,
      ...(content !== undefined ? { content } : {}),
      ...(oldText !== undefined ? { oldText } : {}),
      ...(matchedEntry !== undefined ? { matchedEntry } : {}),
    });
  }
  return ops;
}

export interface MemoryIssue {
  /** `error` は承認を断る。`warning` は画面で見せるだけ。 */
  level: "error" | "warning";
  message: string;
}

/** 承認前の検証（形式・長さ）。Morrowのサーバーが承認のたびにもう一度行う。 */
export function validatePendingMemory(memory: Pick<PendingMemory, "ops">): MemoryIssue[] {
  const issues: MemoryIssue[] = [];
  if (memory.ops.length === 0) {
    issues.push({ level: "error", message: "内容を読み取れませんでした。却下してください。" });
    return issues;
  }
  for (const op of memory.ops) {
    if (op.action === "add" || op.action === "patch" || op.action === "replace") {
      const content = (op.content ?? "").trim();
      if (content === "") {
        issues.push({ level: "error", message: `「${MEMORY_ACTION_LABELS[op.action]}」の内容が空です。` });
        continue;
      }
      if ([...content].length > MEMORY_ENTRY_MAX) {
        issues.push({ level: "error", message: `1項目が${[...content].length}字あります（${MEMORY_ENTRY_MAX}字以内）。短く言い直してもらってください。` });
      }
      if (content.includes("§")) {
        issues.push({ level: "error", message: "本文に項目の区切り記号（§）が含まれています。" });
      }
    }
    if (op.action !== "add" && (op.oldText ?? "").trim() === "" && (op.matchedEntry ?? "").trim() === "") {
      issues.push({ level: "error", message: "変更する対象の項目を特定できません。" });
    }
    if (op.action === "remove") issues.push({ level: "warning", message: "保存済みの記憶を削除する操作です。" });
    if (op.action !== "add" && op.matchedEntry === undefined) {
      issues.push({ level: "warning", message: "対象の項目が固定されていない保留です。Hermesが適用できないことがあります。" });
    }
  }
  return issues;
}

export function hasBlockingMemoryIssue(issues: readonly MemoryIssue[]): boolean {
  return issues.some((issue) => issue.level === "error");
}

/** 保留1件の、人が確認すべき本文（個人情報の検出に使う）。 */
export function memoryReviewText(memory: Pick<PendingMemory, "ops">): string {
  return memory.ops.map((op) => op.content ?? "").filter((text) => text !== "").join("\n");
}

/** 承認待ちの1件の見出し（画面・通知）。 */
export function memoryTitle(memory: Pick<PendingMemory, "ops">): string {
  const first = memory.ops[0];
  if (!first) return "記憶";
  const more = memory.ops.length > 1 ? ` ほか${memory.ops.length - 1}件` : "";
  return `${MEMORY_TARGET_LABELS[first.target]}を${MEMORY_ACTION_LABELS[first.action]}${more}`;
}

/** `memories/*.md` の中身を項目へ分ける（Hermesの `_parse_entries` と同じ。空の項目は捨て、前後の空白は取る）。 */
export function parseMemoryFile(text: string): string[] {
  return text
    .replace(/^﻿/, "")
    .split("§")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/**
 * 項目の並びを `\n§\n` で繋いだファイルの中身にする。
 * 末尾の改行は付けない（Hermesの書式に合わせる。付けると次回の読み込みで空白だけの差になるだけだが、揃えておく）。
 */
export function serializeMemoryFile(entries: readonly string[]): string {
  return entries.join(MEMORY_ENTRY_DELIMITER);
}

/**
 * 項目の並びから、全文が一致した最初の1項目を外す。見つからなければ null（別の項目を巻き込まない）。
 * `parseMemoryFile` と同じく前後の空白は無視して比べる。
 */
export function removeEntryByText(entries: readonly string[], text: string): string[] | null {
  const wanted = text.trim();
  if (wanted === "") return null;
  const index = entries.findIndex((entry) => entry.trim() === wanted);
  if (index < 0) return null;
  return [...entries.slice(0, index), ...entries.slice(index + 1)];
}

function isOrigin(value: unknown): value is PendingMemory["origin"] {
  return value === "foreground" || value === "background_review";
}

/** `MemoryOp`（camelCase）を `memoryOpsFromPayload` が読む形（Hermesの保留と同じ snake_case）へ戻す。 */
function snakeOp(op: unknown): unknown {
  if (!isRecord(op)) return op;
  return { action: op.action, target: op.target, content: op.content, old_text: op.oldText, matched_entry: op.matchedEntry };
}

/** ブリッジの応答（保留の一覧）の形を確かめる。1件でも違えば null。 */
export function parsePendingMemoriesBody(body: unknown): PendingMemoriesBody | null {
  if (!isRecord(body) || !Array.isArray(body.pending)) return null;
  const pending: PendingMemory[] = [];
  for (const item of body.pending) {
    if (!isRecord(item)) return null;
    if (typeof item.id !== "string" || !PENDING_ID_PATTERN.test(item.id)) return null;
    if (!isOrigin(item.origin)) return null;
    if (item.createdAt !== null && (typeof item.createdAt !== "number" || !Number.isFinite(item.createdAt))) return null;
    if (typeof item.summary !== "string") return null;
    if (!Array.isArray(item.ops)) return null;
    const ops = memoryOpsFromPayload({ action: "batch", operations: item.ops.map(snakeOp) });
    pending.push({ id: item.id, origin: item.origin, createdAt: item.createdAt, summary: item.summary.slice(0, 500), ops });
  }
  return { pending };
}

export function parseMemoryEntriesBody(body: unknown): MemoryEntriesBody | null {
  if (!isRecord(body) || !Array.isArray(body.entries)) return null;
  const entries: MemoryEntry[] = [];
  for (const item of body.entries) {
    if (!isRecord(item)) return null;
    if (!isTarget(item.target)) return null;
    if (typeof item.text !== "string" || item.text.trim() === "") return null;
    entries.push({ target: item.target, text: item.text.slice(0, MEMORY_ENTRY_MAX * 4) });
  }
  return { entries };
}
