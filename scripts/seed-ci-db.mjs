#!/usr/bin/env node
// 開発／CI用のダミーデータを投入する。
//
// 共有ワークフロー（issue-deckのreusable-issue-dispatch.yml）が `db:seed:ci` という
// 名前で `--if-present` 付きで呼ぶ。**スクリプト名を変えると無言でスキップされる。**
// ローカルからは `pnpm db:seed:dev`（scripts/seed-dev-db.sh）が接続先を確かめてから呼ぶ。
//
// ここで作るユーザーは、開発用ログイン（#25）で入るバイパス対象のダミーユーザー。
// supabaseUserId の値は src/lib/ci-auth-bypass.ts の CI_BYPASS_SUPABASE_USER_ID と
// **必ず一致させること**（プレーンJSのスクリプトのためTSファイルを直接importせず、
// 値をこのファイルに直書きしている）。一致していないと、ログインは通るのに
// getCurrentUser() がnullを返し、画面が /login へ戻り続ける。

import { createHash } from "node:crypto";

import { PrismaClient } from "@prisma/client";

const CI_BYPASS_SUPABASE_USER_ID = "ci-screenshot-bot";

// 従量課金の節（`/usage`）に入るダミー。**#183で朝の見通しもCodexへ移ったので、これは
// 「移行前に残った記録」を再現するためだけの行**（BRIEFING_MODEL とは揃えない。揃えると
// 従量課金の節が常に空になり、その節の表示が壊れていても画面から気付けない）。
const BRIEFING_USAGE_MODEL = "claude-haiku-4-5";

const db = new PrismaClient();

// 朝の見通し（#79）のダミーの本文。ダッシュボードの「今日届いた通知」に出る。
const BRIEFING_ANSWER =
  "今日は10時から歯科の予約が入っています。日中は27度まで上がり、夕方から雨の予報なので折りたたみ傘があると安心です。部屋のCO2が1200ppmまで上がっているので、出かける前に換気をおすすめします。";

const now = new Date();
const daysAgo = (days) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);


// ダミーの接続（#46）。空のままだと接続画面の「繋いでいるもの」側を確かめられない。
//
// **どちらも生成には渡らない状態にしてある。** 使えるトークンを持った接続を入れると、
// 開発環境で朝の見通しなどを動かすたびに実在しない資格情報で外部サービスへ繋ぎに行き、生成
// そのものが失敗する。休止中（enabled=false）と未接続（accessToken=null）の2つを置いて、
// 状態の出し分けだけを確かめられるようにしている。
const CONNECTION_SEEDS = [
  {
    label: "AIDE",
    slug: "aide",
    url: "https://aide.gucchii.com/mcp",
    enabled: false,
    accessToken: "dev-dummy-access-token",
  },
  {
    label: "Notion",
    slug: "notion",
    url: "https://mcp.notion.com/mcp",
    enabled: true,
    accessToken: null,
  },
];

// 通知の購読（#79）。設定の画面が「登録済みの端末」を件数で出すため、空だと
// その表示を確かめられない。
//
// **endpointは絶対に解決しないホストにしてある**（`.invalid` は予約済みTLD）。
// 実在するPushサービスのURLを入れると、開発環境で「試しに送る」を押すたびに
// 外部へリクエストが飛ぶ。
//
// **鍵は「長さの正しい」使い捨ての値にしてある。** web-pushは送信の前に長さを検証し
// （p256dhは65バイト、authは16バイト）、短いと名前解決より手前で
// `The subscription p256dh value should be 65 bytes long.` で落ちる。適当な文字列にすると、
// 開発環境で「試しに送る」を押したときの失敗の理由が本番と変わってしまう。
const PUSH_SUBSCRIPTION_SEEDS = [
  { endpoint: "https://push.invalid/dev-dummy-iphone", deviceLabel: "iPhone / Safari" },
  { endpoint: "https://push.invalid/dev-dummy-desktop", deviceLabel: "Linux / Chrome" },
];
const DUMMY_P256DH =
  "BBqwI5nKDsS6vttGU-N-qzS2IkGqA2l98SgR6YGlPINPwxqJ7zBmTv82tQz2X50h6LoERX2uoPgKf9bv9nfKcsg";
const DUMMY_AUTH = "iAo59Zn5euzmta2BpuwsSA";

