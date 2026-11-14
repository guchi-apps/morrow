import { Bar, PageSkeleton } from "@/components/ui/page-skeleton";

/** ニュースの取得中（#881）。 */
export default function TopicsLoading() {
  return (
    <PageSkeleton label="ニュースを読み込んでいます">
      <div className="flex gap-1.5" aria-hidden="true">
        <Bar className="h-7 w-16 rounded-full" />
        <Bar className="h-7 w-20 rounded-full" />
        <Bar className="h-7 w-14 rounded-full" />
      </div>
      <ul className="overflow-hidden rounded-xl border border-border bg-surface" aria-hidden="true">
        {["w-[88%]", "w-[76%]", "w-[92%]", "w-[70%]", "w-[84%]"].map((width, index) => (
          <li key={index} className="flex flex-col gap-2 border-t border-border px-4 py-3.5 first:border-t-0">
            <Bar className={`h-4 ${width}`} />
            <Bar className="h-3 w-[55%]" />
          </li>
        ))}
      </ul>
    </PageSkeleton>
  );
}
