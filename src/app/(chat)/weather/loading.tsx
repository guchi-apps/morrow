import { CardSkeleton, PageSkeleton } from "@/components/ui/page-skeleton";

/** 天気の取得中（#881）。 */
export default function WeatherLoading() {
  return (
    <PageSkeleton label="天気を読み込んでいます">
      <CardSkeleton title="w-[30%]" lines={["w-[70%]", "w-[55%]"]} />
      <div className="grid gap-3 md:grid-cols-2">
        <CardSkeleton title="w-[50%]" lines={["w-[80%]", "w-[64%]"]} />
        <CardSkeleton title="w-[40%]" lines={["w-[75%]", "w-[60%]"]} />
      </div>
    </PageSkeleton>
  );
}
