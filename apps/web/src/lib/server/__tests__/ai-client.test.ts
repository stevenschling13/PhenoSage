import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

// Mock the openai SDK so we don't need a real API key to construct the client.
const openAICtor = vi.fn();
vi.mock("openai", () => ({
  default: openAICtor,
}));

const ORIGINAL_ENV = process.env;

describe("getAIClient", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env["OPENAI_API_KEY"];
    openAICtor.mockReset();
    openAICtor.mockImplementation(function mockClient(
      this: unknown,
      opts: { apiKey: string },
    ) {
      // Return a sentinel object so we can identify singleton reuse.
      return { __mock: true, opts };
    } as never);
    vi.resetModules();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("throws when OPENAI_API_KEY is missing", async () => {
    const { getAIClient } = await import("../ai-client");
    expect(() => getAIClient()).toThrow(/OPENAI_API_KEY/);
    expect(openAICtor).not.toHaveBeenCalled();
  });

  it("constructs an OpenAI client with the env key when present", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test-abc";
    const { getAIClient } = await import("../ai-client");
    const client = getAIClient();
    expect(openAICtor).toHaveBeenCalledTimes(1);
    expect((openAICtor as unknown as Mock).mock.calls[0]?.[0]).toEqual({
      apiKey: "sk-test-abc",
    });
    expect(client).toBeDefined();
  });

  it("returns the same client on subsequent calls (singleton)", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test-abc";
    const { getAIClient } = await import("../ai-client");
    const first = getAIClient();
    const second = getAIClient();
    expect(second).toBe(first);
    expect(openAICtor).toHaveBeenCalledTimes(1);
  });
});
