import { Bar, CardSkeleton, PageSkeleton } from "@/components/ui/page-skeleton";

/** ホームの取得中（#881）。メニューを押した直後に、枠はそのまま本文だけ骨組みにする。 */
export default function DashboardLoading() {
  return (
    <PageSkeleton label="ホームを読み込んでいます">
      <Bar className="h-5 w-40" />
      <CardSkeleton title="w-[34%]" lines={["w-[80%]", "w-[60%]"]} />
      <CardSkeleton title="w-[26%]" lines={["w-[72%]", "w-[58%]", "w-[66%]"]} />
      <CardSkeleton title="w-[30%]" lines={["w-[76%]", "w-[52%]"]} />
    </PageSkeleton>
  );
}
