/**
 * AIDEのメールAPI（`/api/mail/*`。guchi-apps/aide の README「Morrow向けのメールAPI（#795）」）の契約（#683）。
 *
 * **Prismaにもネットワークにも触れない純粋なモジュール**で、クライアントコンポーネントからもimportする
 * （型・表示名・操作の一覧）。応答の検証と本人照合はここに閉じ、`test/mail-contract.test.ts` が固定する。
 *
 * **AIDEのトークンが表すのは「Morrowのサーバー」で、利用者ではない。** 持ち主本人かどうかは、応答の `owner`
 * （持ち主のメールアドレス。AIDEが小文字にして返す）とログイン中の人のメールを `isMailOwner()` で照合して決める。
 */

/** 一覧の表示（AIDEの `MAIL_VIEWS` と同じキー）。 */
export const MAIL_VIEWS = [
  { key: "inbox", label: "受信トレイ" },
  { key: "unread", label: "未読" },
  { key: "starred", label: "スター" },
  { key: "all", label: "すべて" },
  { key: "trash", label: "ゴミ箱" },
] as const;

export type MailViewKey = (typeof MAIL_VIEWS)[number]["key"];

export function isMailViewKey(value: unknown): value is MailViewKey {
  return typeof value === "string" && MAIL_VIEWS.some((view) => view.key === value);
}

/** 整理の操作（AIDEの `MAIL_ACTIONS` と同じ。元に戻せるものだけ）。 */
export const MAIL_ACTIONS = [
  "read",
  "unread",
  "archive",
  "inbox",
  "star",
  "unstar",
  "trash",
  "untrash",
  "label-add",
  "label-remove",
] as const;

export type MailAction = (typeof MAIL_ACTIONS)[number];

export function isMailAction(value: unknown): value is MailAction {
  return typeof value === "string" && (MAIL_ACTIONS as readonly string[]).includes(value);
}

export const MAIL_ACTION_DONE: Record<MailAction, string> = {
  read: "既読にしました",
  unread: "未読にしました",
  archive: "アーカイブしました",
  inbox: "受信トレイへ戻しました",
  star: "スターを付けました",
  unstar: "スターを外しました",
  trash: "ゴミ箱へ移動しました（ゴミ箱から戻せます）",
  untrash: "ゴミ箱から戻しました",
  "label-add": "ラベルを付けました",
  "label-remove": "ラベルを外しました",
};

/** 1回の操作で指定できる件数の上限（AIDEの `MAX_BATCH`）。 */
export const MAIL_ACTION_MAX_IDS = 100;

/** AIDEの `isMessageId()` と同じ形。外から来たIDはこれを通してからAIDEへ渡す。 */
export function isMailMessageId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_.~-]{1,320}$/.test(value);
}

/** AIDEの `isLabelId()` と同じ形。 */
export function isMailLabelId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_~-]{1,220}$/.test(value);
}

/** 次のページの鍵。形はAIDE任せだが、URLへ載せるので長さと文字を絞る。 */
export function isMailPageToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,700}$/.test(value);
}

/** 複数アカウント時のアカウント。`key` は `acct` に渡す鍵、`name` は画面に出す名前（利用者が決める値）。 */
export type MailAccount = { key: string; name: string };

/** AIDEの `main` 予約の鍵と、複数アカウント時にIDへ付く接頭辞の区切り（AIDEの `mail-accounts.ts`）。 */
export const MAIN_ACCOUNT_KEY = "main";
const ACCOUNT_KEY_PATTERN = /^[a-z0-9]{1,12}$/;

export function isMailAccountKey(value: unknown): value is string {
  return typeof value === "string" && ACCOUNT_KEY_PATTERN.test(value);
}

/**
 * メッセージID・ラベルIDの先頭 `<鍵>~` からアカウントの鍵を取り出す。**行とラベルで同じ関数を通す**。
 * 複数アカウント時はメインも `main~` が付く。接頭辞が無い（単一アカウントの構成）・鍵の形でない値は null。
 * Gmailのシステムラベル（`INBOX` など）は大文字なので鍵とみなされない。
 */
export function mailAccountKeyOf(id: string): string | null {
  const index = id.indexOf("~");
  if (index <= 0) return null;
  const key = id.slice(0, index);
  return isMailAccountKey(key) ? key : null;
}

/** 選んだメールが2つ以上のアカウントにまたがっているか（AIDEは1件も変更せず400で断る）。 */
export function spansMailAccounts(ids: string[]): boolean {
  return new Set(ids.map((id) => mailAccountKeyOf(id))).size > 1;
}

/** チップ・タブ・丸印の色の種類。鍵だけで決める（表示名・出現順に依存しない）。 */
export const MAIL_ACCOUNT_TONES = ["coral", "blue", "teal", "violet"] as const;
export type MailAccountTone = (typeof MAIL_ACCOUNT_TONES)[number];

