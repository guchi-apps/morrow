"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { linkTargetLabel, type CalendarChoice } from "@/lib/mail/link-core";
import { FLOW_APP_LINKS, linkAppUrl, taskOpenUrl, taskOpensInApp } from "@/lib/mail/app-links";
import { RECEIVED_DATE_NOTE, itemsTotal, paymentBlocker } from "@/lib/mail/payment-receipt";
import type { PaymentFields, Suggestion, SuggestKind } from "@/lib/mail/suggest-core";
import { ASSET_MANAGER_SUBSCRIPTIONS_URL, subscriptionLink } from "@/lib/mail/subscription-link";
import type { RegisteredSubscription, SubscriptionMatch } from "@/lib/mail/subscription-match-core";
import { registeredDetails, registeredSummary } from "@/lib/mail/subscription-match-view";
import { CARRIERS, CARRIER_LABELS, trackingBlocker, trackingUrl } from "@/lib/mail/tracking-link";
import { cn } from "@/lib/utils";

/**
 * 提案を押したときのハーフモーダル（#766）。AIが読み取った値を入れた入力欄を出し、直して登録できる。
 * 登録の経路は以前のカード（#689）と同じ `/api/mail/flow/apply`（サーバーが値を検証し直す）。
 * 下の「○○を開く」は記録の持ち主のアプリを開くだけで、入力値は引き継がない（サブスクは主ボタンが値を載せて開く。#709）。
 * **家計簿は入力欄を持たない**（#781）。読み取った値を見せるだけで、主ボタンが確認待ちのレシートを作ってAsset Managerのレシート編集画面を開く。
 * 品目・カテゴリ・メモ・確定はAsset Managerで行う。
 * 型だけをimportする（`suggest-core.ts` はサーバー専用の依存を持つため、値は読み込まない）。
 */

export const KIND_META: Record<SuggestKind, { icon: string; title: string; run: string }> = {
  payment: { icon: "🧾", title: "家計簿へ取り込む", run: "Asset Managerで入力する ↗" },
  subscription: { icon: "🔁", title: "サブスクを確認する（Asset Managerで）", run: "Asset Managerのサブスク一覧を開く ↗" },
  task: { icon: "📌", title: "タスクにする", run: "タスクを作る" },
  event: { icon: "📅", title: "予定にする", run: "予定を登録する" },
  tracking: { icon: "📦", title: "発送状況を追跡する", run: "追跡ページを開く ↗" },
  link: { icon: "🔗", title: "既存の予定・タスクに紐づける", run: "紐づける" },
};

/** `href` は家計簿だけ: 作った（取り込み済みの）レシートの編集画面。自動で開けなかったときのリンクにする（#781）。 */
import type { ReceiptState } from "@/lib/mail/flow-record-core";
export type CardResult = { text: string; error: boolean; done: boolean; /** 家計簿の確認待ち（pending）・取り込み済み（duplicate）。確定したかは分からないので、doneのまま行は「登録済み」にしない（#821） */ receipt?: ReceiptState; href?: string };

type Props = {
  card: Suggestion | null;
  recommended: boolean;
  outcome: CardResult | undefined;
  /** サブスク提案のAsset Managerとの照合結果（#884）。未取得はundefined。 */
  match?: SubscriptionMatch;
  /** 予定の保存先の候補（#908）。null は未取得・取得できなかった。 */
  calendars?: CalendarChoice[] | null;
  running: boolean;
  onEdit: (kind: SuggestKind, key: string, value: string) => void;
  onRun: (card: Suggestion) => void;
  onOpenSubscription: (card: Suggestion) => void;
  onClose: () => void;
};

// date・time はiOSのネイティブ表示で他より大きく描かれるので、高さ・最小幅・appearance を揃える（#908）
const input = "box-border h-10 w-full min-w-0 appearance-none rounded-lg border border-border bg-background px-2.5 py-2 text-sm [&::-webkit-date-and-time-value]:text-left";
const textarea = "w-full min-w-0 rounded-lg border border-border bg-background px-2.5 py-2 text-sm";

const yen = (value: number) => `${value.toLocaleString("ja-JP")}円`;

