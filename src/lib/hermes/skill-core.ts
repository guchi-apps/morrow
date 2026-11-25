/**
 * Hermesが作るスキルの確認・承認（#1154）で、ブリッジ（素のNode）とMorrowの両方が使う純粋な部分。
 * **Prismaにも `@/` にも触れない。** 設計は `docs/hermes-skills.md`（実測は#1153）・`docs/hermes-route.md`。
 *
 * 保留（`<HERMES_HOME>/pending/skills/<id>.json`）の1件は、`skill_manage` の呼び出し（単発または `batch` の `operations[]`）を
 * そのまま持つ。ここではそれを画面に出す形（`SkillOp`）へ絞り、承認前の検証と個人情報らしき文字列の検出を行う。
 */

/** 保留のidの形（Hermesは `uuid4().hex[:8]`）。コマンドへ渡す前に必ずこれで確かめる。 */
export const PENDING_ID_PATTERN = /^[0-9a-f]{8}$/;

/** Hermesの名前の規則（`VALID_NAME_RE`）。長さは64まで。 */
export const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** 説明の上限（Morrowの確認基準。Hermesは1024字まで許す）。 */
export const SKILL_DESCRIPTION_MAX = 60;
/** 1回の保留の本文の合計の上限（Morrowの確認基準。Hermesは10万字まで許す）。 */
export const SKILL_CONTENT_MAX = 20_000;
/** 1回の保留が持てる操作の上限。 */
export const SKILL_OPS_MAX = 10;
/** 差分として画面へ渡す文字数の上限。 */
export const SKILL_DIFF_MAX = 30_000;
/** 保留の有効期間。過ぎたものはブリッジが消す。 */
export const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type SkillAction = "create" | "edit" | "patch" | "write_file" | "remove_file" | "delete";

const ACTIONS: readonly string[] = ["create", "edit", "patch", "write_file", "remove_file", "delete"];

/** 保留の中の1操作。本文は画面に出すために持つ（確定したらMorrowは保存しない）。 */
export interface SkillOp {
  action: SkillAction;
  name: string;
  /** `patch`・`write_file`・`remove_file` の対象（無ければ SKILL.md）。 */
  filePath?: string;
  /** `create`・`edit` は SKILL.md の全文、`write_file` はそのファイルの全文。 */
  content?: string;
  oldString?: string;
  newString?: string;
}

export interface PendingSkill {
  id: string;
  /** `foreground`＝利用者との会話の中で作った／`background_review`＝自動の見直しが作った。 */
  origin: "foreground" | "background_review";
  /** 保留ができた時刻（epochミリ秒）。分からなければ null。 */
  createdAt: number | null;
  /** Hermesが付けた1行の要約。 */
  summary: string;
  ops: SkillOp[];
  /** Hermesの `skills diff <id>` の出力（作成は全文、編集は差分）。取れなければ null。 */
  diff: string | null;
  /** 既存の同梱スキルに触れる操作があるか（ブリッジが判定。同梱スキルのpatchも提案されうる）。 */
  touchesBundled: boolean;
}

export interface InstalledSkill {
  name: string;
  description: string;
  /** Hermesの同梱スキルか。同梱は画面から削除できない。 */
  bundled: boolean;
  /** SKILL.mdの更新時刻（epochミリ秒）。 */
  updatedAt: number | null;
}

export interface PendingSkillsBody {
  pending: PendingSkill[];
}