/** 鍵で固定する色（#760・#789）。灰寄りの色同士は8pxの丸で見分けられなかったので、色相の離れた色だけを使う。 */
const FIXED_ACCOUNT_TONES: Record<string, MailAccountTone> = {
  [MAIN_ACCOUNT_KEY]: "coral",
  formal: "blue",
  sub: "teal",
};

export function mailAccountTone(key: string): MailAccountTone {
  if (Object.hasOwn(FIXED_ACCOUNT_TONES, key)) return FIXED_ACCOUNT_TONES[key]!;
  // 固定していない鍵は紫（4色目）。アカウントが4つ以上になったら固定の表へ足す
  return "violet";
}

/**
 * 表示中の行から、アカウントの鍵と名前の組を推定する（AIDEが `accounts` を返さない版のため）。
 * 鍵が取れる行（複数アカウントの構成）だけが対象。行が1通も無いアカウントは出てこない。
 */
export function inferMailAccounts(messages: Pick<MailSummary, "id" | "account">[]): MailAccount[] {
  const found = new Map<string, string>();
  for (const message of messages) {
    const key = mailAccountKeyOf(message.id);
    if (key && !found.has(key)) found.set(key, message.account ?? key);
  }
  return [...found].map(([key, name]) => ({ key, name })).sort((a, b) => (a.key === MAIN_ACCOUNT_KEY ? -1 : b.key === MAIN_ACCOUNT_KEY ? 1 : a.key.localeCompare(b.key)));
}

export type MailLabel = { id: string; name: string; type: "system" | "user" };

export type MailSummary = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  /** 受信日時（エポックミリ秒）。取れなければ null。 */
  receivedAt: number | null;
  labelIds: string[];
  unread: boolean;
  starred: boolean;
  /** 複数アカウントのときの、届いたアカウントの表示名。 */
  account?: string;
};

export type MailAttachment = { filename: string; mimeType: string; size: number };

export type MailDetail = MailSummary & {
  to: string;
  cc: string;
  html: string | null;
  text: string | null;
  attachments: MailAttachment[];
};

export type MailListPage = {
  owner: string;
  supportsLabels: boolean;
  /** 一部のアカウントが読めなかった。`messages` に欠落がある（#801）。 */
  partial: boolean;
  failedAccounts: string[];
  /** AIDEが返すアカウントの一覧（任意。無い版のAIDEでは null）。あれば行からの推定より優先する。 */
  accounts: MailAccount[] | null;
  labels: MailLabel[];
  messages: MailSummary[];
  nextPageToken: string | null;
  resultSizeEstimate: number;
};

export type MailMessageResult = { owner: string; supportsLabels: boolean; message: MailDetail };

export type MailActionResult = { owner: string; count: number };

/** AIDEの失敗の種類（`error`）。読めない値は `failed` へ寄せる。 */
export type MailFailureKind =
  | "unconfigured"
  | "unauthorized"
  | "not_found"
  | "failed"
  | "invalid_request"
  | "locked"
  | "not_owner"
  | "unreachable";

