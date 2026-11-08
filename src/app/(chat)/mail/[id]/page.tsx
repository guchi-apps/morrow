import Link from "next/link";
import { redirect } from "next/navigation";

import { MailBody } from "@/components/mail/mail-body";
import { MailDetailActions } from "@/components/mail/mail-detail-actions";
import { mailFullTime, sizeLabel } from "@/components/mail/mail-format";
import { getCurrentUser } from "@/lib/auth-user";
import { jstTimeLabel } from "@/lib/day-key";
import { getMail, listMail } from "@/lib/mail/aide-client";
import { MAIL_FAILURE_MESSAGES, isMailMessageId } from "@/lib/mail/contract";
import { neededTriages } from "@/lib/mail/triage";
import { isInternalPath } from "@/lib/safe-path";

export const dynamic = "force-dynamic";

export const metadata = { title: "メール" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string }>;
};

/** 戻り先は一覧（`/mail…`）だけを受け付ける。外から与えられる値なので `isInternalPath()` も通す。 */
function safeBack(value: string | undefined): string {
  return value && value.startsWith("/mail") && isInternalPath(value) ? value : "/mail";
}

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
  const back = safeBack(query.back);

  const result = isMailMessageId(id) ? await getMail(user, id) : ({ ok: false, kind: "not_found", message: null } as const);
  // 本文の応答にはラベルの名前が無いので、ラベルを扱える取得元のときだけ一覧から名前を引く
  const labels = result.ok && result.value.supportsLabels ? await listMail(user, {}) : null;
  const triage = result.ok ? (await neededTriages(user.id, [id])).get(id) : undefined;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-3.5 px-3.5 py-4 md:px-7 md:py-6">
        <Link href={back} className="self-start text-xs text-accent hover:underline">
          ← 一覧へ戻る
        </Link>

        {!result.ok ? (
          <p role="alert" className="rounded-[10px] border border-danger/30 bg-danger-surface px-3.5 py-2.5 text-xs leading-relaxed text-danger">
            {MAIL_FAILURE_MESSAGES[result.kind]}
          </p>
        ) : (
          (() => {
            const { message, supportsLabels } = result.value;
            return (
              <>
                <MailDetailActions
                  id={message.id}
                  unread={message.unread}
                  starred={message.starred}
                  inInbox={message.labelIds.includes("INBOX")}
                  inTrash={message.labelIds.includes("TRASH")}
                  labelIds={message.labelIds}
                  labels={labels?.ok ? labels.value.labels : []}
                  supportsLabels={supportsLabels}
                  back={back}
                />

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
                          <dd>{message.account}</dd>
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
