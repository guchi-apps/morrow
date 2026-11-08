/**
 * iOSアプリのUniversal Links（`/.well-known/apple-app-site-association`。#619）。
 *
 * AppleのCDNはリダイレクト・認証を通さないので、この経路はmiddlewareの対象外にしてある
 * （`src/proxy.ts` のmatcher）。ログイン・APIはアプリで開かず、ブラウザに残す。
 * appID（`<チームID>.<Bundle ID>`）は `ios/Morrow.xcodeproj` の `DEVELOPMENT_TEAM`・
 * `PRODUCT_BUNDLE_IDENTIFIER` と揃える（`test/universal-links.test.ts` が照合する）。
 */
export const IOS_APP_ID = "6AA3WFTR94.com.gucchii.morrow";

/** アプリで開かず、ブラウザに残すパス（認証の往復・API）。 */
export const EXCLUDED_PATHS = ["/login", "/login/*", "/auth/*", "/api/*"];

export function appleAppSiteAssociation() {
  return {
    applinks: {
      details: [
        {
          appIDs: [IOS_APP_ID],
          components: [
            ...EXCLUDED_PATHS.map((path) => ({ "/": path, exclude: true })),
            { "/": "/*" },
          ],
        },
      ],
    },
  };
}
