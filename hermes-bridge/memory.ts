import { randomUUID } from "node:crypto";
import { readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  MEMORY_PENDING_TTL_MS,
  PENDING_ID_PATTERN,
  memoryOpsFromPayload,
  parseMemoryFile,
  removeEntryByText,
  serializeMemoryFile,
  type MemoryEntry,
  type MemoryTarget,
  type PendingMemory,
} from "../src/lib/hermes/memory-core.ts";
import type { HermesLink } from "./hermes-link.ts";
import { dispatchWriteApproval } from "./skills.ts";

/**
 * Hermesの記憶の確認・承認（#1155。スキル版は `skills.ts`＝#1154）。
 *
 * - 保留（`memory.write_approval: true` のとき `memory` 道具が `<HERMES_HOME>/pending/memory/<id>.json` に残す）は**ファイルを直接読む**
 * - 承認・却下は Hermes の `command.dispatch`（`name: "memory"`）へ渡す。**`arg` は `pending`・`approve <id>`・`reject <id>` だけ**
 * - 保存済みの記憶は `<HERMES_HOME>/memories/{MEMORY,USER}.md`（項目は `\n§\n` 区切り）を読む。
 *   **削除はこのファイルを直接書き換える**（Hermesの削除は保留→承認を通るため、利用者が画面で押した削除には使えない）。
 *   Hermesの書き込みは `<file>.lock` のflockで直列化されるが、Nodeには標準のflockが無い。読み直し→一時ファイルへ書く→rename の間隔を
 *   最小にして、全文が一致した1項目だけを外す（競合してもHermesの書き込みを壊さない側＝一致しなければ何もしない側へ倒す）
 */

export class MemoryNotFoundError extends Error {}
export class MemoryRejectedError extends Error {}
/** 削除の途中でHermesが同じファイルを書き換え続け、読み直しても確定できなかった（#1181）。 */
export class MemoryConflictError extends Error {}

const REMOVE_RETRY_LIMIT = 5;