/** 家計簿の読み取り結果（入力欄ではない。#781）。 */
function PaymentSummary({ fields }: { fields: PaymentFields }) {
  const total = fields.amount ?? itemsTotal(fields.items);
  const when = fields.date ? `${fields.date.replaceAll("-", "/")}${fields.time ? ` ${fields.time}` : ""}` : null;
  const dim = "text-muted";
  return (
    <div className="flex flex-col gap-2.5">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[0.8125rem]">
        <dt className="text-xs text-muted">支払先</dt>
        <dd className={cn("min-w-0 break-words", !fields.place && dim)}>{fields.place ?? "読み取れませんでした"}</dd>
        <dt className="text-xs text-muted">日時</dt>
        <dd className={cn(!when && "text-danger")}>
          {when ?? "読み取れませんでした"}
          {when && fields.dateEstimated && <span className="block text-[0.6875rem] text-muted">{RECEIVED_DATE_NOTE}</span>}
        </dd>
        {fields.usage && (
          <>
            <dt className="text-xs text-muted">使用量</dt>
            <dd>{fields.usage}</dd>
          </>
        )}
      </dl>
      <div className="rounded-[10px] border border-border px-2.5 py-2 text-[0.8125rem]">
        {fields.items.length > 0 ? (
          <ul>
            {fields.items.map((item, index) => (
              <li key={index} className="flex justify-between gap-3 py-1">
                <span className="min-w-0 break-words">
                  {item.name}
                  {item.quantity !== null && item.quantity !== 1 && <span className="text-muted">（×{item.quantity}）</span>}
                </span>
                <span className="shrink-0 tabular-nums">{yen(item.amount)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={cn("py-1 break-words", !fields.name && dim)}>{fields.name || "品目を読み取れませんでした"}</p>
        )}
        <p className="mt-1 flex justify-between gap-3 border-t border-border pt-1.5 font-bold">
          <span>合計</span>
          <span className={cn("tabular-nums", total === null && dim)}>
            {total !== null ? yen(total) : fields.originalAmount !== null ? `${fields.originalCurrency} ${fields.originalAmount}（円は未換算）` : "読み取れませんでした"}
          </span>
        </p>
      </div>
      {fields.amount !== null && fields.items.length > 0 && itemsTotal(fields.items) !== fields.amount && (
        <p className="text-[0.6875rem] text-muted">品目の合計（{yen(itemsTotal(fields.items)!)}）が合計と合いません。Asset Managerで直してください。</p>
      )}
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1 text-[0.6875rem] text-muted", className)}>
      {label}
      {children}
    </label>
  );
}

/** 日付＋時刻の任意入力。「未設定にする」で日付と時刻をまとめて空に戻す（#1021） */
function OptionalDateTime({ label, dateKey, timeKey, fields, onEdit }: { label: string; dateKey: string; timeKey: string; fields: Record<string, unknown>; onEdit: (key: string, value: string) => void }) {
  const date = String(fields[dateKey] ?? "");
  const time = String(fields[timeKey] ?? "");
  return (
    <div className="col-span-2 flex min-w-0 flex-col gap-1 text-[0.6875rem] text-muted">
      <div className="flex items-center justify-between">
        <span>{label}</span>
        <button
          type="button"
          disabled={date === "" && time === ""}
          onClick={() => {
            onEdit(dateKey, "");
            onEdit(timeKey, "");
          }}
          className="py-1 text-xs text-accent disabled:text-muted disabled:opacity-60"
        >
          未設定にする
        </button>
      </div>
      <div className="grid grid-cols-[3fr_2fr] gap-2">
        <input type="date" aria-label={`${label}の日付`} className={input} value={date} onChange={(e) => onEdit(dateKey, e.target.value)} />
        <input type="time" aria-label={`${label}の時刻`} className={cn(input, "disabled:opacity-40")} disabled={date === ""} value={date === "" ? "" : time} onChange={(e) => onEdit(timeKey, e.target.value)} />
      </div>
    </div>
  );
}

export function FlowSheet({ card, recommended, outcome, match, calendars, running, onEdit, onRun, onOpenSubscription, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (card && !dialog.open) dialog.showModal();
    if (!card && dialog.open) dialog.close();
  }, [card]);

  const f = (card?.fields ?? {}) as Record<string, string | number | null>;
  const meta = card ? KIND_META[card.kind] : null;
  const app = card ? FLOW_APP_LINKS[card.kind] : null;
  // Asset Managerに同じ項目があるとき（#884）は登録内容を出し、読み取った値の入力欄は参考へ畳む
  // 家計簿の提案も、定期払いとして登録済みなら登録内容を出す（#896。取り込みのボタン・読み取った値はそのまま）
  const found = (card?.kind === "subscription" || card?.kind === "payment") && match?.status === "matched" ? match.matches : null;
  const byAmount = match?.status === "matched" && match.by === "amount";

  return (
    <dialog
      ref={ref}
      aria-label={meta?.title ?? "提案"}
      onClose={onClose}
      // 背景（::backdrop）を押したら閉じる。中身の上の操作はdialog自身が対象にならない
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
      className="flow-sheet fixed inset-x-0 bottom-[var(--keyboard-inset)] top-auto m-0 mx-auto max-h-[min(85dvh,calc(var(--app-height)-1rem))] w-full max-w-[560px] overflow-y-auto rounded-t-[18px] border border-border bg-surface p-0 text-foreground backdrop:bg-black/55"
    >
      {card && meta && app && (
        <div className="flex flex-col gap-3 px-4 pb-[calc(1.25rem+var(--app-bottom-inset))] pt-2">
          <div aria-hidden className="mx-auto h-[5px] w-10 rounded-full bg-border" />
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex flex-wrap items-center gap-2 text-[0.9375rem] font-bold">
              {meta.icon} {meta.title}
              {recommended && <span className="rounded-full bg-accent px-2 py-0.5 text-[0.6875rem] font-bold text-accent-foreground">おすすめ</span>}
            </h2>
            <button type="button" onClick={() => ref.current?.close()} aria-label="閉じる" className="rounded-md px-2 py-1 text-lg leading-none text-muted hover:bg-rail-active">
              ✕
            </button>
          </div>
          <p className="text-[0.6875rem] leading-relaxed text-muted">
            {found && byAmount
              ? `金額（${found[0].amount?.toLocaleString("ja-JP") ?? ""}円）が一致する定期払いがAsset Managerに1件あります。名前は一致していないので、同じものか確かめてください。`
              : found && card.kind === "payment"
              ? "この支払いはAsset Managerに定期払いとして登録されています。家計簿への取り込みは下のボタンから行えます。"
              : found
              ? "Asset Managerに同じ項目が見つかったので、そちらの登録内容を表示しています（読み取った値より優先）。"
              : card.kind === "payment"
              ? "AIが本文から読み取った値です。Asset Managerの画面で直してから確定してください。"
              : card.kind === "link"
              ? "AIが、すでにある予定・タスクとこのメールの関連を見つけました。外れることがあるので、確かめてから紐づけてください。"
              : `AIが本文から読み取った値です。外れることがあるので、確かめてから${card.kind === "subscription" || card.kind === "tracking" ? "開いてください" : "登録してください"}。`}
            {card.reason && <>　理由: {card.reason}</>}
          </p>

          {found && <RegisteredPanel key={found.map((r) => r.id).join(",")} matches={found} />}

          {found && card.kind === "payment" && <p className="-mb-1.5 text-xs font-bold text-muted">メールから読み取った値</p>}
          {card.kind === "payment" && <PaymentSummary fields={card.fields} />}
          {card.kind === "link" && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-[10px] border border-border px-3 py-2.5 text-[0.8125rem]">
              <dt className="text-xs text-muted">種類</dt>
              <dd>{card.fields.kind === "task" ? "✅ タスク" : "📅 予定"}</dd>
              <dt className="text-xs text-muted">題名</dt>
              <dd className="min-w-0 break-words font-semibold">{card.fields.title}</dd>
              <dt className="text-xs text-muted">{card.fields.kind === "task" ? "期限・予定日" : "日付"}</dt>
              <dd>{card.fields.dateText ? card.fields.dateText.replaceAll("-", "/") : "なし"}</dd>
            </dl>
          )}
          {card.kind === "subscription" && match?.status === "error" && <p className="text-[0.6875rem] text-muted">Asset Managerとの照合はできませんでした（登録済みかは未確認）。</p>}

          <div className={cn("grid grid-cols-2 gap-2.5", (card.kind === "payment" || card.kind === "link" || found) && "hidden")}>
            {card.kind === "subscription" && (
              <>
                <Field label="名称" className="col-span-2">
                  <input className={input} value={String(f.name ?? "")} onChange={(e) => onEdit("subscription", "name", e.target.value)} />
                </Field>
                <Field label="金額">
                  <input inputMode="decimal" className={input} value={f.amount ?? ""} onChange={(e) => onEdit("subscription", "amount", e.target.value)} />
                </Field>
                <Field label="通貨">
                  <select className={input} value={String(f.currency)} onChange={(e) => onEdit("subscription", "currency", e.target.value)}>
                    <option value="JPY">円</option>
                    <option value="USD">ドル</option>
                  </select>
                </Field>
                <Field label="周期">
                  <select className={input} value={String(f.cycle)} onChange={(e) => onEdit("subscription", "cycle", e.target.value)}>
                    <option value="MONTHLY">毎月</option>
                    <option value="YEARLY">毎年</option>
                  </select>
                </Field>
                <Field label="請求日">
                  <input inputMode="numeric" className={input} value={f.day ?? ""} onChange={(e) => onEdit("subscription", "day", e.target.value)} />
                </Field>
                <Field label="開始日" className="col-span-2">
                  <input type="date" className={input} value={String(f.startDate ?? "")} onChange={(e) => onEdit("subscription", "startDate", e.target.value)} />
                </Field>
              </>
            )}
            {card.kind === "tracking" && (
              <>
                <Field label="配送会社" className="col-span-2">
                  <select className={input} value={String(f.carrier ?? "")} onChange={(e) => onEdit("tracking", "carrier", e.target.value)}>
                    <option value="">選んでください</option>
                    {CARRIERS.map((c) => (
                      <option key={c} value={c}>
                        {CARRIER_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="追跡番号" className="col-span-2">
                  <input inputMode="text" autoCapitalize="characters" className={input} value={String(f.number ?? "")} onChange={(e) => onEdit("tracking", "number", e.target.value)} />
                </Field>
              </>
            )}
            {card.kind === "task" && (
              <>
                <Field label="タイトル" className="col-span-2">
                  <input className={input} value={String(f.title ?? "")} onChange={(e) => onEdit("task", "title", e.target.value)} />
                </Field>
                <OptionalDateTime label="期限" dateKey="due" timeKey="dueTime" fields={f} onEdit={(key, value) => onEdit("task", key, value)} />
                <OptionalDateTime label="予定日" dateKey="planned" timeKey="plannedTime" fields={f} onEdit={(key, value) => onEdit("task", key, value)} />
                <p className="col-span-2 -mt-1 text-[0.6875rem] text-muted">期限・予定日はどちらも空のままで作れます。時刻は日付を選ぶと入力できます。</p>
                <Field label="メモ" className="col-span-2">
                  <textarea rows={2} className={textarea} value={String(f.memo ?? "")} onChange={(e) => onEdit("task", "memo", e.target.value)} />
                </Field>
              </>
            )}
            {card.kind === "event" && (
              <>
                <Field label="タイトル" className="col-span-2">
                  <input className={input} value={String(f.title ?? "")} onChange={(e) => onEdit("event", "title", e.target.value)} />
                </Field>
                <Field label="開始日">
                  <input type="date" className={input} value={String(f.date ?? "")} onChange={(e) => onEdit("event", "date", e.target.value)} />
                </Field>
                <Field label="開始時刻">
                  <input type="time" className={input} value={String(f.startTime ?? "")} onChange={(e) => onEdit("event", "startTime", e.target.value)} />
                </Field>
                <Field label="終了日（日をまたぐときだけ）">
                  <input type="date" className={input} value={String(f.endDate ?? "")} min={String(f.date ?? "") || undefined} onChange={(e) => onEdit("event", "endDate", e.target.value)} />
                </Field>
                <Field label="終了時刻">
                  <input type="time" className={input} value={String(f.endTime ?? "")} onChange={(e) => onEdit("event", "endTime", e.target.value)} />
                </Field>
                <Field label="場所（任意）" className="col-span-2">
                  <input className={input} maxLength={100} value={String(f.location ?? "")} onChange={(e) => onEdit("event", "location", e.target.value)} />
                </Field>
                <Field label="保存先カレンダー" className="col-span-2">
                  <select className={input} value={String(f.calendarId ?? "")} onChange={(e) => onEdit("event", "calendarId", e.target.value)}>
                    <option value="">既定の保存先（DaySpan）</option>
                    {(calendars ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="メモ" className="col-span-2">
                  <textarea rows={2} className={textarea} value={String(f.memo ?? "")} onChange={(e) => onEdit("event", "memo", e.target.value)} />
                  <span className="text-[0.6875rem] text-muted">メモは現在カレンダーへ登録されません（AIDEの対応待ち）。必要ならDaySpanで追記してください。</span>
                </Field>
              </>
            )}
          </div>

          {card.kind === "payment" ? (
            <PaymentActions card={card} outcome={outcome} running={running} onRun={onRun} fallback={app} />
          ) : card.kind === "tracking" ? (
            <TrackingActions card={card} />
          ) : card.kind === "link" ? (
            <>
              <button type="button" disabled={running || outcome?.done === true} onClick={() => onRun(card)} className={primary}>
                {running ? "紐づけています…" : outcome?.done ? "紐づけ済み" : `この${card.fields.kind === "task" ? "タスク" : "予定"}に紐づける`}
              </button>
              {outcome?.done && (
                <a href={linkAppUrl(card.fields.kind, card.fields.dateText)} target="_blank" rel="noopener noreferrer" className="text-center text-xs text-accent hover:underline">
                  {linkTargetLabel(card.fields)}を開く ↗
                </a>
              )}
              <p className="text-center text-[0.6875rem] text-muted">紐づけはMorrowの控えです。予定・タスクそのものは変わりません。あとから「このメールに紐づけた予定・タスク」で解除できます。</p>
            </>
          ) : card.kind === "subscription" && found ? (
            <>
              <details className="text-xs text-muted">
                <summary className="cursor-pointer">メールから読み取った値（参考）</summary>
                {String(f.name ?? "")}・{f.amount !== null && f.amount !== undefined ? `${f.amount}${f.currency === "USD" ? "ドル" : "円"}` : "金額は読み取れず"}・{f.cycle === "YEARLY" ? "毎年" : "毎月"}
              </details>
              <a href={ASSET_MANAGER_SUBSCRIPTIONS_URL} target="_blank" rel="noopener noreferrer" className="rounded-[10px] bg-accent px-3 py-2.5 text-center text-sm font-bold text-accent-foreground">
                Asset Managerで開く ↗
              </a>
              <p className="text-[0.6875rem] text-muted">表示は読み取り専用です。メールの内容と違うときは、Asset Manager側で直してください（iPhoneのMorrowアプリではAsset Managerアプリで開きます）。</p>
            </>
          ) : card.kind === "subscription" ? (
            <>
              <a
                href={subscriptionLink(card.fields)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => onOpenSubscription(card)}
                className="rounded-[10px] bg-accent px-3 py-2.5 text-center text-sm font-bold text-accent-foreground"
              >
                {meta.run}
              </a>
              <p className="text-[0.6875rem] text-muted">入力欄の内容は引き継がれません。Asset Managerのサブスク画面が開くだけなので（iPhoneのMorrowアプリではAsset Managerアプリで開きます）、登録はAsset Manager側で行ってください。</p>
            </>
          ) : card.kind === "task" && outcome?.done ? (
            <>
              {/* 作成後は「実行済み」ではなくタスクを開く（#1022）。iPhoneの殻はYoteiFlowアプリへ渡す */}
              <a href={taskOpenUrl(card.fields)} target="_blank" rel="noopener noreferrer" className="rounded-[10px] bg-accent px-3 py-2.5 text-center text-sm font-bold text-accent-foreground">
                タスクを開く ↗
              </a>
              <p className="text-center text-[0.6875rem] text-muted">
                {taskOpensInApp(card.fields)
                  ? "タスクの日のカレンダーが開きます（iPhoneのMorrowアプリでは予定フローのアプリで開きます）。"
                  : "日付が無いので、ブラウザでDaySpanのタスク一覧が開きます（アプリでは開きません）。"}
              </p>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={running || outcome?.done === true}
                onClick={() => onRun(card)}
                className="rounded-[10px] bg-accent px-3 py-2.5 text-sm font-bold text-accent-foreground transition-opacity disabled:opacity-50"
              >
                {running ? "実行しています…" : outcome?.done ? "実行済み" : meta.run}
              </button>
              <a href={app.url} target="_blank" rel="noopener noreferrer" className="text-center text-xs text-accent hover:underline">
                {app.label} ↗
              </a>
              <p className="text-center text-[0.6875rem] text-muted">開いても入力値は引き継がれません。</p>
            </>
          )}

          {outcome && (
            <p role={outcome.error ? "alert" : "status"} className={cn("text-xs", outcome.error ? "text-danger" : "text-muted")}>
              {outcome.text}
            </p>
          )}
        </div>
      )}
    </dialog>
  );
}

/** Asset Managerで見つかった登録済みのサブスク（読み取り専用。#884）。候補が複数なら選ぶ。 */
function RegisteredPanel({ matches }: { matches: RegisteredSubscription[] }) {
  const [picked, setPicked] = useState(0);
  const current = matches[picked] ?? matches[0];
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-fair/40 bg-fair-surface px-3 py-2.5 text-[0.8125rem]">
      {matches.length > 1 && (
        <div role="radiogroup" aria-label="候補" className="flex flex-col gap-1">
          {matches.map((r, index) => (
            <button key={r.id} type="button" role="radio" aria-checked={index === picked} onClick={() => setPicked(index)} className={cn("rounded-lg border px-2 py-1 text-left text-xs", index === picked ? "border-accent bg-background font-bold" : "border-border")}>
              {registeredSummary(r)}
            </button>
          ))}
        </div>
      )}
      <p className="flex flex-wrap items-center gap-2 text-base font-bold">
        {current.name}
        {current.statusLabel && <span className="rounded-full bg-background px-2 py-0.5 text-[0.6875rem] font-bold text-fair">{current.statusLabel}</span>}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {registeredDetails(current).map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-xs text-muted">{row.label}</dt>
            <dd className="min-w-0 break-words font-semibold">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** 発送状況の追跡（#972）。番号入りの配送会社のページを新しいタブで開く。検証を通らなければ開けず、理由を出す。 */
function TrackingActions({ card }: { card: Extract<Suggestion, { kind: "tracking" }> }) {
  const { carrier, number } = card.fields;
  const blocker = trackingBlocker(carrier, number);
  const url = trackingUrl(carrier, number);
  const [copied, setCopied] = useState(false);
  return (
    <>
      {blocker && <p className="text-[0.6875rem] text-danger">{blocker}</p>}
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className={primary}>
          {carrier ? CARRIER_LABELS[carrier] : ""}の追跡ページを開く ↗
        </a>
      ) : (
        <span aria-disabled="true" className={cn(primary, "opacity-45")}>
          {KIND_META.tracking.run}
        </span>
      )}
      {number && (
        <button
          type="button"
          className="text-center text-xs text-accent hover:underline"
          onClick={() => {
            void navigator.clipboard?.writeText(number).then(() => setCopied(true)).catch(() => {});
          }}
        >
          {copied ? "番号をコピーしました" : "追跡番号をコピー"}
        </button>
      )}
      <p className="text-center text-[0.6875rem] text-muted">番号を入れた状態で配送会社のサイトが開きます。Morrowには保存しません（iPhoneのMorrowアプリでは外部のブラウザで開きます）。</p>
    </>
  );
}

const primary = "rounded-[10px] bg-accent px-3 py-2.5 text-center text-sm font-bold text-accent-foreground transition-opacity disabled:opacity-50";

/** 家計簿の主ボタン（#781）。確認待ちのレシートを作り、Asset Managerのレシート編集画面を開く。作れないときは理由と逃げ道のリンク。 */
function PaymentActions({
  card,
  outcome,
  running,
  onRun,
  fallback,
}: {
  card: Extract<Suggestion, { kind: "payment" }>;
  outcome: CardResult | undefined;
  running: boolean;
  onRun: (card: Suggestion) => void;
  fallback: { label: string; url: string };
}) {
  const blocker = paymentBlocker(card.fields);
  if (blocker) {
    return (
      <>
        <p className="text-[0.6875rem] text-danger">{blocker}</p>
        <a href={fallback.url} target="_blank" rel="noopener noreferrer" className={primary}>
          {fallback.label} ↗
        </a>
      </>
    );
  }
  return (
    <>
      {outcome?.href ? (
        // 作った後は同じレシートを開き直すリンクにする（自動で開けなかった環境の逃げ道も兼ねる）
        <a href={outcome.href} target="_blank" rel="noopener noreferrer" className={primary}>
          Asset Managerでレシートを開く ↗
        </a>
      ) : (
        <button type="button" disabled={running} onClick={() => onRun(card)} className={primary}>
          {running ? "レシートを作っています…" : KIND_META.payment.run}
        </button>
      )}
      <p className="text-center text-[0.6875rem] text-muted">
        確認待ちのレシートとして作り、Asset Managerで開きます（iPhoneのMorrowアプリではAsset Managerアプリで開きます）。カテゴリ・メモ・品目の修正と確定はAsset Managerで行います。
      </p>
    </>
  );
}
