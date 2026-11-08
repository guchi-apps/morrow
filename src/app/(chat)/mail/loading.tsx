import { MailListSkeleton } from "@/components/mail/mail-skeleton";

/** 一覧を取得している間（本文から戻ったとき・絞り込みを変えたとき）のスケルトン（#699）。 */
export default function MailListLoading() {
  return <MailListSkeleton />;
}
