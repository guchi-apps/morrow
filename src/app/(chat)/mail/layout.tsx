import { MailTransition } from "@/components/mail/mail-transition";

/** メールの一覧⇔本文の切り替えに動きを付ける（#699）。 */
export default function MailLayout({ children }: { children: React.ReactNode }) {
  return <MailTransition>{children}</MailTransition>;
}
