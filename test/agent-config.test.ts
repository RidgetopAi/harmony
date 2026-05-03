import assert from "node:assert/strict";
import { test } from "node:test";
import { agents } from "../src/config/agents.js";

test("configured agent prompts teach the authority-request protocol", () => {
  for (const agent of agents) {
    assert.match(agent.systemPrompt, /structured-intent/);
    assert.match(agent.systemPrompt, /human-readable/);
    assert.match(agent.systemPrompt, /actions/);
    assert.match(agent.systemPrompt, /Request authority/);
  }
});