export interface InstalledSkillsBody {
  skills: InstalledSkill[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optString(value: unknown, max: number): string | undefined {
  return typeof value === "string" ? value.slice(0, max) : undefined;
}

/** 保留1件の `payload` から操作の並びを取り出す（単発は1件、`batch` は `operations[]`）。読めない操作は落とす。 */
export function opsFromPayload(payload: unknown): SkillOp[] {
  if (!isRecord(payload)) return [];
  const raw = payload.action === "batch" && Array.isArray(payload.operations) ? payload.operations : [payload];
  const ops: SkillOp[] = [];
  for (const item of raw.slice(0, SKILL_OPS_MAX)) {
    if (!isRecord(item)) continue;
    const action = item.action;
    if (typeof action !== "string" || !ACTIONS.includes(action)) continue;
    if (typeof item.name !== "string" || item.name === "") continue;
    const content = action === "write_file" ? optString(item.file_content, SKILL_CONTENT_MAX + 1) : optString(item.content, SKILL_CONTENT_MAX + 1);
    const filePath = optString(item.file_path, 300);
    const oldString = optString(item.old_string, SKILL_CONTENT_MAX + 1);
    const newString = optString(item.new_string, SKILL_CONTENT_MAX + 1);
    ops.push({
      action: action as SkillAction,
      name: item.name.slice(0, 200),
      ...(filePath ? { filePath } : {}),
      ...(content !== undefined ? { content } : {}),
      ...(oldString !== undefined ? { oldString } : {}),
      ...(newString !== undefined ? { newString } : {}),
    });
  }
  return ops;
}

/** SKILL.md の先頭の frontmatter から `description:` を取り出す（無ければ null）。 */
export function descriptionOf(content: string): string | null {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!front) return null;
  const line = /^description:[ \t]*(.*)$/m.exec(front[1]);
  if (!line) return null;
  const value = line[1].trim().replace(/^(['"])([\s\S]*)\1$/, "$2").trim();
  return value === "" ? null : value;
}

export interface SkillIssue {
  /** `error` は承認を断る。`warning` は画面で見せるだけ。 */
  level: "error" | "warning";
  message: string;
}

/** 承認前の検証（形式・長さ）。Morrowのサーバーが承認のたびにもう一度行う。 */
export function validatePendingSkill(skill: Pick<PendingSkill, "ops">): SkillIssue[] {
  const issues: SkillIssue[] = [];
  if (skill.ops.length === 0) {
    issues.push({ level: "error", message: "内容を読み取れませんでした。却下してください。" });
    return issues;
  }
  let total = 0;
  for (const op of skill.ops) {
    if (!SKILL_NAME_PATTERN.test(op.name)) {
      issues.push({ level: "error", message: `スキル名「${op.name}」の形が正しくありません（英小文字・数字・ . _ - のみ、64字まで）。` });
    }
    if (op.filePath !== undefined && (op.filePath.includes("..") || op.filePath.startsWith("/") || op.filePath.includes("\\"))) {
      issues.push({ level: "error", message: `対象のファイル名「${op.filePath}」が安全ではありません。` });
    }
    for (const text of [op.content, op.oldString, op.newString]) total += text?.length ?? 0;
    if (op.action === "create" || op.action === "edit") {
      if (!op.content || op.content.trim() === "") {
        issues.push({ level: "error", message: `「${op.name}」の本文が空です。` });
        continue;
      }
      const description = descriptionOf(op.content);
      if (description === null) {
        issues.push({ level: "error", message: `「${op.name}」に説明（description）がありません。` });
      } else if ([...description].length > SKILL_DESCRIPTION_MAX) {
        issues.push({
          level: "error",
          message: `「${op.name}」の説明が${[...description].length}字あります（${SKILL_DESCRIPTION_MAX}字以内）。`,
        });
      }
    }
    if (op.action === "delete") issues.push({ level: "warning", message: `スキル「${op.name}」を削除する操作です。` });
  }
  if (total > SKILL_CONTENT_MAX) {
    issues.push({ level: "error", message: `本文が長すぎます（${SKILL_CONTENT_MAX.toLocaleString("ja-JP")}字以内）。` });
  }
  return issues;
}

export function hasBlockingIssue(issues: readonly SkillIssue[]): boolean {
  return issues.some((issue) => issue.level === "error");
}

/** 個人情報・認証情報らしき文字列の種類。 */
export type SensitiveKind = "phone" | "card" | "email" | "secret" | "address" | "account";

export interface SensitiveHit {
  kind: SensitiveKind;
  /** 見つけた文字列（画面で強調する）。長いものは切る。 */
  text: string;
}

export const SENSITIVE_LABELS: Record<SensitiveKind, string> = {
  phone: "電話番号らしき数字",
  card: "カード番号らしき数字",
  email: "メールアドレス",
  secret: "パスワード・トークンらしき文字列",
  address: "住所らしき文字列",
  account: "口座番号らしき数字",
};

const PATTERNS: { kind: SensitiveKind; re: RegExp }[] = [
  { kind: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: "phone", re: /(?<![\d-])0\d{1,4}-\d{1,4}-\d{3,4}(?![\d-])|(?<!\d)0[789]0\d{8}(?!\d)/g },
  { kind: "card", re: /(?<![\d-])(?:\d{4}[- ]?){3}\d{4}(?![\d-])/g },
  { kind: "account", re: /(?:口座(?:番号)?|普通|当座)[^\n\d]{0,8}\d{6,8}/g },
  { kind: "secret", re: /(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|(?:password|passwd|パスワード|暗証番号|api[_-]?key|secret|token|トークン)\s*[:=：]\s*\S+)/gi },
  { kind: "address", re: /(?:都|道|府|県)[^\s、。]{1,12}(?:市|区|町|村)[^\s、。]{0,20}\d+(?:-\d+){1,3}|〒\s?\d{3}-?\d{4}/g },
];

/** 本文のうち個人情報・認証情報らしき文字列を拾う（目視確認の補助。見つからなくても安全の保証にはならない）。 */
export function detectSensitive(text: string): SensitiveHit[] {
  const hits: SensitiveHit[] = [];
  const seen = new Set<string>();
  for (const { kind, re } of PATTERNS) {
    for (const match of text.matchAll(new RegExp(re.source, re.flags))) {
      const found = match[0];
      const key = `${kind}:${found}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ kind, text: found.length > 60 ? `${found.slice(0, 60)}…` : found });
      if (hits.length >= 30) return hits;
    }
  }
  return hits;
}

/** 保留1件の、人が確認すべき本文をまとめた文字列（個人情報の検出に使う）。 */
export function reviewText(skill: Pick<PendingSkill, "ops">): string {
  return skill.ops.map((op) => [op.content, op.newString].filter((v) => v !== undefined).join("\n")).join("\n");
}

/** 承認待ちの1件の見出し（画面・通知）。 */
export function skillTitle(skill: Pick<PendingSkill, "ops">): string {
  const first = skill.ops[0];
  if (!first) return "スキル";
  const verb = { create: "作成", edit: "書き換え", patch: "一部修正", write_file: "ファイル追加", remove_file: "ファイル削除", delete: "削除" }[first.action];
  const more = skill.ops.length > 1 ? ` ほか${skill.ops.length - 1}件` : "";
  return `${first.name} を${verb}${more}`;
}

function isOrigin(value: unknown): value is PendingSkill["origin"] {
  return value === "foreground" || value === "background_review";
}

/** ブリッジの応答（保留の一覧）の形を確かめる。1件でも違えば null。 */
export function parsePendingSkillsBody(body: unknown): PendingSkillsBody | null {
  if (!isRecord(body) || !Array.isArray(body.pending)) return null;
  const pending: PendingSkill[] = [];
  for (const item of body.pending) {
    if (!isRecord(item)) return null;
    if (typeof item.id !== "string" || !PENDING_ID_PATTERN.test(item.id)) return null;
    if (!isOrigin(item.origin)) return null;
    if (item.createdAt !== null && (typeof item.createdAt !== "number" || !Number.isFinite(item.createdAt))) return null;
    if (typeof item.summary !== "string") return null;
    if (item.diff !== null && typeof item.diff !== "string") return null;
    if (typeof item.touchesBundled !== "boolean") return null;
    if (!Array.isArray(item.ops)) return null;
    const ops = opsFromPayload({ action: "batch", operations: item.ops.map(snakeOp) });
    pending.push({
      id: item.id,
      origin: item.origin,
      createdAt: item.createdAt,
      summary: item.summary.slice(0, 500),
      ops,
      diff: item.diff === null ? null : item.diff.slice(0, SKILL_DIFF_MAX),
      touchesBundled: item.touchesBundled,
    });
  }
  return { pending };
}

/** `SkillOp`（camelCase）を `opsFromPayload` が読む形（Hermesの保留と同じ snake_case）へ戻す。 */
function snakeOp(op: unknown): unknown {
  if (!isRecord(op)) return op;
  return {
    action: op.action,
    name: op.name,
    file_path: op.filePath,
    content: op.action === "write_file" ? undefined : op.content,
    file_content: op.action === "write_file" ? op.content : undefined,
    old_string: op.oldString,
    new_string: op.newString,
  };
}

export function parseInstalledSkillsBody(body: unknown): InstalledSkillsBody | null {
  if (!isRecord(body) || !Array.isArray(body.skills)) return null;
  const skills: InstalledSkill[] = [];
  for (const item of body.skills) {
    if (!isRecord(item)) return null;
    if (typeof item.name !== "string" || !SKILL_NAME_PATTERN.test(item.name)) return null;
    if (typeof item.description !== "string" || typeof item.bundled !== "boolean") return null;
    if (item.updatedAt !== null && (typeof item.updatedAt !== "number" || !Number.isFinite(item.updatedAt))) return null;
    skills.push({ name: item.name, description: item.description.slice(0, 500), bundled: item.bundled, updatedAt: item.updatedAt });
  }
  return { skills };
}
