import { readFileSync } from "node:fs";
import { formatComparison, formatReport, type ResultFile } from "./eval-core.ts";

/**
 * 2つの評価結果を比べる（#1152）。`pnpm hermes-eval:compare <前.json> <後.json>`（SOUL整備の前後など）。
 * 1つだけ渡すとその結果の一覧を出し直す。
 */

function load(path: string): ResultFile {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as ResultFile).entries)) {
    console.error(`hermes-eval:compare: ${path} は評価結果の形ではない`);
    process.exit(2);
  }
  return parsed as ResultFile;
}

const [before, after] = process.argv.slice(2);
if (!before) {
  console.error("使い方: pnpm hermes-eval:compare <前.json> [<後.json>]");
  process.exit(2);
}
console.log(after ? formatComparison(load(before), load(after)) : formatReport(load(before)));
