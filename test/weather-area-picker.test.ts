import assert from "node:assert/strict";
import { test } from "node:test";

import { AREAS, areaById, areaHref, municipalitiesOf, parseMuniEntries, prefecturesOf } from "@/lib/weather/area-picker";

const SAMPLE = `
GSI.MUNI_ARRAY["27100"] = '27,大阪府,27100,大阪市';
GSI.MUNI_ARRAY["27102"] = '27,大阪府,27102,大阪市　北区';
GSI.MUNI_ARRAY["27202"] = '27,大阪府,27202,堺市';
GSI.MUNI_ARRAY["25201"] = '25,滋賀県,25201,大津市';
`;

test("政令市の区は市に畳み、同じ都道府県の同名は1件にする", () => {
  const entries = parseMuniEntries(SAMPLE);
  assert.deepEqual(municipalitiesOf(27, entries).map((e) => e.name), ["大阪市", "堺市"]);
  assert.equal(entries.length, 3);
});

test("エリアは都道府県コード1〜47をちょうど1回ずつ含む", () => {
  const codes = AREAS.flatMap((a) => [...a.prefectures]).sort((a, b) => a - b);
  assert.deepEqual(codes, Array.from({ length: 47 }, (_, i) => i + 1));
});

test("エリアの都道府県は一覧にあるものだけをコード順で返す", () => {
  const kinki = areaById("kinki")!;
  assert.deepEqual(prefecturesOf(kinki, parseMuniEntries(SAMPLE)), [
    { code: 25, name: "滋賀県" },
    { code: 27, name: "大阪府" },
  ]);
  assert.equal(areaById("x"), null);
});

test("areaHref は picker を付けて値を載せる", () => {
  assert.equal(areaHref({}), "/weather?picker=1");
  assert.equal(areaHref({ area: "kinki", pref: 27, city: "堺市" }), "/weather?picker=1&area=kinki&pref=27&city=%E5%A0%BA%E5%B8%82");
});
