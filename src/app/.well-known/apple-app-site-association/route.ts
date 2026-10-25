import { NextResponse } from "next/server";

import { appleAppSiteAssociation } from "@/lib/universal-links";

export const dynamic = "force-dynamic";

/** Universal Linksの対象定義（#619）。認証・リダイレクトなしで `application/json` を返す。 */
export async function GET() {
  return NextResponse.json(appleAppSiteAssociation(), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