// お知らせの受け皿（#93）。ダッシュボードの「いまの一言」は、ここに未読が1件も無ければ黙る——
// 空のままだと、実装が効いているのか材料が無いだけなのかを画面から切り分けられない。
//
// **1件だけ「すでに出したもの」を入れてある。** 開いた直後に何か出ている状態と、
// 一度出したものが二度と選ばれないことの両方を確かめるため。
//
// 期限（expiresAt）は投入時刻からの相対で入れる。固定の日時にすると、シードを流した翌日に
// すべて期限切れになり、候補が0件のまま「黙っているのが正しいのか」が分からなくなる。
const NOTICE_SEEDS = [
  {
    source: "aide",
    kind: "schedule",
    dedupeKey: "dev-dental",
    title: "歯科の予約",
    body: "13時から歯科の予約があります。自宅からは電車で25分かかります。",
    priority: "URGENT",
    // 押したときに開く先（#137）。**別のオリジンなので新しいタブで開く**——同じタブで移る
    // アプリ内のパス（下の `dev-briefing`）と見え方が違うので、両方を入れてある。
    url: "https://aide.gucchii.com/schedule",
    expiresInMinutes: 180,
  },
  {
    source: "aide",
    kind: "room",
    dedupeKey: "dev-co2",
    title: "部屋の換気",
    body: "部屋のCO2が1200ppmまで上がっています。換気をおすすめします。",
    priority: "NORMAL",
    // **リンクを持たない行をわざと残してある**（#137）。ここが今までどおりの見た目で、
    // 「開く」が出ないことを確かめられないと、リンクの有無で出し分けているのか
    // すべてに出ているのかを画面から切り分けられない。
    expiresInMinutes: 120,
  },
  {
    source: "dayspan",
    kind: "habit",
    dedupeKey: "dev-journal",
    title: "今日の記録",
    body: "今日の記録がまだ書かれていません。",
    priority: "LOW",
    url: "https://dayspan.gucchii.com/",
    expiresInMinutes: 600,
  },
  {
    source: "asset-manager",
    kind: "report",
    dedupeKey: "dev-monthly",
    body: "先月の資産レポートが出来上がっています。",
    priority: "LOW",
    // いま出している1件（#137の「いま出しています」の開くボタンと、吹き出しの「開く」）。
    url: "https://asset-manager.gucchii.com/reports",
    // すでに秘書が選んで出したもの。もう候補には戻らない。
    spokenText: "先月の資産レポートが出来上がっていますよ。",
    spokenUrgent: false,
    shownMinutesAgo: 12,
    expiresInMinutes: 1440,
  },
  // まだ出せないもの（#114の一覧で「21:00から出せます」の欄を確かめるため）。
  // `showAt` が先なので候補には入らず、吹き出しには出ない。
  {
    source: "aide",
    kind: "schedule",
    dedupeKey: "dev-recycle",
    title: "資源ごみ",
    body: "明日は資源ごみの日です。玄関に出しておくと安心です。",
    priority: "NORMAL",
    showAtInMinutes: 180,
    expiresInMinutes: 900,
  },
  // アプリの中のページを指すお知らせ（#137）。朝の見通し（#79）が自分で積むのと同じ形で、
  // **同じタブのまま移る**（外部のリンクは新しいタブ）。`fromMorningBriefing` を書いておくと、
  // 下の投入でダッシュボード（`/`）を指す形にする。
  {
    source: "aide-bot",
    kind: "morning-briefing",
    dedupeKey: "dev-briefing",
    title: "今日の見通し",
    body: "今日の見通しをお伝えしています。",
    priority: "NORMAL",
    fromMorningBriefing: true,
    expiresInMinutes: 480,
  },
  // 出さないまま期限が切れたもの（#114）。**読まれずに消えた**ことが分かる唯一の欄で、
  // ここが空だと実装が効いているのか材料が無いだけなのかを画面から切り分けられない。
  {
    source: "aide",
    kind: "delivery",
    dedupeKey: "dev-redelivery",
    title: "宅配の再配達",
    body: "18時〜20時の再配達を受け付けています。",
    priority: "NORMAL",
    expiresInMinutes: -180,
  },
];

