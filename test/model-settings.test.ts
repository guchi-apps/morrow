import assert from "node:assert/strict";
import test from "node:test";

import {
  CHAT_MODELS,
  DEFAULT_MODELS,
  MODEL_USES,
  MODEL_USE_META,
  mergeModelSettings,
  modelDisplayName,
  modelVersionOf,
  resolveModelSettings,
} from "@/lib/chat-model";

test("何も保存していなければ全用途が既定", () => {
  assert.deepEqual(resolveModelSettings(null), DEFAULT_MODELS);
  assert.deepEqual(resolveModelSettings(undefined), DEFAULT_MODELS);
});

test("知らない用途・モデル名・形は既定へ落とす", () => {
  assert.deepEqual(resolveModelSettings([]), DEFAULT_MODELS);
  assert.deepEqual(resolveModelSettings("gpt-6-sol"), DEFAULT_MODELS);
  const resolved = resolveModelSettings({ notice: "gpt-5.6-sol", topic: "nope", unknown: "gpt-6-sol", memory: "gpt-6-luna", chat_text: "gpt-6-sol" });
  assert.equal(resolved.notice, DEFAULT_MODELS.notice);
  assert.equal(resolved.topic, DEFAULT_MODELS.topic);
  assert.equal("memory" in resolved, false);
  assert.equal("chat_text" in resolved, false);
});

test("用途の表は3か所で揃っている", () => {
  for (const use of MODEL_USES) {
    assert.ok(MODEL_USE_META[use], use);
    assert.ok(CHAT_MODELS.some((model) => model.id === DEFAULT_MODELS[use]), use);
  }
});

test("既定と同じ値は保存に残さない", () => {
  const next = mergeModelSettings({ briefing: "gpt-6-luna", memory: "gpt-6-luna" }, { notice: "gpt-6-astra", topic: DEFAULT_MODELS.topic });
  assert.deepEqual(next, { briefing: "gpt-6-luna", notice: "gpt-6-astra" });
  assert.deepEqual(mergeModelSettings(next, { briefing: DEFAULT_MODELS.briefing, notice: DEFAULT_MODELS.notice }), {});
});

test("表示の版・愛称はモデルIDから導かれ、IDと一致する（#633）", () => {
  for (const model of CHAT_MODELS) {
    const version = modelVersionOf(model.id);
    assert.match(version, /^GPT-\d+(\.\d+)*$/, model.id);
    assert.equal(modelDisplayName(model.id), `${version} ${model.label}`);
    // 表示名から作ったスラッグが、実際に渡すIDと一致する
    assert.equal(modelDisplayName(model.id).toLowerCase().replace(/^gpt-/, "gpt-").replace(" ", "-"), model.id);
  }
  assert.equal(modelDisplayName("gpt-6-astra"), "GPT-6 Astra");
  assert.equal(modelVersionOf("gpt-6.1-sol"), "GPT-6.1");
  assert.equal(modelVersionOf("unknown"), "");
  assert.equal(modelDisplayName("unknown"), "unknown");
});
