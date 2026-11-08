/**
 * Hermesの道具名 → 日本語の表示名、結果カードの項目（#794。純粋）。
 *
 * 分類の正は `docs/hermes-actions.md`（読み取り／取り消せる書き込み〔自動〕）。**AIDEが道具を増やしたら、docsの表・profileの許可リストと揃える。**
 * 取り消せない書き込みは `morrow_propose_action` 経由の確認カードで、ここには出ない（`proposal-core.ts` の `PROPOSAL_LABELS`）。
 * 知らない道具は「その他の操作」と出す（名前をそのまま見せない）。
 */

/** 読み取り（自動）。 */
const READ_LABELS: Record<string, string> = {
  aide_schedule: "予定の確認",
  aide_tasks: "タスクの確認",
  aide_get_task: "タスクの確認",
  aide_get_travel: "移動の確認",
  aide_weather: "天気の確認",
  aide_current_location: "現在地の確認",
  aide_garbage_collection: "ごみ出しの確認",
  aide_balances: "残高の確認",
  aide_fixed_costs: "固定費の確認",
  aide_utility_bills: "光熱費の確認",
  aide_room_sensors: "部屋の状態の確認",
  aide_room_buttons: "部屋のボタンの確認",
  aide_aircon_status: "エアコンの状態の確認",
  aide_printer_status: "プリンターの状態の確認",
  aide_work_reports: "作業報告の確認",
  asset_manager_subscriptions: "サブスクの確認",
  asset_manager_salary_lookup: "給与の確認",
  kurashio_get_utility_bill: "光熱費の確認",
  kurashio_get_kepco_hourly: "電力使用量の確認",
  kurashio_utility_bill_contracts: "光熱費の契約の確認",
  aide_ping: "接続の確認",
  aide_connection_permissions: "接続の権限の確認",
};

/** 取り消せる書き込み（自動実行。実行後に結果カードを出す）。 */
const AUTO_WRITE_LABELS: Record<string, string> = {
  aide_create_task: "タスクを作成",
  aide_update_task: "タスクを更新",
  aide_complete_task: "タスクを完了",
  aide_reopen_task: "タスクを未完了に戻す",
  aide_skip_task: "タスクをスキップ",
  aide_unskip_task: "タスクのスキップを戻す",
  aide_create_travel: "移動を登録",
  aide_create_event: "予定を作成",
  aide_update_event: "予定を更新",
  aide_create_issue: "Issueを作成",
  aide_aircon_control: "エアコンを操作",
};

const KNOWN: Record<string, string> = { ...READ_LABELS, ...AUTO_WRITE_LABELS };
const KNOWN_KEYS = Object.keys(KNOWN).sort((a, b) => b.length - a.length);

export const PROPOSE_TOOL_SUFFIX = /(^|_)morrow_propose_action$/;

/** Hermesは名前に `mcp_<サーバー>_` を付けることがあるので、既知の名前を末尾で照合する。知らなければ null。 */
export function knownToolKey(name: string | undefined | null): string | null {
  if (!name) return null;
  for (const key of KNOWN_KEYS) {
    if (name === key || name.endsWith(`_${key}`)) return key;
  }
  return null;
}

export function isProposeTool(name: string | undefined | null): boolean {
  return typeof name === "string" && PROPOSE_TOOL_SUFFIX.test(name);
}

export function isAutoWriteTool(name: string | undefined | null): boolean {
  const key = knownToolKey(name);
  return key !== null && key in AUTO_WRITE_LABELS;
}

/** 画面の表示名。 */
export function toolLabel(name: string | undefined | null): string {
  const key = knownToolKey(name);
  return key ? KNOWN[key] : "その他の操作";
}

/** 結果カードに出す引数の項目名。ここに無い項目（冪等キー・version・ID類）は出さない。 */
const ARG_LABELS: Record<string, string> = {
  title: "件名",
  name: "名称",
  date: "日付",
  startDate: "開始日",
  endDate: "終了日",
  dueDate: "期限",
  startTime: "開始",
  endTime: "終了",
  time: "時刻",
  allDay: "終日",
  location: "場所",
  destination: "行き先",
  origin: "出発地",
  memo: "メモ",
  note: "メモ",
  description: "内容",
  body: "内容",
  status: "状態",
  mode: "モード",
  temperature: "設定温度",
  tentative: "仮の予定",
};

export type ArgLine = { label: string; value: string };

const VALUE_LIMIT = 80;

function show(value: unknown): string | null {
  if (typeof value === "string") {
    const flat = value.replace(/\s+/g, " ").trim();
    if (flat === "") return null;
    return flat.length > VALUE_LIMIT ? `${flat.slice(0, VALUE_LIMIT)}…` : flat;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "はい" : "いいえ";
  return null;
}

/** 道具の引数を、結果カードの「何をどう変えたか」の行へ。JSON文字列で届く場合も読む。最大6行。 */
export function argLines(rawArgs: unknown): ArgLine[] {
  let args: unknown = rawArgs;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      return [];
    }
  }
  if (typeof args !== "object" || args === null || Array.isArray(args)) return [];
  const lines: ArgLine[] = [];
  for (const [key, label] of Object.entries(ARG_LABELS)) {
    const value = show((args as Record<string, unknown>)[key]);
    if (value !== null) lines.push({ label, value });
    if (lines.length >= 6) break;
  }
  return lines;
}

/** 道具の結果が失敗に見えるか。形が分からないときは false（成功扱いで赤を出さない）。 */
export function resultFailed(result: unknown): boolean {
  let value: unknown = result;
  if (typeof result === "string") {
    try {
      value = JSON.parse(result);
    } catch {
      return /^error\b/i.test(result.trim());
    }
  }
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.isError === true || record.ok === false || (typeof record.error === "string" && record.error !== "");
}