// 話題（#144）。ダッシュボードの「話題」と `/topics` の一覧を確かめるためのダミー。
// 実際の仕入れ（`codex --search exec`）は開発DBのシードでは走らせない——27秒掛かるうえ、
// サブスクの利用枠を消費する。**同じURLは `urlHash` で畳まれる**ので、何度流しても増えない。
//
// 種類（category）は3つすべてを入れてある。1種類だけだとチップの出し分けを画面で確かめられない。
// `fetchedMinutesAgo` は投入時刻からの相対で、24時間の期間を過ぎたものも1件入れてある
// （一覧にもダッシュボードにも出ないことを確かめる）。
const TOPIC_SEEDS = [
  {
    category: "life",
    title: "青森県津軽で線状降水帯、厳重警戒",
    summary: "気象庁が津軽地方に線状降水帯の発生を発表。大雨による土砂災害・河川の増水に厳重な警戒を呼びかけている。",
    lead: "青森の津軽で線状降水帯が出ているそうです。東北方面のご予定はありませんか",
    url: "https://example.com/news/dev-tsugaru-rain",
    sourceName: "テレビ朝日",
    fetchedMinutesAgo: 20,
  },
  {
    category: "general",
    title: "食料品の消費税1％化、表示猶予を調整",
    summary: "税率変更の前後2か月は税込み価格の表示を免除する特例を政府が検討。値札の付け替えが間に合わない小売店に配慮する。",
    lead: "食料品の消費税が1％になる話、値札の表示にしばらく猶予が付くそうですよ",
    url: "https://example.com/news/dev-tax-label",
    sourceName: "テレビ朝日",
    fetchedMinutesAgo: 20,
  },
  // 同じ出来事を別の媒体が報じたもの（#362）。話題の一覧では1件にまとまり「他の記事」に並ぶ。
  {
    category: "life",
    title: "津軽地方に線状降水帯が発生、気象庁が厳重警戒を呼びかけ",
    summary: "気象庁は青森県津軽地方に線状降水帯が発生したと発表。大雨による土砂災害や河川の増水に厳重な警戒を呼びかけている。",
    lead: "津軽の線状降水帯、他の媒体も伝えているそうです",
    url: "https://example.com/news/dev-tsugaru-rain-2",
    sourceName: "NHK",
    fetchedMinutesAgo: 25,
    createdMinutesAgo: 25,
  },
  {
    category: "tech",
    title: "Node.js 26がLTSに",
    summary: "Node.js 26が長期サポート（LTS）に入った。サポート期間は2029年4月まで。",
    lead: "Node.jsの新しい長期サポート版が出たそうです。そろそろ更新を考えますか",
    url: "https://example.com/news/dev-node-lts",
    sourceName: "Node.js",
    fetchedMinutesAgo: 20,
    // 前の回に取り込んだ記事が仕入れ直されて `fetchedAt` だけ進んだもの（#418）。既読の回に並び、NEWにならない。
    createdMinutesAgo: 302,
  },
  {
    category: "general",
    title: "ネパールの土石流、日本人1人が行方不明",
    summary: "ネパール中部で発生した土石流に日本人旅行者が巻き込まれた模様。外務省が現地の情報収集を続けている。",
    lead: "ネパールの土石流で日本の方が行方不明になっているそうです。心配ですね",
    url: "https://example.com/news/dev-nepal",
    sourceName: "NHK",
    fetchedMinutesAgo: 300,
    createdMinutesAgo: 300,
    // すでに秘書から振ったぶん（#278）。**これが無いと「二度は振らない」を画面から確かめられない**
    // ——全部が未振りだと、声かけが1件出たのが最新の1件なのか手当たり次第なのか分からない。
    spokenMinutesAgo: 240,
  },
  // 期間（24時間）を過ぎたもの。一覧にも吹き出しにも出ない。
  {
    category: "life",
    title: "首都圏の電車、来春のダイヤ改正を発表",
    summary: "来年3月のダイヤ改正で、平日朝の一部の列車が減便される。",
    lead: "来春のダイヤ改正で朝の電車が少し減るそうです",
    url: "https://example.com/news/dev-old-timetable",
    sourceName: "NHK",
    fetchedMinutesAgo: 60 * 30,
  },
];

