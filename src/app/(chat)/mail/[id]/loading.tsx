import { MailDetailSkeleton } from "@/components/mail/mail-skeleton";

/** 本文を取得している間のスケルトン（#699）。押した直後にこれを出す（動きは付けない。#967）。 */
export default function MailDetailLoading() {
  return <MailDetailSkeleton />;
}
