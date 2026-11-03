import { redirect } from "next/navigation";

/**
 * お知らせの画面は廃止した（#663）。端末に残った古い通知のURL（`/notices`）が404にならないよう、
 * トップ（ダッシュボード）へ転送するだけ。`/c/<ID>` と同じ扱い。
 */
export default function NoticesPage() {
  redirect("/");
}
