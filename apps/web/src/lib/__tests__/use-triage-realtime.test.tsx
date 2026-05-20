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
      // Key by (channel event, postgres event type, table) so the test
      // can fire any of the four subscriptions independently.
      const o = opts as { event?: string; table?: string };
      const key = `${event}:${o.event ?? ""}:${o.table ?? ""}`;
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

import { useTriageRealtime } from "../use-triage-realtime";

function Probe() {
  useTriageRealtime();
  return null;
}

describe("useTriageRealtime", () => {
  beforeEach(() => {
    refresh.mockReset();
    removeChannel.mockReset();
    channels.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("subscribes to a single channel with the four expected listeners", () => {
    render(<Probe />);
    expect(channels.length).toBe(1);
    const ch = channels[0]!;
    expect(ch.handlers.has("postgres_changes:INSERT:plant_findings")).toBe(
      true,
    );
    expect(ch.handlers.has("postgres_changes:UPDATE:plant_findings")).toBe(
      true,
    );
    expect(ch.handlers.has("postgres_changes:INSERT:grow_tasks")).toBe(true);
    expect(ch.handlers.has("postgres_changes:UPDATE:grow_tasks")).toBe(true);
  });

  it("debounces a burst across both tables into a single refresh()", () => {
    render(<Probe />);
    const ch = channels[0]!;
    // Simulate the typical "confirm finding" cascade: finding UPDATE
    // (resolution_state -> confirmed) plus the spawned task INSERT a
    // moment later.
    ch.handlers.get("postgres_changes:UPDATE:plant_findings")?.({});
    ch.handlers.get("postgres_changes:INSERT:grow_tasks")?.({});
    ch.handlers.get("postgres_changes:INSERT:plant_findings")?.({});

    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(299);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("removes its channel on unmount", () => {
    const { unmount } = render(<Probe />);
    expect(channels.length).toBe(1);
    unmount();
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });
});
