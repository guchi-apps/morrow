/**
 * 通知の種類（#488）。**クライアントからもimportする**ので、Prismaやweb-pushは持ち込まない
 * （DBを引く側は `kinds-server.ts`）。
 *
 * キーは `NotificationLog.kind` と同じ文字列にしてある。オフにした種類のキーを
 * `User.pushDisabledKinds` へカンマ区切りで持つ（空文字＝全部オン）。種類ごとに列を足すと、
 * 種類が増えるたびにマイグレーションが要る。
 */

export const PUSH_KINDS = [
  "scheduled-push",
  "mail-notice",
  "hermes-approval",
] as const;

export type PushKind = (typeof PUSH_KINDS)[number];

export type PushKindInfo = {
  label: string;
  hint: string;
  when: string;
  /** 見本の通知。本物と同じタイトル・遷移先にして、届き方を確かめられるようにする。 */
  sample: { title: string; body: string; url: string };
};

export const PUSH_KIND_INFO: Record<PushKind, PushKindInfo> = {
  "scheduled-push": {
    label: "定時のお知らせ",
    hint: "ニュースの画面で決めた曜日・時刻に、ニュースの見出しを届けます。",
    when: "ニュースの画面で設定した時刻",
    sample: {
      title: "定時のお知らせ（ニュース）",
      body: "（見本）見出しがここに並びます。",
      url: "/topics",
    },
  },
  // 必要なメールのお知らせ（#683）。オフの間は新着の判定（Codex）も走らせない。
  "mail-notice": {
    label: "必要なメール",
    hint: "新着メールのうち、メールの画面で決めた基準で「必要」と判定したものを知らせます。",
    when: "15分ごとの新着確認と「いま確認」",
    sample: {
      title: "必要なメール（1通）",
      body: "（見本）差出人：件名 — 理由がここに並びます。",
      url: "/mail",
    },
  },
  // Hermesの提案の確認待ち（#794）。押すとチャットを開くだけで、通知から直接は承認しない（値を見ずに押せてしまうため）。
  // 「返答が届きました」は出さない（画面を閉じると中断するため）。
  "hermes-approval": {
    label: "チャットの確認待ち",
    hint: "チャットでHermesが出した提案のうち、あなたの確認が要るもの（取り消せない操作）があるときに知らせます。押すとチャットが開きます。",
    when: "Hermesが確認待ちの提案を出したとき",
    sample: {
      title: "確認待ちがあります",
      body: "（見本）チャットを開いて、内容を確かめてください。",
      url: "/chat",
    },
  },
};

export function isPushKind(value: unknown): value is PushKind {
  return typeof value === "string" && (PUSH_KINDS as readonly string[]).includes(value);
}

/** 保存された文字列を、オフの種類の集合へ。知らない名前は捨てる（書き換えられた値で壊れない）。 */
export function parseDisabledKinds(stored: string | null | undefined): Set<PushKind> {
  const result = new Set<PushKind>();
  for (const part of (stored ?? "").split(",")) {
    const key = part.trim();
    if (isPushKind(key)) result.add(key);
  }
  return result;
}

/** 並びはPUSH_KINDSの順に揃える（同じ集合なら同じ文字列になる）。 */
export function serializeDisabledKinds(disabled: ReadonlySet<PushKind>): string {
  return PUSH_KINDS.filter((kind) => disabled.has(kind)).join(",");
}
