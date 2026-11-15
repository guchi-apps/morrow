import { db } from "@/lib/db";

/**
 * Hermesセッションの持ち主の対応（#937）。履歴取得（`/api/hermes/sessions/<id>/messages`）と継続ターン
 * （`/api/hermes/turns`）で、他の利用者のセッションidを使えないようにする。
 * 対応が無い（この対応づけを入れる前に始まった）セッションは持ち主不明で、**他人のものと同じ扱い**（履歴は404・継続は新規会話）。
 */

/** そのセッションが `userId` のものとして記録されているか。 */
export async function ownsHermesSession(userId: string, sessionId: string): Promise<boolean> {
  const row = await db.hermesSession.findUnique({ where: { sessionId: sessionId.slice(0, 128) }, select: { userId: true } });
  return row?.userId === userId;
}

/** ターンの開始で届いたセッションidを利用者へ結びつける。すでに別の利用者のものなら結びつけず `false`（上書きしない）。 */
export async function claimHermesSession(userId: string, sessionId: string): Promise<boolean> {
  const id = sessionId.slice(0, 128);
  await db.hermesSession.createMany({ data: [{ sessionId: id, userId }], skipDuplicates: true });
  return ownsHermesSession(userId, id);
}
