"use client";

import { useRouter } from "next/navigation";

import { mailAccountKeyOf, type MailLabel } from "@/lib/mail/contract";

/** ユーザーラベルで絞る（#683）。選ぶと `/mail?label=<id>` へ移る。 */
export function MailLabelFilter({ labels, current, account }: { labels: MailLabel[]; current: string | null; account: string | null }) {
  const router = useRouter();
  // 絞り込み中のアカウントのラベルだけ（ラベルIDの接頭辞で見分ける）
  const userLabels = labels.filter((label) => label.type === "user" && (!account || mailAccountKeyOf(label.id) === account));
  if (userLabels.length === 0) return null;

  return (
    <select
      aria-label="ラベルで絞る"
      value={current ?? ""}
      onChange={(event) => router.push(
        event.target.value
          ? `/mail?label=${encodeURIComponent(event.target.value)}${account ? `&acct=${account}` : ""}`
          : account
            ? `/mail?acct=${account}`
            : "/mail",
      )}
      className="max-w-[40%] shrink-0 rounded-[9px] border border-border bg-surface px-2.5 py-1.5 text-xs"
    >
      <option value="">ラベル</option>
      {userLabels.map((label) => (
        <option key={label.id} value={label.id}>
          {label.name}
        </option>
      ))}
    </select>
  );
}
