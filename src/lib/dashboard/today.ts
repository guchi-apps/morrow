import { listTopicCategories } from "@/lib/topic-category-store";
import { topicCategoryShort } from "@/lib/topic-categories";
import { topicsForBubble } from "@/lib/topics";

/**
 * ダッシュボードのうち、Morrow自身のDBから出すもの（#573）。モデルもAIDEも呼ばない。
 */

export type DashboardTopic = { id: string; title: string; lead: string; url: string | null; chip: string };

/** 話題の最新数件（吹き出しと同じ選び方・同じ出来事は1件にまとめ済み）。 */
export async function dashboardTopics(userId: string, now = new Date()): Promise<DashboardTopic[]> {
  const [topics, categories] = await Promise.all([topicsForBubble(userId, now), listTopicCategories(userId)]);
  return topics.map((topic) => ({
    id: topic.id,
    title: topic.title,
    lead: topic.lead,
    url: topic.url,
    chip: topicCategoryShort(categories, topic.category),
  }));
}