export interface MemoryStore {
  listPending(): Promise<PendingMemory[]>;
  approve(id: string): Promise<void>;
  discard(id: string): Promise<void>;
  listEntries(): Promise<MemoryEntry[]>;
  removeEntry(target: MemoryTarget, text: string): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 保留1件の記録（`pending/memory/<id>.json`）を画面へ出す形に絞る。読めない・形が違えば null。 */
export function projectPendingMemory(record: unknown): PendingMemory | null {
  if (!isRecord(record)) return null;
  if (typeof record.id !== "string" || !PENDING_ID_PATTERN.test(record.id)) return null;
  const created = typeof record.created_at === "number" && Number.isFinite(record.created_at) ? Math.round(record.created_at * 1000) : null;
  return {
    id: record.id,
    origin: record.origin === "background_review" ? "background_review" : "foreground",
    createdAt: created,
    summary: typeof record.summary === "string" ? record.summary.slice(0, 500) : "",
    ops: memoryOpsFromPayload(record.payload),
  };
}

export interface MemoryStoreOptions {
  /** profileのディレクトリ（`~/.hermes/profiles/morrow`）。 */
  hermesHome: string;
  /** Hermesへ繋ぐ。 */
  connect: () => Promise<HermesLink>;
  now?: () => number;
  /** テスト専用: 削除が読んだ後・rename前に呼ばれる（Hermesの同時書き込みを再現する）。 */
  beforeRemoveCommit?: () => Promise<void>;
}

const FILE_OF: Record<MemoryTarget, string> = { user: "USER.md", memory: "MEMORY.md" };

async function readJsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse((await readFile(path, "utf8")).replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

export function createMemoryStore(options: MemoryStoreOptions): MemoryStore {
  const home = resolve(options.hermesHome);
  const pendingDir = join(home, "pending", "memory");
  const memoriesDir = join(home, "memories");
  const now = options.now ?? Date.now;

  async function pendingFiles(): Promise<string[]> {
    try {
      return (await readdir(pendingDir)).filter((file) => /^[0-9a-f]{8}\.json$/.test(file));
    } catch {
      return []; // 保留が一度もできていない
    }
  }

  async function ensureExists(id: string): Promise<void> {
    if (!PENDING_ID_PATTERN.test(id)) throw new MemoryNotFoundError("保留のidの形が正しくない");
    if (!(await pendingFiles()).includes(`${id}.json`)) throw new MemoryNotFoundError("保留が見つからない");
  }

  async function readRaw(file: string): Promise<string | null> {
    try {
      return await readFile(file, "utf8");
    } catch {
      return null;
    }
  }

  async function readEntries(target: MemoryTarget): Promise<string[]> {
    try {
      return parseMemoryFile(await readFile(join(memoriesDir, FILE_OF[target]), "utf8"));
    } catch {
      return []; // まだ記憶が無い
    }
  }

  return {
    async listPending() {
      const out: PendingMemory[] = [];
      for (const file of await pendingFiles()) {
        const path = join(pendingDir, file);
        const record = await readJsonFile(path);
        const created = isRecord(record) && typeof record.created_at === "number" ? record.created_at * 1000 : null;
        // 期限切れ（7日）は消す。作成時刻が読めなければファイルの更新時刻で見る
        const age = created ?? (await stat(path).then((s) => s.mtimeMs).catch(() => now()));
        if (now() - age > MEMORY_PENDING_TTL_MS) {
          await unlink(path).catch(() => {});
          continue;
        }
        const projected = projectPendingMemory(record);
        if (projected) out.push(projected);
      }
      return out.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    },

    async approve(id) {
      await ensureExists(id);
      const output = await dispatchWriteApproval(options.connect, "memory", `approve ${id}`);
      if (!/^Approved\b/m.test(output)) throw new MemoryRejectedError(output.slice(0, 300) || "承認を適用できなかった");
    },

    async discard(id) {
      await ensureExists(id);
      const output = await dispatchWriteApproval(options.connect, "memory", `reject ${id}`);
      // Hermesが消してくれなかったときの保険（ファイルが残ると「却下したのに残る」になる）
      if (!/^Rejected\b/m.test(output)) await unlink(join(pendingDir, `${id}.json`)).catch(() => {});
    },

    async listEntries() {
      const out: MemoryEntry[] = [];
      for (const target of ["user", "memory"] as const) {
        for (const text of await readEntries(target)) out.push({ target, text });
      }
      return out;
    },

    async removeEntry(target, text) {
      const file = join(memoriesDir, FILE_OF[target]);
      // 読む→一致した1項目を外す→**rename直前にファイルが読んだ時点と同じ内容か確かめる**。違えば（Hermesが同時に書いた）読み直してやり直す。
      // Nodeに標準のflockが無くHermesの `<file>.lock` とは直列化できないので、確認からrenameまでの隙間は残るが、
      // 古い内容で上書きする窓を「読んでから書くまで」から「確認からrenameまで」へ縮める（#1181）。
      for (let attempt = 0; attempt < REMOVE_RETRY_LIMIT; attempt += 1) {
        const raw = await readRaw(file);
        const rest = removeEntryByText(raw === null ? [] : parseMemoryFile(raw), text);
        if (rest === null) throw new MemoryNotFoundError("記憶が見つからない（すでに変わった可能性がある）");
        const temp = join(memoriesDir, `.mem_${randomUUID().slice(0, 8)}.tmp`);
        try {
          await writeFile(temp, serializeMemoryFile(rest), { encoding: "utf8", mode: 0o600 });
          await options.beforeRemoveCommit?.();
          if ((await readRaw(file)) !== raw) {
            await unlink(temp).catch(() => {});
            continue; // 同時に書き換えられた。最新の内容で作り直す
          }
          await rename(temp, file); // 読んだ版のままなので、ここまでのHermesの書き込みは消さない
          return;
        } catch (error) {
          await unlink(temp).catch(() => {});
          throw error;
        }
      }
      throw new MemoryConflictError("記憶ファイルが同時に更新され続けた");
    },
  };
}