async function main() {
  const user = await db.user.upsert({
    where: { supabaseUserId: CI_BYPASS_SUPABASE_USER_ID },
    update: {},
    create: {
      supabaseUserId: CI_BYPASS_SUPABASE_USER_ID,
      email: "ci-screenshot-bot@example.com",
      name: "開発用ダミーユーザー",
    },
  });

  console.log(`[aide-bot] バイパス用ユーザーをupsertしました: id=${user.id} name=${user.name}`);

  // 使用量の記録（#133）。**これが無いと、使用量の画面の従量課金の節が「今日ぶん1件」だけになり、
  // 日別のグラフも表も空に近い状態でしか確かめられない。**
  //
  // - 朝の見通し（#79）: 移行前の記録（Claude）を再現する行。1日1回で、頼み直した日だけ2行になる
  // - お知らせの選定（#132）・話題の仕入れ（#144）: Codexで動くぶん（定額）
  const standaloneUsageExists = await db.apiUsage.count({
    where: { userId: user.id },
  });

  if (standaloneUsageExists === 0) {
    const standalone = [];

    // 古い日→今日。8日前だけ pause_turn で2回叩いた形にする。
    for (let daysBefore = 13; daysBefore >= 0; daysBefore -= 1) {
      const at = daysAgo(daysBefore);
      at.setHours(7, 0, 30, 0);

      const calls = daysBefore === 8 ? 2 : 1;
      for (let call = 0; call < calls; call += 1) {
        standalone.push({
          userId: user.id,
          feature: "briefing",
          model: BRIEFING_USAGE_MODEL,
          inputTokens: 8600 + call * 400 + daysBefore * 40,
          outputTokens: 560 + call * 40,
          cacheWriteTokens: 0,
          // 1日1回ではキャッシュの保持時間（5分）をとうに過ぎており、実際にも効かない（#56）。
          cacheReadTokens: 0,
          createdAt: new Date(at.getTime() + call * 40_000),
        });
      }

      // お知らせの選定はダッシュボードを開いている間だけ走る。毎日は積まない。
      if (daysBefore % 3 === 0) {
        const noticeAt = new Date(at.getTime());
        noticeAt.setHours(21, 10, 0, 0);
        standalone.push({
          userId: user.id,
          feature: "notice",
          model: "gpt-6-luna",
          inputTokens: 3200,
          outputTokens: 40,
          cacheWriteTokens: 0,
          cacheReadTokens: 8960,
          createdAt: noticeAt,
        });
      }

      // 使用量API（#297）が機能ごとに分けて返せるよう、残りの機能も少しずつ積む。
      // 話題の仕入れ（#144）は入力が桁違いに大きい（検索を重ねるため）。自宅の取り込み（#167）は
      // 1日1回。機能ごとの記録を使用量API（#297）の応答から確かめるためのもの。
      if (daysBefore % 2 === 1) {
        const topicAt = new Date(at.getTime());
        topicAt.setHours(10, 5, 0, 0);
        standalone.push({
          userId: user.id,
          feature: "topic",
          model: "gpt-6-luna",
          inputTokens: 61364,
          outputTokens: 2727,
          cacheWriteTokens: 0,
          cacheReadTokens: 320000,
          createdAt: topicAt,
        });
      }
    }

    await db.apiUsage.createMany({ data: standalone });
    console.log(`[aide-bot] 使用量を投入しました: ${standalone.length}件`);
  }

  // 外部サービスとの接続（#46）。slugは利用者の中で一意なのでupsertできる。
  for (const seed of CONNECTION_SEEDS) {
    await db.mcpConnection.upsert({
      where: { userId_slug: { userId: user.id, slug: seed.slug } },
      update: {},
      create: { ...seed, userId: user.id },
    });
  }

  const connectionCount = await db.mcpConnection.count({ where: { userId: user.id } });
  console.log(`[aide-bot] 外部サービスとの接続を投入しました: ${connectionCount}件`);

  // 通知の購読（#79）。一意制約は endpointHash（endpointのSHA-256）に張ってある。
  // MariaDBは長いTEXTへそのまま一意制約を張れないため（src/lib/push/subscriptions.ts）。
  for (const seed of PUSH_SUBSCRIPTION_SEEDS) {
    const endpointHash = createHash("sha256").update(seed.endpoint).digest("hex");
    const data = {
      userId: user.id,
      endpoint: seed.endpoint,
      endpointHash,
      p256dh: DUMMY_P256DH,
      auth: DUMMY_AUTH,
      deviceLabel: seed.deviceLabel,
    };

    await db.pushSubscription.upsert({ where: { endpointHash }, update: {}, create: data });
  }

  const subscriptionCount = await db.pushSubscription.count({ where: { userId: user.id } });
  console.log(`[aide-bot] 通知の購読を投入しました: ${subscriptionCount}件`);

  // 朝の見通し（#79）。抑制の記録（NotificationLog）も対で入れる。**日付の鍵は日本時間**で
  // 作る（src/lib/day-key.ts の jstDayKey と同じ）。ずれると、シード投入した日に
  // 実際の朝の見通しがもう1本届いてしまう。
  const dedupeKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const briefingExists = await db.notificationLog.findUnique({
    where: { userId_kind_dedupeKey: { userId: user.id, kind: "morning-briefing", dedupeKey } },
    select: { id: true },
  });

  if (!briefingExists) {
    const briefedAt = new Date(now.getTime());
    briefedAt.setHours(7, 0, 0, 0);

    // 見通しの生成も呼び出し1回ぶんとして数える（#51）。
    await db.apiUsage.create({
      data: {
        userId: user.id,
        feature: "briefing",
        model: BRIEFING_USAGE_MODEL,
        inputTokens: 4200,
        outputTokens: 210,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        createdAt: new Date(briefedAt.getTime() + 1000),
      },
    });

    await db.notificationLog.create({
      data: {
        userId: user.id,
        kind: "morning-briefing",
        dedupeKey,
        title: "今日の見通し",
        body: BRIEFING_ANSWER,
        deliveredCount: PUSH_SUBSCRIPTION_SEEDS.length,
        createdAt: new Date(briefedAt.getTime() + 2000),
      },
    });

    console.log("[aide-bot] 朝の見通しを1件投入しました");
  }

  // ダッシュボード（#573）の「今日届いた通知」。朝の見通しだけだと、種類ごとの見た目（急ぎの赤）を
  // 確かめられない。会話へは積まない（画面が読むのは NotificationLog だけ）。
  for (const seed of [
    { kind: "urgent-notice", key: `seed-urgent-${dedupeKey}`, title: "経費精算の締切", body: "本日18時締切の経費精算が未提出です。", share: 0.6 },
    {
      kind: "proactive-suggestion",
      key: `seed-proactive-${dedupeKey}`,
      title: "先回りの提案",
      body: "19時過ぎから22時まで空いています。「いつかやりたいこと」の読書メモの整理はいかがでしょう。",
      share: 0.9,
    },
  ]) {
    // 日本時間の今日の0時から今までのあいだに置く（サーバーのタイムゾーンによらず「今日」に入る）。
    const dayStartMs = new Date(`${dedupeKey}T00:00:00+09:00`).getTime();
    const at = new Date(dayStartMs + (now.getTime() - dayStartMs) * seed.share);
    await db.notificationLog.upsert({
      where: { userId_kind_dedupeKey: { userId: user.id, kind: seed.kind, dedupeKey: seed.key } },
      update: {},
      create: {
        userId: user.id,
        kind: seed.kind,
        dedupeKey: seed.key,
        title: seed.title,
        body: seed.body,
        deliveredCount: PUSH_SUBSCRIPTION_SEEDS.length,
        createdAt: at,
      },
    });
  }

  // お知らせの受け皿（#93）。dedupeKeyで畳まれるので、何度流しても増えない。
  for (const seed of NOTICE_SEEDS) {
    const { expiresInMinutes, shownMinutesAgo, showAtInMinutes, fromMorningBriefing, ...rest } = seed;

    // アプリの中を指すぶん（#137）。**#157で行き先が今日の記録（`/`）に固定された**
    // 実際の経路（`src/lib/briefing.ts` の `ingestNotice()`）と同じ値にしてある。
    let url = rest.url ?? null;
    if (fromMorningBriefing) {
      url = "/";
    }

    const data = {
      ...rest,
      url,
      // `title` は後から足した列で、Prismaのスキーマでは必須（DB側の既定 '' はPrismaを
      // 通らない）。積む側は省略できるので、`ingestNotice()` と同じく本文の1行目で埋める。
      title: seed.title ?? seed.body.split("\n", 1)[0].slice(0, 120),
      // 負の値を渡すと「すでに期限が切れたもの」になる（#114の一覧で確かめる）。
      expiresAt: new Date(now.getTime() + expiresInMinutes * 60 * 1000),
      showAt: showAtInMinutes ? new Date(now.getTime() + showAtInMinutes * 60 * 1000) : null,
      shownAt: shownMinutesAgo ? new Date(now.getTime() - shownMinutesAgo * 60 * 1000) : null,
    };

    await db.notice.upsert({
      where: {
        userId_source_kind_dedupeKey: {
          userId: user.id,
          source: seed.source,
          kind: seed.kind,
          dedupeKey: seed.dedupeKey,
        },
      },
      update: data,
      create: { userId: user.id, ...data },
    });
  }

  console.log(`[aide-bot] お知らせを${NOTICE_SEEDS.length}件投入しました`);

  // 話題（#144）。同じURLは畳まれる。日付は投入日（日本時間）にしておく。
  const publishedOn = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(now);
  // 前回この画面を開いた時刻（#418）。2時間前にしておくと、20分前の回がNEW・5時間前の回が既読になり、
  // 境目の線が出る。
  await db.user.update({ where: { id: user.id }, data: { topicsSeenAt: new Date(now.getTime() - 120 * 60 * 1000) } });
  for (const seed of TOPIC_SEEDS) {
    const { fetchedMinutesAgo, createdMinutesAgo, spokenMinutesAgo, ...rest } = seed;
    const urlHash = createHash("sha256").update(seed.url).digest("hex");
    const data = {
      ...rest,
      publishedOn,
      fetchedAt: new Date(now.getTime() - fetchedMinutesAgo * 60 * 1000),
      // 初めて取り込んだ時刻（#418）。省略した記事は仕入れた時刻と同じ（最新の回。NEWになる）。
      createdAt: new Date(now.getTime() - (createdMinutesAgo ?? fetchedMinutesAgo) * 60 * 1000),
      // すでに秘書から振った話題（#278）。一覧にもダッシュボードにも出る。
      spokenAt: spokenMinutesAgo ? new Date(now.getTime() - spokenMinutesAgo * 60 * 1000) : null,
    };

    await db.topic.upsert({
      where: { userId_urlHash: { userId: user.id, urlHash } },
      update: data,
      create: { userId: user.id, urlHash, ...data },
    });
  }

  console.log(`[aide-bot] 話題を${TOPIC_SEEDS.length}件投入しました`);

  // 話題の種類（#345）。初期の3種類（`src/lib/topic-categories.ts` の `DEFAULT_TOPIC_CATEGORIES` と
  // 同じ値）に加え、自作の種類と、仕入れを外している種類を1件ずつ入れる（管理画面の各状態を
  // 確かめるため）。`topicCategoriesReady` を立てておかないと、初回の読み出しが3種類を重ねて入れる。
  const TOPIC_CATEGORY_SEEDS = [
    { key: "general", label: "世の中のこと", short: "世の中", scope: "政治・経済・社会の主な出来事（日本のもの、および日本に影響する海外のもの）", enabled: true },
    { key: "life", label: "暮らしに関わること", short: "暮らし", scope: "値上げ・制度や手続きの変更・災害や気象・交通など、日本での暮らしに直接関わること", enabled: true },
    { key: "tech", label: "技術とAI", short: "技術", scope: "ソフトウェア開発・AI・IT業界の動向（新しいリリース・大きな変更・障害など）", enabled: true },
    { key: "c_devlocal01", label: "地元のできごと", short: "地元", scope: "東京都内の鉄道の運行情報や、新しい商業施設の開業", enabled: true },
    { key: "c_devpaused01", label: "スポーツ（お休み中）", short: "スポーツ", scope: "プロ野球とサッカー日本代表の試合結果", enabled: false },
  ];
  for (const [index, seed] of TOPIC_CATEGORY_SEEDS.entries()) {
    await db.topicCategory.upsert({
      where: { userId_key: { userId: user.id, key: seed.key } },
      create: { userId: user.id, sortOrder: index, ...seed },
      update: { sortOrder: index, ...seed },
    });
  }
  await db.user.update({ where: { id: user.id }, data: { topicCategoriesReady: true } });
  console.log(`[aide-bot] 話題の種類を${TOPIC_CATEGORY_SEEDS.length}件投入しました`);

  // 定時のお知らせ（#344）のダミー。有効・無効の両方を入れておく（画面で状態の出し分けを確かめるため）。
  await db.scheduledPush.deleteMany({ where: { userId: user.id } });
  await db.scheduledPush.createMany({
    data: [
      { userId: user.id, daysMask: 0b0111110, hour: 7, minute: 30, category: "all", enabled: true },
      { userId: user.id, daysMask: 0b1000001, hour: 9, minute: 0, category: "tech", enabled: false },
    ],
  });

}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
