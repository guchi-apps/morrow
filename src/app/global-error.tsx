"use client";

import { ErrorScreen } from "@/components/error/error-screen";

/**
 * ルートレイアウトまで上がった例外（#863）。Next.jsの既定画面（英語の「This page couldn’t load」）の代わり。
 * ルートレイアウトごと差し替わるので、`html`・`body` とCSSを自前で持つ（globals.cssは読まない）。
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="ja">
      <head>
        <title>Morrow</title>
        <style>{`:root{color-scheme:light dark}body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#fff;color:#1b1c1d;display:flex;min-height:100dvh}@media (prefers-color-scheme:dark){body{background:#131314;color:#e8e8e8}}`}</style>
      </head>
      <body>
        <ErrorScreen error={error} />
      </body>
    </html>
  );
}
