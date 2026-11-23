import { randomUUID } from "node:crypto";
import { readdir, readFile, rm, stat, unlink } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import {
  PENDING_ID_PATTERN,
  PENDING_TTL_MS,
  SKILL_DIFF_MAX,
  SKILL_NAME_PATTERN,
  descriptionOf,
  opsFromPayload,
  type InstalledSkill,
  type PendingSkill,
} from "../src/lib/hermes/skill-core.ts";
import type { HermesLink } from "./hermes-link.ts";
import { SESSION_SOURCE } from "./turn.ts";

/**
 * Hermesが作るスキルの確認・承認（#1154。実測は `docs/hermes-skills.md`＝#1153）。
 *
 * - 保留（`skills.write_approval: true` のとき `skill_manage` が `<HERMES_HOME>/pending/skills/<id>.json` に残す）は**ファイルを直接読む**
 *   （`command.dispatch` の `skills pending` は構造化されていないため）。形は Hermes の `tools/write_approval.py` の `stage_write()`
 * - 承認・却下・差分は Hermes の `command.dispatch`（`name: "skills"`）へ渡す。**`arg` は `pending`・`diff <id>`・`approve <id>`・`reject <id>` だけ**
 *   （`hermes serve` のトークンは管理者権限で、他のコマンドを通すとゲート自体を切れてしまう）
 * - 7日を過ぎた保留は一覧のたびに消す。登録済みスキルは `<HERMES_HOME>/skills/` を読む（`.bundled_manifest` に載るものは同梱）
 */

export class SkillNotFoundError extends Error {}
export class SkillRejectedError extends Error {}

export interface SkillStore {
  listPending(): Promise<PendingSkill[]>;
  approve(id: string): Promise<void>;
  discard(id: string): Promise<void>;
  listInstalled(): Promise<InstalledSkill[]>;
  removeInstalled(name: string): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `command.dispatch` の `arg` の許可。 */
export function isAllowedSkillsArg(arg: string): boolean {
  return /^(?:pending|(?:diff|approve|reject) [0-9a-f]{8})$/.test(arg);
}

/** 保留1件の記録（`pending/skills/<id>.json`）を画面へ出す形に絞る。読めない・形が違えば null。 */
export function projectPending(record: unknown, bundled: ReadonlySet<string>, diff: string | null): PendingSkill | null {
  if (!isRecord(record)) return null;
  if (typeof record.id !== "string" || !PENDING_ID_PATTERN.test(record.id)) return null;
  const ops = opsFromPayload(record.payload);
  const created = typeof record.created_at === "number" && Number.isFinite(record.created_at) ? Math.round(record.created_at * 1000) : null;
  return {
    id: record.id,
    origin: record.origin === "background_review" ? "background_review" : "foreground",
    createdAt: created,
    summary: typeof record.summary === "string" ? record.summary.slice(0, 500) : "",
    ops,
    diff: diff === null ? null : diff.slice(0, SKILL_DIFF_MAX),
    // 新規作成でない操作が同梱スキルを指していれば、同梱スキルの変更
    touchesBundled: ops.some((op) => op.action !== "create" && bundled.has(op.name)),
  };
}

/** `.bundled_manifest`（1行1件 `名前:ハッシュ`）から同梱スキルの名前を取る。 */
export function parseBundledManifest(text: string): Set<string> {
  const names = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const name = line.split(":")[0]?.trim();
    if (name) names.add(name);
  }
  return names;
}

export interface SkillStoreOptions {
  /** profileのディレクトリ（`~/.hermes/profiles/morrow`）。 */
  hermesHome: string;
  /** Hermesへ繋ぐ。 */
  connect: () => Promise<HermesLink>;
  now?: () => number;
}

/** 1回のdispatch用に接続し、`skills <arg>` の出力を返して閉じる。 */
async function dispatchSkills(connect: () => Promise<HermesLink>, arg: string): Promise<string> {
  if (!isAllowedSkillsArg(arg)) throw new Error("許可されていない引数");
  const link = await connect();
  try {
    await link.rpc("client.capabilities", { server_requests: true });
    const created = await link.rpc("session.create", { source: SESSION_SOURCE, title: `skills-review-${randomUUID().slice(0, 8)}` });
    const sessionId = typeof created.session_id === "string" ? created.session_id : "";
    if (!sessionId) throw new Error("session.create の応答にsession_idが無い");
    const result = await link.rpc("command.dispatch", { name: "skills", arg, session_id: sessionId });
    return typeof result.output === "string" ? result.output : "";
  } finally {
    link.close();
  }
}

