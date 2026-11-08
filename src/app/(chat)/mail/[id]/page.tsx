import { redirect } from "next/navigation";

import { MailAccountChip } from "@/components/mail/mail-account-chip";
import { MailBackLink } from "@/components/mail/mail-back-link";
import { MailAnalysis } from "@/components/mail/mail-analysis";
import { MailBody } from "@/components/mail/mail-body";
import { MailFlowRecords } from "@/components/mail/mail-flow-records";
import { MailDetailActions } from "@/components/mail/mail-detail-actions";
import { mailFullTime, sizeLabel } from "@/components/mail/mail-format";
import { getCurrentUser } from "@/lib/auth-user";
import { jstTimeLabel } from "@/lib/day-key";
import { getMail } from "@/lib/mail/aide-client";
import { safeMailBack } from "@/lib/mail/back-path";
import { MAIL_FAILURE_MESSAGES, isMailMessageId, mailAccountKeyOf } from "@/lib/mail/contract";
import { flowRowStates } from "@/lib/mail/flow-record-core";
import { flowRecordsFor } from "@/lib/mail/flow-record";
import { neededTriages } from "@/lib/mail/triage";

export const dynamic = "force-dynamic";

export const metadata = { title: "メール" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string }>;
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

/**
 * メールの本文（#683）。AIDEの `/api/mail/messages/<id>` から取り、**持ち主本人のときだけ**出す（`getMail()`）。
 * 通知から開いたときもここへ来る（1通なら `/mail/<id>`）。
 */
export default async function MailMessagePage({ params, searchParams }: Props) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const [{ id: rawId }, query] = await Promise.all([params, searchParams]);
  const id = safeDecode(rawId);
  const back = safeMailBack(query.back);

  // 本文と判定は同時に取る（#699。以前は本文→一覧→判定の順に1本ずつ待っていた）。
  // 判定はDBだけなので、本文が取れなかった回に引いても害は無い。
  const [result, triages, flowRecords] = await Promise.all([
    isMailMessageId(id) ? getMail(user, id) : Promise.resolve({ ok: false, kind: "not_found", message: null } as const),
    neededTriages(user.id, [id]),
    flowRecordsFor(user.id, id),
  ]);
  const flowStates = flowRowStates(flowRecords);
  const triage = result.ok ? triages.get(id) : undefined;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-3.5 px-3.5 py-4 md:px-7 md:py-6">
        <MailBackLink href={back} />

        {!result.ok ? (
          <p role="alert" className="rounded-[10px] border border-danger/30 bg-danger-surface px-3.5 py-2.5 text-xs leading-relaxed text-danger">
            {MAIL_FAILURE_MESSAGES[result.kind]}
          </p>
        ) : (
          (() => {
            const { message } = result.value;
            return (
              <>
                <MailDetailActions
                  id={message.id}
                  unread={message.unread}
                  inInbox={message.labelIds.includes("INBOX")}
                  inTrash={message.labelIds.includes("TRASH")}
                  back={back}
                />

                {/* 開いた時点で要約と提案を自動で取る（#766）。メールが変わったら作り直す */}
                <MailAnalysis
                  key={message.id}
                  id={message.id}
                  // 「登録済み」の印の材料（#750の控え）。サブスクの「一覧を開いた」は登録の確認にならないので含めない。確認待ちも含めない
                  registeredKinds={flowStates.registeredKinds}
                  // 家計簿の確認待ち・取り込み済みは、確定したか分からない。「登録済み」にしない（#821）
                  receiptState={flowStates.receiptState}
                />

                <MailFlowRecords records={flowRecords.map((r) => ({ ...r, createdAt: flowTimeLabel(r.createdAt) }))} />

                {triage && (
                  <p className="rounded-[10px] bg-accent-surface px-3 py-2.5 text-xs leading-relaxed">
                    <b className="text-accent">
                      {triage.notifiedAt ? `お知らせ済み（${jstTimeLabel(triage.notifiedAt)}）` : "必要と判定（通知は届けられませんでした）"}
                    </b>
                    {triage.reason && <>　{triage.reason}</>}
                  </p>
                )}

                <article className="overflow-hidden rounded-xl border border-border bg-surface">
                  <header className="flex flex-col gap-2 px-4 py-4">
                    <h2 className="text-[1.0625rem] font-bold leading-snug">{message.subject || "（件名なし）"}</h2>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                      <dt className="text-muted">差出人</dt>
                      <dd className="break-all">{message.from}</dd>
                      {message.to && (
                        <>
                          <dt className="text-muted">宛先</dt>
                          <dd className="break-all">{message.to}</dd>
                        </>
                      )}
                      {message.cc && (
                        <>
                          <dt className="text-muted">Cc</dt>
                          <dd className="break-all">{message.cc}</dd>
                        </>
                      )}
                      <dt className="text-muted">日時</dt>
                      <dd>{mailFullTime(message.receivedAt)}</dd>
                      {message.account && (
                        <>
                          <dt className="text-muted">アカウント</dt>
                          <dd>
                            <MailAccountChip accountKey={mailAccountKeyOf(message.id) ?? message.account} name={message.account} />
                          </dd>
                        </>
                      )}
                    </dl>
                  </header>
                  <div className="border-t border-border">
                    <MailBody html={message.html} text={message.text} />
                  </div>
                  {message.attachments.length > 0 && (
                    <p className="border-t border-border px-4 py-2.5 text-xs text-muted">
                      添付:{" "}
                      {message.attachments
                        .map((file) => `${file.filename || "（名前なし）"}（${sizeLabel(file.size)}）`)
                        .join("、")}
                      　※ファイル名のみ表示
                    </p>
                  )}
                </article>
              </>
            );
          })()
        )}
      </div>
    </div>
  );
}

/** 登録日時（日本時間）。「11/8 14:32」の形。 */
function flowTimeLabel(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}
