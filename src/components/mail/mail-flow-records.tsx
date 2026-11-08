import { FLOW_KIND_META, FLOW_STATUS_LABELS, type FlowRecordStatus } from "@/lib/mail/flow-record-core";

/**
 * このメールから登録した内容（#750）。登録時点の要約で、台帳側で後から変えても追従しない。
 * 記録が無いときは何も出さない。
 */
export function MailFlowRecords({ records }: { records: { kind: string; summary: string; status: string; createdAt: string }[] }) {
  if (records.length === 0) return null;
  return (
    <section aria-label="このメールから登録した内容" className="rounded-[10px] bg-accent-surface px-3 py-2.5 text-xs leading-relaxed">
      <b className="text-accent">✅ このメールから登録した内容</b>
      <ul className="mt-1 flex flex-col">
        {records.map((record, index) => {
          const meta = FLOW_KIND_META[record.kind as keyof typeof FLOW_KIND_META];
          const status = FLOW_STATUS_LABELS[record.status as FlowRecordStatus];
          return (
            <li key={index} className="border-t border-border/60 py-1 first:border-t-0">
              <span>
                {meta ? `${meta.icon} ${meta.label}` : record.kind}　{record.summary}
              </span>
              <br />
              <span className="text-[0.6875rem] text-muted">
                {record.createdAt}　{status ?? record.status}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-[0.6875rem] text-muted">登録時点の内容です。あとから台帳側で変えても、ここは更新されません。</p>
    </section>
  );
}
