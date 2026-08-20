import { describe, expect, it, vi } from "vitest";
import {
  buildEmbeddingInput,
  OllamaEmbeddingProvider,
  OpenAICompatibleEmbeddingProvider,
  TestDeterministicEmbeddingProvider,
  validateEmbeddingVectors,
} from "./index.js";

describe("embedding input", () => {
  it("builds a stable bounded input with provenance", () => {
    const first = buildEmbeddingInput(
      {
        path: "src/server.ts",
        symbol: "registerRoutes",
        startLine: 10,
        endLine: 40,
        content: "x".repeat(1_000),
      },
      256,
    );
    const second = buildEmbeddingInput(
      {
        path: "src/server.ts",
        symbol: "registerRoutes",
        startLine: 10,
        endLine: 40,
        content: "x".repeat(1_000),
      },
      256,
    );
    expect(first).toEqual(second);
    expect(first.text).toContain("PATH: src/server.ts");
    expect(first.text).toHaveLength(256);
    expect(first.truncated).toBe(true);
    expect(first.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});

describe("vector validation", () => {
  it("rejects count, non-finite, zero, and mixed-dimension output", () => {
    expect(() => validateEmbeddingVectors([[1, 2]], 2)).toThrowError(
      /unexpected number of vectors/,
    );
    expect(() => validateEmbeddingVectors([[Number.NaN]], 1)).toThrowError(/finite numbers/);
    expect(() => validateEmbeddingVectors([[0, 0]], 1)).toThrowError(/zero or invalid/);
    expect(() => validateEmbeddingVectors([[1], [1, 2]], 2)).toThrowError(
      /inconsistent dimensions/,
    );
  });
});

describe("embedding providers", () => {
  it("uses Ollama's native embed protocol", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ model: "nomic-embed-text", embeddings: [[0.1, 0.2]] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const provider = new OllamaEmbeddingProvider({
      baseUrl: "http://127.0.0.1:11434/",
      model: "nomic-embed-text",
      fetch: fetchMock as typeof fetch,
    });
    await expect(provider.embed(["hello"])).resolves.toEqual({
      model: "nomic-embed-text",
      vectors: [[0.1, 0.2]],
      dimensions: 2,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/api/embed",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("orders OpenAI-compatible vectors by response index", async () => {
    let receivedInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      receivedInit = init;
      return new Response(
        JSON.stringify({
          model: "embed-v1",
          data: [
            { index: 1, embedding: [0, 1] },
            { index: 0, embedding: [1, 0] },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const provider = new OpenAICompatibleEmbeddingProvider({
      baseUrl: "https://models.example.test/v1",
      apiKey: "secret",
      model: "embed-v1",
      fetch: fetchMock as typeof fetch,
    });
    await expect(provider.embed(["first", "second"])).resolves.toMatchObject({
      vectors: [
        [1, 0],
        [0, 1],
      ],
      dimensions: 2,
    });
    expect(receivedInit?.headers).toMatchObject({ Authorization: "Bearer secret" });
  });

  it("classifies retryable upstream failures without exposing their body", async () => {
    const provider = new OllamaEmbeddingProvider({
      baseUrl: "http://ollama.invalid",
      model: "embed-v1",
      fetch: vi.fn(
        async () => new Response("api-key=do-not-leak", { status: 503 }),
      ) as typeof fetch,
    });
    await expect(provider.embed(["hello"])).rejects.toMatchObject({
      code: "EMBEDDING_UPSTREAM_UNAVAILABLE",
      retryable: true,
      message: "The configured embedding provider returned an error.",
    });
  });

  it("provides deterministic non-zero vectors for tests", async () => {
    const provider = new TestDeterministicEmbeddingProvider(8);
    const first = await provider.embed(["database transaction", "background lease"]);
    const second = await provider.embed(["database transaction", "background lease"]);
    expect(first).toEqual(second);
    expect(first.dimensions).toBe(8);
    expect(first.vectors[0]).not.toEqual(first.vectors[1]);
  });
});
