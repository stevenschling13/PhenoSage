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
    delete process.env["GEMINI_API_KEY"];
    openAICtor.mockReset();
    openAICtor.mockImplementation(function mockClient(
      this: unknown,
      opts: { apiKey: string; baseURL?: string },
    ) {
      // Return a sentinel object so we can identify singleton reuse.
      return { __mock: true, opts };
    } as never);
    vi.resetModules();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("throws when GEMINI_API_KEY is missing", async () => {
    const { getAIClient } = await import("../ai-client");
    expect(() => getAIClient()).toThrow(/GEMINI_API_KEY/);
    expect(openAICtor).not.toHaveBeenCalled();
  });

  it("constructs the SDK pointed at Gemini's OpenAI-compat endpoint", async () => {
    process.env["GEMINI_API_KEY"] = "AIzaTestAbcDefGhiJklMnoPqrStuVwx";
    const { getAIClient } = await import("../ai-client");
    const client = getAIClient();
    expect(openAICtor).toHaveBeenCalledTimes(1);
    const args = (openAICtor as unknown as Mock).mock.calls[0]?.[0];
    expect(args).toMatchObject({
      apiKey: "AIzaTestAbcDefGhiJklMnoPqrStuVwx",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    });
    expect(client).toBeDefined();
  });

  it("returns the same client on subsequent calls (singleton)", async () => {
    process.env["GEMINI_API_KEY"] = "AIzaTestAbcDefGhiJklMnoPqrStuVwx";
    const { getAIClient } = await import("../ai-client");
    const first = getAIClient();
    const second = getAIClient();
    expect(second).toBe(first);
    expect(openAICtor).toHaveBeenCalledTimes(1);
  });
});
