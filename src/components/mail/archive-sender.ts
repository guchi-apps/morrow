import { forgetArchived, rememberArchived } from "@/lib/mail/archived-memory";
import type { MailAction } from "@/lib/mail/contract";
import { createPendingStore, type PendingArchive } from "@/lib/mail/pending-archive";

/**
 * 整理の操作を `POST /api/mail/actions` へ送る側（#683・#1192）。
 *
 * アーカイブは押した瞬間に送り、サーバーは受け付けた時点で202を返す（実行はサーバーの列。画面を閉じても進む）。
 * 画面は同じ `opId` で結果を問い合わせる。結果を受け取れていない分は端末に控え、戻ったときに確かめ直す。
 */

export type MailActionNotice = { text: string; error: boolean };

export type SendResult =
  | { ok: true; done: string }
  /** `unknown` は結果が分からない（控えは残す）。`cancelled` は受信トレイへ戻すなどで取り下げた。 */
  | { ok: false; error: string; markedRead?: boolean; unknown?: boolean; cancelled?: boolean };

const POLL_MS = 1500;
/** 通信できないときに間をあけて確かめ直す回数と間隔。 */
const RETRY_DELAYS_MS = [1000, 3000, 8000];

export const pendingArchives = createPendingStore(() => window.localStorage);

// 本文の画面から裏で流したアーカイブ（#1023）の失敗。本文の画面はもう無いので、一覧が拾えるようモジュールで持つ
let backgroundFailure: MailActionNotice | null = null;
const failureListeners = new Set<() => void>();

export const readBackgroundFailure = () => backgroundFailure;

export function setBackgroundFailure(next: MailActionNotice | null) {
  backgroundFailure = next;
  failureListeners.forEach((l) => l());
}

export function subscribeBackgroundFailure(listener: () => void): () => void {
  failureListeners.add(listener);
  return () => failureListeners.delete(listener);
}

type Reply = SendResult | "running";

async function request(body: Record<string, unknown>): Promise<Reply> {
  const unknown: SendResult = { ok: false, error: "操作できませんでした（通信できませんでした）。", unknown: true };
  try {
    const response = await fetch("/api/mail/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    });
    if (response.status === 202) return "running";
    const data = (await response.json().catch(() => null)) as { done?: string; error?: string; markedRead?: boolean } | null;
    if (response.ok && data?.done) return { ok: true, done: data.done };
    // JSONでない応答（中継の502・504など）は、実行されたかどうか分からない
    if (!data?.error) return { ...unknown, error: `操作できませんでした: HTTP ${response.status}` };
    const read = data.markedRead ? "（既読にはしました）" : "";
    return { ok: false, error: `操作できませんでした: ${data.error}${read}`, markedRead: data.markedRead };
  } catch {
    return unknown;
  }
}

export async function send(action: MailAction, ids: string[], labelId: string | null): Promise<SendResult> {
  const reply = await request({ action, ids, labelId });
  return reply === "running" ? { ok: false, error: "操作の結果を確認できませんでした。", unknown: true } : reply;
}

/** 間をあける。裏にいる間は表に出るまで待つ。 */
async function pause(ms: number) {
  await new Promise((resolve) => window.setTimeout(resolve, ms));
  while (document.visibilityState === "hidden") {
    await new Promise((resolve) => document.addEventListener("visibilitychange", resolve, { once: true }));
  }
}

const inflight = new Map<string, Promise<SendResult>>();

async function follow(opId: string): Promise<SendResult> {
  let failures = 0;
  for (;;) {
    // 控えから消えた＝取り下げたか、10分を過ぎた
    const entry = pendingArchives.get(opId);
    if (!entry) return { ok: false, error: "アーカイブの結果を確認できませんでした。一覧を確かめてください。", cancelled: true };
    const reply = await request({ action: "archive", ids: entry.ids, labelId: null, markRead: entry.markRead, opId });
    if (reply === "running") {
      failures = 0;
      await pause(POLL_MS);
      continue;
    }
    if (!reply.ok && reply.unknown) {
      const delay = RETRY_DELAYS_MS[failures];
      if (delay === undefined) return reply;
      failures += 1;
      await pause(delay);
      continue;
    }
    pendingArchives.remove(opId);
    return reply;
  }
}

function track(opId: string): Promise<SendResult> {
  let running = inflight.get(opId);
  if (!running) {
    running = follow(opId).finally(() => inflight.delete(opId));
    inflight.set(opId, running);
  }
  return running;
}

/** アーカイブを控えてから送り、結果が出るまで追う。 */
export function sendArchive(ids: string[], markRead: boolean): Promise<SendResult> {
  const entry: PendingArchive = { opId: newOpId(), ids, markRead, at: Date.now() };
  pendingArchives.add(entry);
  return track(entry.opId);
}

function newOpId(): string {
  // `randomUUID` はHTTPS（とlocalhost）でしか使えない
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 結果を受け取れていないアーカイブを確かめ直す。1件でも通れば `onDone` を呼ぶ。 */
export function flushPendingArchives(onDone: () => void) {
  for (const entry of pendingArchives.list()) {
    if (inflight.has(entry.opId)) continue;
    rememberArchived(entry.ids);
    void track(entry.opId).then((result) => {
      if (result.ok) {
        rememberArchived(entry.ids);
        setBackgroundFailure(null);
        onDone();
        return;
      }
      forgetArchived(entry.ids);
      if (!result.cancelled) setBackgroundFailure({ text: result.error, error: true });
      if (result.markedRead) onDone();
    });
  }
}
