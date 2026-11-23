import { cached, scheduleSource } from "@/lib/dashboard/aide";
import { jstDayKey } from "@/lib/day-key";
import {
  formatTodayContext,
  InjectionMemory,
  mentionsToday,
  PROPOSAL_MAX,
  type ProposalLine,
  type TaskLine,
  type TodayContext,
} from "@/lib/hermes/today-context-core";
import { listProposals } from "@/lib/hermes/proposals";
import { callToolJson, connectedServerFor } from "@/lib/mcp/direct-call";
import { parseTaskCandidates } from "@/lib/mail/link-core";

/**
 * Hermesのチャットで予定・タスクなど今日の状態を聞かれたとき、取得済みの値を発言の先頭へ添える（#1149）。**サーバー専用。**
 *
 * - 予定・タスクはダッシュボードと同じ5分キャッシュ（`cached()`・`scheduleSource()`）。**AIDEが遅くても5秒で諦める**
 * - 同じ会話で同じ日に添え済みなら再び付けない（Hermesが値を持っている）。記憶はプロセス内
 * - 失敗してもターンは止めない。一部の節が取れなければその節だけ出さず、全部取れなければ null（何も添えない）
 * - 外部由来の文面（予定・タスクの題名）は `today-context-core.ts` で長さを切り、枠で囲む
 */

const FETCH_TIMEOUT_MS = 5_000;
const memory = new InjectionMemory();

type TasksView = { status: "ok"; tasks: TaskLine[] } | { status: "failed" } | { status: "unconnected" };

function openTasks(userId: string, day: string): Promise<TasksView> {
  return cached(`today-tasks:${userId}:${day}`, async (): Promise<TasksView> => {
    try {
      const server = await connectedServerFor(userId, "aide");
      if (!server) return { status: "unconnected" };
      const json = await callToolJson(server, "aide_tasks", { status: "open", limit: 60 });
      return { status: "ok", tasks: parseTaskCandidates(json).map((t) => ({ title: t.title, due: t.dateText })) };
    } catch (error) {
      console.error("[aide-bot] チャットに添えるタスクを取得できなかった", error instanceof Error ? error.message : error);
      return { status: "failed" };
    }
  });
}

async function pendingProposals(userId: string): Promise<{ lines: ProposalLine[]; count: number } | null> {
  try {
    const pending = (await listProposals(userId)).filter((p) => p.status === "pending");
    return { lines: pending.slice(0, PROPOSAL_MAX).map((p) => ({ label: p.label, summary: p.summary })), count: pending.length };
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/** 今日の状態を聞く指示なら添える文面を返す。関係ない指示・添え済み・取得失敗は null。 */
export async function todayContextFor(userId: string, sessionId: string | undefined, text: string): Promise<TodayContext | null> {
  if (!mentionsToday(text)) return null;
  try {
    const now = new Date();
    const today = jstDayKey(now);
    if (sessionId && memory.has(userId, sessionId, today)) return null;

    const [schedule, tasks, proposals] = await Promise.all([
      withTimeout(scheduleSource(userId, now), FETCH_TIMEOUT_MS),
      withTimeout(openTasks(userId, today), FETCH_TIMEOUT_MS),
      withTimeout(pendingProposals(userId), FETCH_TIMEOUT_MS),
    ]);
    return formatTodayContext({
      today,
      scheduleJson: schedule?.status === "ok" ? schedule.json : null,
      tasks: tasks?.status === "ok" ? tasks.tasks : null,
      proposals: proposals ? proposals.lines : null,
      proposalCount: proposals?.count ?? 0,
    });
  } catch (error) {
    console.error("[aide-bot] チャットに添える今日の状態を用意できなかった", error instanceof Error ? error.message : error);
    return null;
  }
}

/** ターンが始まったあと、そのセッションに今日の状態を添えたと覚える。 */
export function markTodayInjected(userId: string, sessionId: string, day: string): void {
  memory.mark(userId, sessionId, day);
}
