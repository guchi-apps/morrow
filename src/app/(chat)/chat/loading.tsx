import { Bar, PageSkeleton } from "@/components/ui/page-skeleton";

/** チャットの取得中（#881）。 */
export default function ChatLoading() {
  return (
    <PageSkeleton label="チャットを読み込んでいます">
      <div className="flex flex-col gap-3" aria-hidden="true">
        <Bar className="h-14 w-[70%] rounded-2xl" />
        <Bar className="ml-auto h-10 w-[50%] rounded-2xl" />
        <Bar className="h-20 w-[78%] rounded-2xl" />
      </div>
    </PageSkeleton>
  );
}
