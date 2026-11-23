"use client";

import { AlertTriangle, Check, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";

import {
  detectSensitive,
  hasBlockingIssue,
  reviewText,
  SENSITIVE_LABELS,
  skillTitle,
  validatePendingSkill,
  type InstalledSkill,
  type PendingSkill,
  type SensitiveHit,
  type SkillOp,
} from "@/lib/hermes/skill-core";

/** 本文のうち、個人情報らしき文字列を強調して出す。 */
function Highlighted({ text, hits }: { text: string; hits: SensitiveHit[] }) {
  const needles = hits.map((hit) => hit.text.replace(/…$/, "")).filter((needle) => needle !== "");
  if (needles.length === 0) return <>{text}</>;
  const escaped = needles.map((needle) => needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = text.split(new RegExp(`(${escaped.join("|")})`, "g"));
  return (
    <>
      {parts.map((part, index) =>
        needles.includes(part) ? (
          <mark key={index} className="rounded bg-red-500/25 px-0.5 text-foreground">
            {part}
          </mark>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

const ACTION_LABELS: Record<SkillOp["action"], string> = {
  create: "新規作成",
  edit: "全文の書き換え",
  patch: "一部の修正",
  write_file: "ファイルの追加・上書き",
  remove_file: "ファイルの削除",
  delete: "スキルの削除",
};

function PendingCard({ skill }: { skill: PendingSkill }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "discard" | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const issues = validatePendingSkill(skill);
  const blocked = hasBlockingIssue(issues);
  const hits = detectSensitive(reviewText(skill));

  async function act(action: "approve" | "discard") {
    setBusy(action);
    setMessage(null);
    try {
      const response = await fetch(`/api/hermes/skills/pending/${skill.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, confirmed }),
      });
      if (response.ok) {
        router.refresh();
        return;
      }
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setMessage(data?.error ?? "処理できませんでした。");
    } catch {
      setMessage("通信できませんでした。もう一度お試しください。");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4" aria-label={`確認待ち: ${skillTitle(skill)}`}>
      <header className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">{skillTitle(skill)}</h3>
        <p className="text-xs text-muted">
          {skill.origin === "background_review" ? "Hermesが会話の後で自動で見直して作った案" : "会話の中でHermesが作った案"}
          {skill.createdAt ? `・${new Date(skill.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}` : ""}
        </p>
        {skill.summary && <p className="text-xs text-muted">{skill.summary}</p>}
      </header>

      {skill.touchesBundled && (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/15 px-2.5 py-2 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          同梱スキルの変更です。差分を必ず確かめてください。
        </p>
      )}

      {issues.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs">
          {issues.map((issue, index) => (
            <li key={index} className={issue.level === "error" ? "text-red-500" : "text-muted"}>
              {issue.level === "error" ? "✕ " : "⚠ "}
              {issue.message}
            </li>
          ))}
        </ul>
      )}

      {hits.length > 0 && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-xs">
          <p className="font-semibold">個人情報・認証情報らしき文字列があります（本文の赤い部分）</p>
          <ul className="mt-1 list-disc pl-4">
            {hits.map((hit, index) => (
              <li key={index}>
                {SENSITIVE_LABELS[hit.kind]}: <code>{hit.text}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {skill.ops.map((op, index) => (
        <div key={index} className="flex flex-col gap-1">
          <p className="text-xs font-medium">
            {ACTION_LABELS[op.action]}: {op.name}
            {op.filePath ? ` / ${op.filePath}` : ""}
          </p>
          {(op.content !== undefined || op.newString !== undefined) && (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background px-3 py-2 text-xs">
              <Highlighted text={op.content ?? op.newString ?? ""} hits={hits} />
            </pre>
          )}
        </div>
      ))}

      {skill.diff && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">Hermesが出した差分（全文）</summary>
          <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background px-3 py-2">{skill.diff}</pre>
        </details>
      )}

      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5" />
        <span>住所・口座・認証情報などの個人情報を含んでいないことを確認した</span>
      </label>

      {message && (
        <p role="alert" className="text-xs text-red-500">
          {message}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy !== null || blocked || !confirmed}
          onClick={() => void act("approve")}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
        >
          {busy === "approve" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
          承認して登録
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void act("discard")}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40"
        >
          {busy === "discard" && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
          却下
        </button>
      </div>
    </section>
  );
}

function InstalledRow({ skill }: { skill: InstalledSkill }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm(`スキル「${skill.name}」を削除します。元に戻せません。`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/hermes/skills/installed/${encodeURIComponent(skill.name)}`, { method: "DELETE" });
      if (response.ok) {
        router.refresh();
        return;
      }
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setMessage(data?.error ?? "削除できませんでした。");
    } catch {
      setMessage("通信できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm">{skill.name}</p>
        {skill.description && <p className="text-xs text-muted">{skill.description}</p>}
        {message && (
          <p role="alert" className="text-xs text-red-500">
            {message}
          </p>
        )}
      </div>
      {!skill.bundled && (
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy}
          aria-label={`${skill.name}を削除`}
          className="shrink-0 rounded-lg p-2 text-muted hover:bg-rail-active disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
        </button>
      )}
    </li>
  );
}

/** スキルの画面（#1154）。承認待ちのカードと、登録済みの一覧（Hermesが作ったものだけ削除できる）。 */
export function SkillsView({ pending, installed, error }: { pending: PendingSkill[]; installed: InstalledSkill[]; error: string | null }) {
  const mine = installed.filter((skill) => !skill.bundled);
  const bundledCount = installed.length - mine.length;
  return (
    <>
      <div>
        <h1 className="text-lg font-semibold">スキル</h1>
        <p className="mt-1 text-xs text-muted">
          Hermesが「次からも使える手順」として作ったスキルを、内容を確かめてから登録します。承認するまで、スキルは1つも登録されません。
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">
          取得できませんでした: {error}
        </p>
      )}

      {!error && (
        <>
          <section className="flex flex-col gap-3" aria-label="確認待ち">
            <h2 className="text-sm font-semibold">確認待ち（{pending.length}件）</h2>
            {pending.length === 0 && <p className="text-xs text-muted">確認待ちのスキル案はありません。7日以上放置した案は自動で消えます。</p>}
            {pending.map((skill) => (
              <PendingCard key={skill.id} skill={skill} />
            ))}
          </section>

          <section aria-label="登録済み">
            <h2 className="text-sm font-semibold">登録済み（Hermesが作ったもの {mine.length}件）</h2>
            {mine.length === 0 ? (
              <p className="mt-1 text-xs text-muted">まだありません。</p>
            ) : (
              <ul className="mt-1 divide-y divide-border">
                {mine.map((skill) => (
                  <InstalledRow key={skill.name} skill={skill} />
                ))}
              </ul>
            )}
            {bundledCount > 0 && <p className="mt-2 text-xs text-muted">Hermes同梱のスキル {bundledCount}件は削除できません。</p>}
          </section>
        </>
      )}
    </>
  );
}
