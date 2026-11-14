/** スケルトンの帯1本（#699・#881）。メールと各画面のloading.tsxで共有する。 */
export function Bar({ className }: { className: string }) {
  return <div className={`mail-skeleton ${className}`} aria-hidden="true" />;
}

/** 「◯◯を読み込んでいます」。読み上げにも状態を伝える。 */
export function LoadingLabel({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2 text-[0.6875rem] text-muted">
      <span className="mail-loading-dots flex gap-1" aria-hidden="true">
        <span className="size-1.5 rounded-full bg-accent" />
        <span className="size-1.5 rounded-full bg-accent" />
        <span className="size-1.5 rounded-full bg-accent" />
      </span>
      {children}
    </p>
  );
}

/** カード1枚ぶんのスケルトン。 */
export function CardSkeleton({ lines = ["w-[70%]", "w-[55%]"], title = "w-[30%]" }: { lines?: string[]; title?: string }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-4" aria-hidden="true">
      <Bar className={`h-4 ${title}`} />
      {lines.map((width, index) => (
        <Bar key={index} className={`h-3 ${width}`} />
      ))}
    </div>
  );
}

/** 各画面のloading.tsxの外枠。見出し（ChatShell）の下で、画面の本文と同じ幅・余白に揃える。 */
export function PageSkeleton({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-3.5 px-3.5 py-4 md:px-7 md:py-6">
        <LoadingLabel>{label}</LoadingLabel>
        {children}
      </div>
    </div>
  );
}
