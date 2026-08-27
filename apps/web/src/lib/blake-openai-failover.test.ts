import assert from "node:assert/strict";
import test from "node:test";
import { openAiFetch } from "@/lib/openai-fetch";
import { resolveOpenAiApiKey, resolveOpenAiApiKeyCandidates } from "@/lib/openai-env";

test("Ayla prefers Blake-specific OpenAI key and retries generic key when rejected", async () => {
  const previousNexa = process.env.NEXA_OPENAI_API_KEY;
  const previousGeneric = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  const previousLimit = process.env.BLAKE_AI_MONTHLY_LIMIT_USD;

  process.env.NEXA_OPENAI_API_KEY = "nexa-test-key";
  process.env.OPENAI_API_KEY = "generic-test-key";
  delete process.env.BLAKE_AI_MONTHLY_LIMIT_USD;

  const seenAuth: string[] = [];
  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get("authorization") || "";
    seenAuth.push(auth);
    if (auth === "Bearer nexa-test-key") {
      return new Response(JSON.stringify({ error: { type: "invalid_api_key", message: "bad key" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      id: "resp-test",
      model: "gpt-5.6-luna",
      output: [],
      usage: { input_tokens: 10, output_tokens: 5 },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    assert.equal(resolveOpenAiApiKey(), "nexa-test-key");
    assert.deepEqual(
      resolveOpenAiApiKeyCandidates().slice(0, 2).map((item) => item.source),
      ["NEXA_OPENAI_API_KEY", "OPENAI_API_KEY"],
    );

    const response = await openAiFetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resolveOpenAiApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "gpt-5.6-luna", input: "hello" }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(seenAuth, ["Bearer nexa-test-key", "Bearer generic-test-key"]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousNexa === undefined) delete process.env.NEXA_OPENAI_API_KEY;
    else process.env.NEXA_OPENAI_API_KEY = previousNexa;
    if (previousGeneric === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousGeneric;
    if (previousLimit === undefined) delete process.env.BLAKE_AI_MONTHLY_LIMIT_USD;
    else process.env.BLAKE_AI_MONTHLY_LIMIT_USD = previousLimit;
  }
});
