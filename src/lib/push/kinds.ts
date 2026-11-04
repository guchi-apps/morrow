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
    hint: "話題の画面で決めた曜日・時刻に、ニュースの見出しを届けます。",
    when: "話題の画面で設定した時刻",
    sample: {
      title: "定時のお知らせ（話題）",
      body: "（見本）見出しがここに並びます。",
      url: "/topics",
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
