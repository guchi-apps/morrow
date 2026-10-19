import Link from "next/link";
import { redirect } from "next/navigation";

import { BriefingTimePicker } from "@/components/settings/briefing-time-picker";
import { ConnectionList } from "@/components/settings/connection-list";
import { ProactiveSettingsCard } from "@/components/settings/proactive-settings";
import { PushKindsCard } from "@/components/settings/push-kinds-card";
import { NotificationSettings } from "@/components/settings/notification-settings";
import { WakeTriggerCard } from "@/components/settings/wake-trigger-card";
import { getCurrentUser } from "@/lib/auth-user";
import { listConnections } from "@/lib/mcp/connections";
import { pushPublicKey } from "@/lib/push/config";
import { normalizeFrequency } from "@/lib/proactive-labels";
import { parseDisabledKinds } from "@/lib/push/kinds";
import { isApnsConfigured } from "@/lib/push/apns";
import { countSubscriptions } from "@/lib/push/subscriptions";

export const metadata = { title: "設定" };

// 接続の状態は認可から戻った直後に変わるのでキャッシュさせない。
export const dynamic = "force-dynamic";

/**
 * 時刻を日本時間の「9月14日 07:02」の形にする。
 *
 * サーバー側で整形して渡す（クライアントで作ると端末のタイムゾーンで出て、ハイドレーションでもずれる）。
 */
function jstDateTimeLabel(at: Date | null): string | null {
  if (!at) return null;

  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

type Props = {
  searchParams: Promise<{ error?: string; connected?: string }>;
};

export default async function SettingsPage({ searchParams }: Props) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const [connections, query, deviceCount] = await Promise.all([
    listConnections(user.id),
    searchParams,
    countSubscriptions(user.id),
  ]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-6 md:px-7">
        <header>
          <h2 className="text-lg font-medium">設定</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            秘書からのお知らせ、通知の種類、外部サービスとの接続をここで変えられます。
          </p>
        </header>

        {/* VAPIDの公開鍵はここでpropsとして渡す（#79）。`NEXT_PUBLIC_*` に置くとビルド時に
            バンドルへ焼き込まれ、鍵を差し替えるたびに再ビルドが要る。理由の詳細は
            `@/lib/push/config` のコメント。 */}
        <NotificationSettings
          publicKey={pushPublicKey()}
          initialDeviceCount={deviceCount}
          apnsConfigured={isApnsConfigured()}
        />

        <PushKindsCard initialDisabled={[...parseDisabledKinds(user.pushDisabledKinds)]} />

        <ProactiveSettingsCard
          hasDevice={deviceCount > 0}
          initial={{
            weekend: user.proactiveWeekend,
            freeTime: user.proactiveFreeTime,
            ongoing: user.proactiveOngoing,
            quietStart: user.proactiveQuietStart,
            quietEnd: user.proactiveQuietEnd,
            avoidWork: user.proactiveAvoidWork,
            frequency: normalizeFrequency(user.proactiveFrequency),
          }}
        />

        {/* 定時のお知らせの時刻は話題の画面へ移した（#418）。読む場所のそばで決められるように。 */}
        <p className="text-[0.8125rem] leading-relaxed text-muted">
          話題（ニュース）を届ける曜日・時刻は、
          <Link href="/topics" className="font-medium text-accent underline underline-offset-4">
            話題の画面の「通知する時間」
          </Link>
          で決められます。
        </p>

        <BriefingTimePicker initial={{ hour: user.briefingHour, minute: user.briefingMinute }} />

        {/* 起きた合図（#233）。トークンの本体はDBに無いので、発行済みかどうかは時刻で渡す。 */}
        <WakeTriggerCard
          issuedAtLabel={user.wakeTokenHash ? jstDateTimeLabel(user.wakeTokenCreatedAt) : null}
          usedAtLabel={user.wakeTokenHash ? jstDateTimeLabel(user.wakeTokenUsedAt) : null}
        />

        <ConnectionList connections={connections} error={query.error} connected={query.connected} />

      </div>
    </div>
  );
}