async function readJsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse((await readFile(path, "utf8")).replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

async function readBundled(home: string): Promise<Set<string>> {
  try {
    return parseBundledManifest(await readFile(join(home, "skills", ".bundled_manifest"), "utf8"));
  } catch {
    return new Set();
  }
}

export function createSkillStore(options: SkillStoreOptions): SkillStore {
  const home = resolve(options.hermesHome);
  const pendingDir = join(home, "pending", "skills");
  const skillsDir = join(home, "skills");
  const now = options.now ?? Date.now;

  async function pendingFiles(): Promise<string[]> {
    try {
      return (await readdir(pendingDir)).filter((file) => /^[0-9a-f]{8}\.json$/.test(file));
    } catch {
      return []; // 保留が一度もできていない
    }
  }

  async function listPending(): Promise<PendingSkill[]> {
    const bundled = await readBundled(home);
    const out: PendingSkill[] = [];
    for (const file of await pendingFiles()) {
      const path = join(pendingDir, file);
      const record = await readJsonFile(path);
      const created = isRecord(record) && typeof record.created_at === "number" ? record.created_at * 1000 : null;
      // 期限切れ（7日）は消す。作成時刻が読めなければファイルの更新時刻で見る
      const age = created ?? (await stat(path).then((s) => s.mtimeMs).catch(() => now()));
      if (now() - age > PENDING_TTL_MS) {
        await unlink(path).catch(() => {});
        continue;
      }
      const id = file.slice(0, 8);
      let diff: string | null = null;
      try {
        diff = await dispatchSkills(options.connect, `diff ${id}`);
      } catch {
        // 差分が取れなくても、操作の中身は画面に出せる
      }
      const projected = projectPending(record, bundled, diff);
      if (projected) out.push(projected);
    }
    return out.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  }

  async function ensureExists(id: string): Promise<void> {
    if (!PENDING_ID_PATTERN.test(id)) throw new SkillNotFoundError("保留のidの形が正しくない");
    if (!(await pendingFiles()).includes(`${id}.json`)) throw new SkillNotFoundError("保留が見つからない");
  }

  return {
    listPending,

    async approve(id) {
      await ensureExists(id);
      const output = await dispatchSkills(options.connect, `approve ${id}`);
      if (!/^Approved\b/m.test(output)) throw new SkillRejectedError(output.slice(0, 300) || "承認を適用できなかった");
    },

    async discard(id) {
      await ensureExists(id);
      const output = await dispatchSkills(options.connect, `reject ${id}`);
      // Hermesが消してくれなかったときの保険（ファイルが残ると「却下したのに残る」になる）
      if (!/^Rejected\b/m.test(output)) await unlink(join(pendingDir, `${id}.json`)).catch(() => {});
    },

    async listInstalled() {
      const bundled = await readBundled(home);
      const found = new Map<string, InstalledSkill>();
      async function visit(dir: string, depth: number): Promise<void> {
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        if (entries.some((e) => e.isFile() && e.name === "SKILL.md") && depth > 0) {
          const name = dir.split(sep).pop() ?? "";
          if (!SKILL_NAME_PATTERN.test(name)) return;
          const file = join(dir, "SKILL.md");
          const text = await readFile(file, "utf8").catch(() => "");
          const updatedAt = await stat(file).then((s) => Math.round(s.mtimeMs)).catch(() => null);
          found.set(name, { name, description: (descriptionOf(text) ?? "").slice(0, 500), bundled: bundled.has(name), updatedAt });
          return;
        }
        if (depth >= 2) return;
        for (const e of entries) {
          if (e.isDirectory() && !e.name.startsWith(".")) await visit(join(dir, e.name), depth + 1);
        }
      }
      await visit(skillsDir, 0);
      return [...found.values()].sort((a, b) => Number(a.bundled) - Number(b.bundled) || a.name.localeCompare(b.name));
    },

    async removeInstalled(name) {
      if (!SKILL_NAME_PATTERN.test(name)) throw new SkillNotFoundError("スキル名の形が正しくない");
      const installed = (await this.listInstalled()).find((skill) => skill.name === name);
      if (!installed) throw new SkillNotFoundError("スキルが見つからない");
      if (installed.bundled) throw new SkillRejectedError("同梱のスキルは削除できない");
      // 名前から場所を引き直す（上で見つけたもの＝skills配下のSKILL.mdを持つ同名のディレクトリだけ）
      const dirs: string[] = [];
      async function find(dir: string, depth: number): Promise<void> {
        const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const e of entries) {
          if (!e.isDirectory() || e.name.startsWith(".")) continue;
          const path = join(dir, e.name);
          if (e.name === name && (await stat(join(path, "SKILL.md")).catch(() => null))) dirs.push(path);
          else if (depth < 1) await find(path, depth + 1);
        }
      }
      await find(skillsDir, 0);
      if (dirs.length !== 1) throw new SkillNotFoundError("削除する場所を決められない");
      const target = resolve(dirs[0]);
      if (!target.startsWith(skillsDir + sep)) throw new SkillRejectedError("場所が正しくない");
      await rm(target, { recursive: true, force: true });
    },
  };
}
