"use client";

import { ErrorScreen } from "@/components/error/error-screen";

/** アプリの画面で起きた例外（#863）。左メニューなどのレイアウトは残し、中身だけを差し替える。 */
export default function ChatError({ error }: { error: Error & { digest?: string } }) {
  return <ErrorScreen error={error} />;
}
