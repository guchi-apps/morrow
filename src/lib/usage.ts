import type { UsageGroup } from "@/lib/ai-usage-report";
import { db } from "@/lib/db";
import type { UsageFeature } from "@/lib/usage-feature";

/**
 * APIの消費量（#51）。記録の書き込み（`recordApiUsage()`）と、外へ返す集計（`aiUsageGroups()`）だけを持つ。
 *
 * 利用者向けの「使用量」画面と左メニューの数字は#634で廃止した（集計・単価計算・整形はその時に削除）。
 * 単価表と課金の形の判定（`MODEL_PRICING`・`billingKind()`）も画面と一緒に削除した。
 *
 * **このモジュールはサーバー専用。** `@/lib/db` 経由でPrismaを引き込むため、クライアント
 * コンポーネントからimportしないこと。
 */

/**
 * 直近24時間・7日間を、機能×モデルに畳んで返す（#297。ops-dashboardの「アプリ別のAI利用」）。
 *
 * **全利用者ぶんの合計で、`userId` では絞らない。** 呼び出し元は利用者を持たない外部の
 * サービス（Bearerだけで通る）で、知りたいのは「このアプリがどれだけ使ったか」。
 *
 * **24時間→7日間の順に、別々のクエリで引く。** 逆にすると、2本のあいだに積まれた行が24時間には
 * 入るのに7日間には入らず、7日間が24時間を下回る。この順なら、後から引く7日間は必ず前者を含む。
 * 境界は同じ `now` から作る。件数ぶんの行は持ち帰らず、DB側で畳んだグループだけを受け取る。
 */
export async function aiUsageGroups(now: Date): Promise<{ last24h: UsageGroup[]; last7d: UsageGroup[] }> {
  const day = 24 * 60 * 60 * 1000;

  const query = async (since: Date): Promise<UsageGroup[]> => {
    const groups = await db.apiUsage.groupBy({
      by: ["feature", "model"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        cacheWriteTokens: true,
        cacheReadTokens: true,
      },
    });

    return groups.map((group) => ({
      feature: group.feature,
      model: group.model,
      calls: group._count._all,
      inputTokens: group._sum.inputTokens ?? 0,
      outputTokens: group._sum.outputTokens ?? 0,
      cacheWriteTokens: group._sum.cacheWriteTokens ?? 0,
      cacheReadTokens: group._sum.cacheReadTokens ?? 0,
    }));
  };

  const last24h = await query(new Date(now.getTime() - day));
  const last7d = await query(new Date(now.getTime() - 7 * day));
  return { last24h, last7d };
}

// --- DBへの書き込み ---

/**
 * API呼び出し1回ぶんを記録する（#51・#133）。
 *
 * **数える単位は「API呼び出し1回」で、秘書の返答（`Message`）には持たせない。** 1文字も
 * 出ないうちに割り込まれた往復では返答の行そのものが作られないが、入力ぶんはその時点で
 * 使い終わっている。
 *
 * **記録に失敗しても呼び出し元を止めない。** 相談も通知も、記録できないことより返らないことの
 * 方が重い（#51から変えていない）。呼び出し元でtry/catchを書かずに済むよう、ここで飲む。
 *
 * **全部0の回は行を作らない。** Codexでは中断・起動失敗で `turn.completed` が届かず、
 * 使った量が分からない。0として残すと「呼んだのに一切消費しなかった」記録になり、
 * 回数だけが実態より多く見える。
 */
export async function recordApiUsage(params: {
  userId: string;
  /** どの機能の呼び出しか（#297）。使用量APIが機能ごとに畳むのに使う。 */
  feature: UsageFeature;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
  };
}): Promise<void> {
  const { userId, feature, model, usage } = params;

  const total =
    usage.inputTokens + usage.outputTokens + usage.cacheWriteTokens + usage.cacheReadTokens;
  if (total <= 0) return;

  try {
    await db.apiUsage.create({ data: { userId, feature, model, ...usage } });
  } catch (error) {
    console.error("[aide-bot] 使用量の記録に失敗した", error);
  }
}