export const MAIL_FAILURE_MESSAGES: Record<MailFailureKind, string> = {
  unconfigured: "メールの取得が設定されていません（AIDEの設定、またはMorrowとAIDEの共有トークンが未登録です）。",
  unauthorized: "AIDEに接続を断られました（共有トークンの不一致）。",
  not_found: "メールが見つかりませんでした（削除・移動された可能性があります）。",
  failed: "メールを取得できませんでした（AIDEからGmail・IMAPへ届かないか、応答が不正です）。",
  invalid_request: "操作できませんでした。",
  locked: "AIDEへの試行が続いたため、しばらく受け付けられません。時間をおいてください。",
  not_owner: "このメールボックスの持ち主ではないため、表示・操作できません。",
  unreachable: "AIDEに接続できませんでした。時間をおいて読み込み直してください。",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * ログイン中の人がメールボックスの持ち主本人か。**どちらかが空なら偽**（メールの無い利用者・
 * ownerの欠けた応答を本人扱いしない）。大文字小文字と前後の空白だけを均す。
 */
export function isMailOwner(owner: string | null | undefined, userEmail: string | null | undefined): boolean {
  const a = (owner ?? "").trim().toLowerCase();
  const b = (userEmail ?? "").trim().toLowerCase();
  return a !== "" && a === b;
}

function parseSummary(value: unknown): MailSummary | null {
  if (!isRecord(value) || !isMailMessageId(value.id)) return null;
  const receivedAt = typeof value.receivedAt === "number" && Number.isFinite(value.receivedAt) ? value.receivedAt : null;
  const labelIds = strings(value.labelIds);
  return {
    id: value.id,
    threadId: str(value.threadId),
    from: str(value.from),
    subject: str(value.subject),
    snippet: str(value.snippet),
    receivedAt,
    labelIds,
    unread: value.unread === true,
    starred: value.starred === true,
    ...(typeof value.account === "string" && value.account !== "" ? { account: value.account } : {}),
  };
}

function parseLabel(value: unknown): MailLabel | null {
  if (!isRecord(value) || !isMailLabelId(value.id) || typeof value.name !== "string") return null;
  return { id: value.id, name: value.name, type: value.type === "system" ? "system" : "user" };
}

function parseAccounts(value: unknown): MailAccount[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter(isRecord)
    .filter((a) => isMailAccountKey(a.key) && typeof a.name === "string")
    .map((a) => ({ key: a.key as string, name: a.name as string }));
}

/** 一覧の応答。形が違えば null（呼び出し側は `failed` として扱う）。壊れた行だけは落とす。 */
export function parseMailListResponse(json: unknown): MailListPage | null {
  if (!isRecord(json) || json.ok !== true || typeof json.owner !== "string" || !Array.isArray(json.messages)) return null;
  const failedAccounts = strings(json.failedAccounts);
  return {
    owner: json.owner,
    supportsLabels: json.supportsLabels === true,
    // partial が立っていなくても、failedAccounts が載っていれば欠落ありとして扱う（取りこぼしを「無い」と読ませない）
    partial: json.partial === true || failedAccounts.length > 0,
    failedAccounts,
    accounts: parseAccounts(json.accounts),
    labels: Array.isArray(json.labels) ? json.labels.map(parseLabel).filter((l): l is MailLabel => l !== null) : [],
    messages: json.messages.map(parseSummary).filter((m): m is MailSummary => m !== null),
    nextPageToken: isMailPageToken(json.nextPageToken) ? json.nextPageToken : null,
    resultSizeEstimate: typeof json.resultSizeEstimate === "number" ? json.resultSizeEstimate : 0,
  };
}

export function parseMailMessageResponse(json: unknown): MailMessageResult | null {
  if (!isRecord(json) || json.ok !== true || typeof json.owner !== "string" || !isRecord(json.message)) return null;
  const summary = parseSummary(json.message);
  if (!summary) return null;
  const raw = json.message;
  const attachments = Array.isArray(raw.attachments)
    ? raw.attachments.filter(isRecord).map((a) => ({
        filename: str(a.filename),
        mimeType: str(a.mimeType),
        size: typeof a.size === "number" ? a.size : 0,
      }))
    : [];
  return {
    owner: json.owner,
    supportsLabels: json.supportsLabels === true,
    message: {
      ...summary,
      to: str(raw.to),
      cc: str(raw.cc),
      html: typeof raw.html === "string" ? raw.html : null,
      text: typeof raw.text === "string" ? raw.text : null,
      attachments,
    },
  };
}

export function parseMailActionResponse(json: unknown): MailActionResult | null {
  if (!isRecord(json) || json.ok !== true || typeof json.owner !== "string") return null;
  return { owner: json.owner, count: typeof json.count === "number" ? json.count : 0 };
}

/** 失敗の応答の `error` と `message`（拒否の理由。複数アカウントにまたがる等）。 */
export function parseMailFailure(json: unknown, status: number): { kind: MailFailureKind; message: string | null } {
  const error = isRecord(json) ? json.error : undefined;
  const message = isRecord(json) && typeof json.message === "string" && json.message !== "" ? json.message : null;
  const known: MailFailureKind[] = ["unconfigured", "unauthorized", "not_found", "failed", "invalid_request", "locked"];
  const kind = known.find((k) => k === error);
  if (kind) return { kind, message };
  if (status === 404) return { kind: "not_found", message };
  if (status === 401) return { kind: "unauthorized", message };
  if (status === 503) return { kind: "unconfigured", message };
  if (status === 400) return { kind: "invalid_request", message };
  return { kind: "failed", message };
}

/**
 * メール本文をスクリプトの動かない枠（`<iframe sandbox srcdoc>`）へ入れる文書（AIDEの `emailSrcdoc()` と同じ考え方）。
 *
 * - 枠の `sandbox` に `allow-scripts`・`allow-same-origin` を付けない（呼び出し側）＝スクリプトは動かず、MorrowのCookieにも触れない
 * - 内側のCSPで外部の読み込みを既定で止める。画像だけは「画像を表示」を押したときに `https:` を許す
 * - リンクは新しいタブで開き、リファラを送らない
 */
export function mailSrcdoc(html: string, showImages: boolean): string {
  const img = showImages ? "data: https:" : "data:";
  const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src ${img}; font-src data:`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><meta name="referrer" content="no-referrer"><style>body{margin:12px;font-family:system-ui,sans-serif;color:#131b22;background:#fff;overflow-wrap:anywhere}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`;
}

/** 本文に外部画像が含まれているか（「画像を表示」を出すかの判断）。 */
export function hasRemoteImages(html: string): boolean {
  return /<img[^>]+src\s*=\s*["']?\s*https?:/i.test(html) || /url\(\s*["']?https?:/i.test(html);
}

/** 差出人の表示名（`"名前" <addr>` の名前。無ければアドレス）。 */
export function senderName(from: string): string {
  const match = /^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/.exec(from);
  const name = match?.[1]?.trim();
  return name || from.trim() || "（差出人不明）";
}
