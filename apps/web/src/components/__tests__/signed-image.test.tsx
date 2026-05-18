// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SignedImage } from "../signed-image";

describe("SignedImage", () => {
  it("renders the initial signed URL as the img src", () => {
    render(
      <SignedImage
        plantId="p1"
        imageId="i1"
        initialSrc="https://example.com/a.png?token=initial"
        alt="leaf"
      />,
    );
    const img = screen.getByAltText("leaf") as HTMLImageElement;
    expect(img.src).toBe("https://example.com/a.png?token=initial");
  });

  it("fetches a refreshed URL once when the initial img fires error", async () => {
    const refreshFn = vi.fn().mockResolvedValue({
      signedUrl: "https://example.com/a.png?token=refreshed",
    });
    render(
      <SignedImage
        plantId="p1"
        imageId="i1"
        initialSrc="https://example.com/a.png?token=expired"
        alt="leaf"
        refreshFn={refreshFn}
      />,
    );

    const img = screen.getByAltText("leaf") as HTMLImageElement;
    // Simulate Supabase returning 403 for the expired URL.
    fireEvent.error(img);

    await waitFor(() => {
      expect(img.src).toBe("https://example.com/a.png?token=refreshed");
    });
    expect(refreshFn).toHaveBeenCalledTimes(1);
    expect(refreshFn).toHaveBeenCalledWith({ plantId: "p1", imageId: "i1" });
  });

  it("never refreshes more than once per mount even on a hot error loop", async () => {
    // A perpetually-broken URL would otherwise let the browser fire
    // onError repeatedly while we're waiting on refresh. The ref-based
    // guard inside the component is what prevents that.
    const refreshFn = vi.fn().mockResolvedValue({
      signedUrl: "https://example.com/a.png?token=also-bad",
    });
    render(
      <SignedImage
        plantId="p1"
        imageId="i1"
        initialSrc="https://example.com/a.png?token=expired"
        alt="leaf"
        refreshFn={refreshFn}
      />,
    );

    const img = screen.getByAltText("leaf") as HTMLImageElement;
    fireEvent.error(img);
    fireEvent.error(img);
    fireEvent.error(img);

    await waitFor(() => {
      expect(refreshFn).toHaveBeenCalledTimes(1);
    });
  });

  it("treats a throwing refreshFn as a refresh failure (no unhandled rejection)", async () => {
    // `handleError` is async and wired to an event handler, so an
    // unhandled rejection from `refreshFn` would bubble to the
    // browser's window.onunhandledrejection (and Sentry, etc).
    // Wrapping with `.catch(() => null)` funnels the throw through
    // the same fallback path as a null return.
    const refreshFn = vi.fn().mockRejectedValue(new Error("network down"));
    const onPermanentFailure = vi.fn();
    render(
      <SignedImage
        plantId="p1"
        imageId="i1"
        initialSrc="https://example.com/a.png?token=expired"
        alt="leaf"
        refreshFn={refreshFn}
        fallback={<span data-testid="placeholder">image unavailable</span>}
        onPermanentFailure={onPermanentFailure}
      />,
    );

    const img = screen.getByAltText("leaf") as HTMLImageElement;
    fireEvent.error(img);

    await screen.findByTestId("placeholder");
    expect(onPermanentFailure).toHaveBeenCalledWith(
      "initial-and-refresh-failed",
    );
  });

  it("renders the fallback when both the initial URL and the refresh fail", async () => {
    const refreshFn = vi.fn().mockResolvedValue(null);
    const onPermanentFailure = vi.fn();
    render(
      <SignedImage
        plantId="p1"
        imageId="i1"
        initialSrc="https://example.com/a.png?token=expired"
        alt="leaf"
        refreshFn={refreshFn}
        fallback={<span data-testid="placeholder">image unavailable</span>}
        onPermanentFailure={onPermanentFailure}
      />,
    );

    const img = screen.getByAltText("leaf") as HTMLImageElement;
    fireEvent.error(img);

    await screen.findByTestId("placeholder");
    expect(screen.queryByAltText("leaf")).toBeNull();
    expect(onPermanentFailure).toHaveBeenCalledWith(
      "initial-and-refresh-failed",
    );
  });

  it("renders fallback on the second failure even if the refresh succeeded once", async () => {
    // The refresh URL itself can expire in the rare case the user
    // leaves the page for >1 hour after the first refresh. After two
    // failed loads we stop and show fallback rather than loop.
    const refreshFn = vi.fn().mockResolvedValue({
      signedUrl: "https://example.com/a.png?token=second-but-also-bad",
    });
    const onPermanentFailure = vi.fn();
    render(
      <SignedImage
        plantId="p1"
        imageId="i1"
        initialSrc="https://example.com/a.png?token=expired"
        alt="leaf"
        refreshFn={refreshFn}
        fallback={<span data-testid="placeholder">image unavailable</span>}
        onPermanentFailure={onPermanentFailure}
      />,
    );

    const img = screen.getByAltText("leaf") as HTMLImageElement;
    fireEvent.error(img); // triggers refresh
    await waitFor(() =>
      expect(img.src).toBe(
        "https://example.com/a.png?token=second-but-also-bad",
      ),
    );
    fireEvent.error(img); // second failure → fallback

    await screen.findByTestId("placeholder");
    expect(refreshFn).toHaveBeenCalledTimes(1);
    expect(onPermanentFailure).toHaveBeenCalledTimes(1);
  });

  it("callers get a fresh retry budget by changing key (React idiom)", async () => {
    // This component intentionally does NOT watch `initialSrc` for
    // changes — see the JSDoc. The blessed React pattern for
    // resetting per-mount state is to change `key`, which unmounts
    // and remounts. This test pins that contract so a future
    // refactor doesn't quietly add an effect-based reset (which
    // would re-introduce the cascading-render hazard).
    const refreshFn = vi.fn().mockResolvedValue({
      signedUrl: "https://example.com/refreshed.png",
    });
    const { rerender } = render(
      <SignedImage
        key="i1"
        plantId="p1"
        imageId="i1"
        initialSrc="https://example.com/a.png?token=expired"
        alt="leaf"
        refreshFn={refreshFn}
      />,
    );

    const img = screen.getByAltText("leaf") as HTMLImageElement;
    fireEvent.error(img);
    await waitFor(() => expect(refreshFn).toHaveBeenCalledTimes(1));

    // Changing key forces a fresh mount with its own state. The new
    // initialSrc is honoured because there's no stale "src" left
    // from the previous mount.
    rerender(
      <SignedImage
        key="i2"
        plantId="p1"
        imageId="i2"
        initialSrc="https://example.com/b.png?token=new"
        alt="leaf"
        refreshFn={refreshFn}
      />,
    );

    const updated = screen.getByAltText("leaf") as HTMLImageElement;
    expect(updated.src).toBe("https://example.com/b.png?token=new");
    fireEvent.error(updated);
    await waitFor(() => expect(refreshFn).toHaveBeenCalledTimes(2));
  });
});
