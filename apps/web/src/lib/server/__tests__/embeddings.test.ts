import { beforeEach, describe, expect, it, vi } from "vitest";

const getAIClient = vi.fn();
const logServerEvent = vi.fn();

vi.mock("../ai-client", () => ({
  getAIClient: (...args: unknown[]) => getAIClient(...args),
}));
vi.mock("../request-id", () => ({
  logServerEvent: (...args: unknown[]) => logServerEvent(...args),
}));

import { __resetCircuitBreakers } from "../circuit-breaker";
import {
  buildFindingEmbeddingText,
  findingEmbeddingContentHash,
  generateFindingEmbeddings,
  persistFindingEmbeddings,
} from "../embeddings";

const vector = Array.from({ length: 1536 }, (_, index) => index / 1536);

function makeEmbeddingClient() {
  const withResponse = vi.fn().mockResolvedValue({
    data: {
      data: [{ embedding: vector }, { embedding: vector.map((v) => v + 1) }],
    },
    request_id: "provider-req-1",
  });
  const create = vi.fn(() => ({ withResponse }));
  return { client: { embeddings: { create } }, create, withResponse };
}

function makeEmbeddingUpdateDb(result: { error: { message: string } | null }) {
  const abortSignal = vi.fn().mockResolvedValue(result);
  const eq = vi.fn(() => ({ abortSignal }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  return { abortSignal, eq, from, update };
}

describe("finding embeddings", () => {
  beforeEach(() => {
    getAIClient.mockReset();
    logServerEvent.mockReset();
    __resetCircuitBreakers();
  });

  it("builds stable text and content hashes for findings", () => {
    const text = buildFindingEmbeddingText({
      category: "disease",
      severity: "high",
      title: "  Suspected   septoria ",
      description: "Brown spots\non middle fans",
      recommendation: "Remove affected leaves",
    });

    expect(text).toContain("Title: Suspected septoria");
    expect(text).toContain("Description: Brown spots on middle fans");
    expect(findingEmbeddingContentHash(text)).toBe(
      findingEmbeddingContentHash(text),
    );
  });

  it("generates embeddings in one provider batch with a timeout", async () => {
    const { client, create } = makeEmbeddingClient();
    getAIClient.mockReturnValue(client);

    const result = await generateFindingEmbeddings(["one", "two"], {
      requestId: "req-1",
    });

    expect(result).toEqual({
      ok: true,
      embeddings: [vector, vector.map((v) => v + 1)],
      providerRequestId: "provider-req-1",
    });
    expect(create).toHaveBeenCalledWith(
      {
        dimensions: 1536,
        input: ["one", "two"],
        model: "gemini-embedding-2",
      },
      { timeout: 10_000 },
    );
  });

  it("returns a configuration error when embedding client setup fails", async () => {
    getAIClient.mockImplementation(() => {
      throw new Error("client init failed");
    });

    await expect(
      generateFindingEmbeddings(["one"], { requestId: "req-1" }),
    ).resolves.toEqual({ ok: false, code: "configuration_error" });
    expect(logServerEvent).toHaveBeenCalledWith(
      "warn",
      "finding embeddings client init failed",
      expect.objectContaining({
        requestId: "req-1",
        error: "client init failed",
      }),
    );
  });

  it("logs provider _request_id when embedding generation fails", async () => {
    const providerError = Object.assign(new Error("provider unavailable"), {
      _request_id: "provider-req-err",
    });
    const withResponse = vi.fn().mockRejectedValue(providerError);
    const create = vi.fn(() => ({ withResponse }));
    getAIClient.mockReturnValue({ embeddings: { create } });

    await expect(
      generateFindingEmbeddings(["one"], { requestId: "req-1" }),
    ).resolves.toEqual({ ok: false, code: "embedding_unavailable" });
    expect(logServerEvent).toHaveBeenCalledWith(
      "warn",
      "finding embeddings unavailable",
      expect.objectContaining({
        requestId: "req-1",
        providerRequestId: "provider-req-err",
      }),
    );
  });

  it("skips persistence when the stored hash already matches", async () => {
    const text = buildFindingEmbeddingText({
      category: "general",
      severity: "info",
      title: "Observation",
      description: "All good",
    });
    const db = makeEmbeddingUpdateDb({ error: null });

    const result = await persistFindingEmbeddings(
      db,
      [
        {
          id: "finding-1",
          category: "general",
          severity: "info",
          title: "Observation",
          description: "All good",
          embedding: vector,
          embeddingContentHash: findingEmbeddingContentHash(text),
        },
      ],
      { requestId: "req-1" },
    );

    expect(result).toEqual({
      ok: true,
      generated: 0,
      updated: 0,
      skipped: 1,
      failed: 0,
    });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("updates rows with generated embedding vectors and content hashes", async () => {
    const { client } = makeEmbeddingClient();
    getAIClient.mockReturnValue(client);
    const db = makeEmbeddingUpdateDb({ error: null });

    const result = await persistFindingEmbeddings(
      db,
      [
        {
          id: "finding-1",
          category: "disease",
          severity: "medium",
          title: "Leaf spots",
          description: "Brown spots",
          recommendation: null,
        },
        {
          id: "finding-2",
          category: "pest",
          severity: "low",
          title: "Gnats",
          description: "A few gnats",
          recommendation: "Dry back medium",
        },
      ],
      { requestId: "req-1" },
    );

    expect(result).toMatchObject({
      ok: true,
      generated: 2,
      updated: 2,
      failed: 0,
    });
    expect(db.from).toHaveBeenCalledWith("plant_findings");
    expect(db.update).toHaveBeenCalledWith(
      expect.objectContaining({
        embedding: JSON.stringify(vector),
        embedding_content_hash: expect.stringMatching(
          /^v1:gemini-embedding-2:1536:/,
        ),
      }),
    );
    expect(db.eq).toHaveBeenCalledWith("id", "finding-1");
    expect(db.abortSignal).toHaveBeenCalledTimes(2);
  });
});
