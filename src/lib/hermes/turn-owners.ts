/**
 * 実行中のターンの持ち主（#794）。承認・中断のRoute Handlerが、他の利用者のターンへ触れないようにする。
 * プロセス内の記録（PM2で1プロセスという前提。ターンは接続が切れれば中断されるので、再起動をまたいで持つ必要は無い）。
 */
const owners = new Map<string, string>();

export function registerTurn(turnId: string, userId: string): void {
  owners.set(turnId, userId);
}

export function releaseTurn(turnId: string): void {
  owners.delete(turnId);
}

export function ownsTurn(turnId: string, userId: string): boolean {
  return owners.get(turnId) === userId;
}
