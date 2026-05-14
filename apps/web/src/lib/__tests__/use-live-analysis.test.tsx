// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

type Handler = (_payload: unknown) => void;

interface FakeChannel {
  handlers: Map<string, Handler>;
  on: (
    _event: string,
    _opts: Record<string, unknown>,
    _h: Handler,
  ) => FakeChannel;
  subscribe: () => FakeChannel;
}

const removeChannel = vi.fn();
const channels: FakeChannel[] = [];

function makeChannel(): FakeChannel {
  const ch: FakeChannel = {
    handlers: new Map(),
    on(event, opts, h) {
      // Key by table so tests can fire either insert source explicitly.
      const key = `${event}:${(opts as { table?: string }).table ?? ""}`;
      this.handlers.set(key, h);
      return this;
    },
    subscribe() {
      return this;
    },
  };
  return ch;
}

vi.mock("@/lib/supabase-client", () => ({
  createSupabaseBrowserClient: () => ({
    channel: () => {
      const ch = makeChannel();
      channels.push(ch);
      return ch;
    },
    removeChannel: (...args: unknown[]) => removeChannel(...args),
  }),
}));

import { useLiveAnalysis } from "../use-live-analysis";

function Probe({ growIds }: { growIds: string[] }) {
  useLiveAnalysis({ growIds });
  return null;
}

describe("useLiveAnalysis", () => {
  beforeEach(() => {
    refresh.mockReset();
    removeChannel.mockReset();
    channels.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does nothing when growIds is empty", () => {
    render(<Probe growIds={[]} />);
    expect(channels.length).toBe(0);
  });

  it("subscribes to one channel per growId", () => {
    render(<Probe growIds={["g1", "g2", "g3"]} />);
    expect(channels.length).toBe(3);
    // Each channel should listen on both plant_analyses and plant_findings.
    for (const ch of channels) {
      expect(ch.handlers.has("postgres_changes:plant_analyses")).toBe(true);
      expect(ch.handlers.has("postgres_changes:plant_findings")).toBe(true);
    }
  });

  it("debounces a burst of inserts into a single router.refresh()", () => {
    render(<Probe growIds={["g1"]} />);
    const ch = channels[0]!;
    // Simulate one analysis insert + several findings inserts in quick
    // succession (typical real-world burst).
    ch.handlers.get("postgres_changes:plant_analyses")?.({});
    ch.handlers.get("postgres_changes:plant_findings")?.({});
    ch.handlers.get("postgres_changes:plant_findings")?.({});
    ch.handlers.get("postgres_changes:plant_findings")?.({});

    // Before the debounce window elapses, no refresh has fired.
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(299);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("removes its channels on unmount", () => {
    const { unmount } = render(<Probe growIds={["g1", "g2"]} />);
    expect(channels.length).toBe(2);
    unmount();
    expect(removeChannel).toHaveBeenCalledTimes(2);
  });
});
