"use client";

import { useRouter } from "next/navigation";

import type { MailLabel } from "@/lib/mail/contract";

/** ユーザーラベルで絞る（#683）。選ぶと `/mail?label=<id>` へ移る。 */
export function MailLabelFilter({ labels, current }: { labels: MailLabel[]; current: string | null }) {
  const router = useRouter();
  const userLabels = labels.filter((label) => label.type === "user");
  if (userLabels.length === 0) return null;

  return (
    <select
      aria-label="ラベルで絞る"
      value={current ?? ""}
      onChange={(event) => router.push(event.target.value ? `/mail?label=${encodeURIComponent(event.target.value)}` : "/mail")}
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
