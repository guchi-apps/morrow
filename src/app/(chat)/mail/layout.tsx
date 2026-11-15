/**
 * メールの一覧⇔本文は、動き（スライド）を付けずにすぐ切り替える（#967）。
 * 待ちは各 `loading.tsx` のスケルトンで見せる。
 */
export default function MailLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
