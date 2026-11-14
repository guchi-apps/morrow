import { CardSkeleton, PageSkeleton } from "@/components/ui/page-skeleton";

/** モデル設定の取得中（#881）。 */
export default function ModelsLoading() {
  return (
    <PageSkeleton label="モデルを読み込んでいます">
      <CardSkeleton title="w-[30%]" lines={["w-[60%]"]} />
      <CardSkeleton title="w-[34%]" lines={["w-[60%]"]} />
      <CardSkeleton title="w-[28%]" lines={["w-[60%]"]} />
    </PageSkeleton>
  );
}
