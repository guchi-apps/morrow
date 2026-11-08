import { MailDetailSkeleton } from "@/components/mail/mail-skeleton";

/** 本文を取得している間のスケルトン（#699）。押した直後にこれが右から滑り込む。 */
export default function MailDetailLoading() {
  return <MailDetailSkeleton />;
}
