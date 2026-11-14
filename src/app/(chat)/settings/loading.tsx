import { CardSkeleton, PageSkeleton } from "@/components/ui/page-skeleton";

/** 設定の取得中（#881）。 */
export default function SettingsLoading() {
  return (
    <PageSkeleton label="設定を読み込んでいます">
      <CardSkeleton title="w-[30%]" lines={["w-[70%]", "w-[50%]"]} />
      <CardSkeleton title="w-[26%]" lines={["w-[64%]", "w-[56%]", "w-[40%]"]} />
      <CardSkeleton title="w-[32%]" lines={["w-[72%]"]} />
    </PageSkeleton>
  );
}
