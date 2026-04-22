import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTagSplitter } from "./tag-splitter.ts";

type Collected = { thinking: string; text: string };

function collect(): Collected & ReturnType<typeof makeTagSplitter> {
  const state: Collected = { thinking: "", text: "" };
  const splitter = makeTagSplitter({
    onThinking: (t) => {
      state.thinking += t;
    },
    onText: (t) => {
      state.text += t;
    },
  });
  return Object.assign(state, splitter);
}

test("no tags: all input goes to text", () => {
  const c = collect();
  c.feed("hello world");
  c.feed(", no tags here.");
  c.flush();
  assert.equal(c.text, "hello world, no tags here.");
  assert.equal(c.thinking, "");
});

test("full thinking block in one chunk", () => {
  const c = collect();
  c.feed("<thinking>reasoning step</thinking>final answer");
  c.flush();
  assert.equal(c.thinking, "reasoning step");
  assert.equal(c.text, "final answer");
});

test("tag split across chunks holds partial until complete", () => {
  const c = collect();
  c.feed("<thi");
  assert.equal(c.text, "", "must not emit partial open tag as text");
  c.feed("nking>step one");
  assert.equal(c.thinking, "step one");
  c.feed("</think");
  assert.equal(c.thinking, "step one", "must hold partial close tag");
  c.feed("ing>answer");
  c.flush();
  assert.equal(c.thinking, "step one");
  assert.equal(c.text, "answer");
});
