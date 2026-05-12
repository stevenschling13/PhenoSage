// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

const uploadToSignedUrl = vi.fn();
vi.mock("@/lib/supabase-client", () => ({
  createSupabaseBrowserClient: () => ({
    storage: {
      from: () => ({
        uploadToSignedUrl,
      }),
    },
  }),
}));

import { UploadPhotoPanel } from "@/components/upload-photo-panel";

type FetchInit = RequestInit | undefined;
type FetchCall = [string, FetchInit];

function makeFile(name = "leaf.png", type = "image/png", size = 1024): File {
  return new File([new Uint8Array(size)], name, { type });
}

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  }) as unknown as Response;
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  refresh.mockClear();
  uploadToSignedUrl.mockReset();
  uploadToSignedUrl.mockResolvedValue({ error: null });
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function getFetchCall(index: number): FetchCall {
  return fetchSpy.mock.calls[index] as FetchCall;
}

// The file input is sr-only but associated to the visible "Choose image"
// label via htmlFor, so getByLabelText follows the accessible relationship.
function getFileInput(): HTMLInputElement {
  return screen.getByLabelText(/choose image/i) as HTMLInputElement;
}

describe("UploadPhotoPanel", () => {
  it("shows the empty hint and disables submit until a file is selected", () => {
    render(<UploadPhotoPanel plantId="plant-1" />);
    expect(screen.getByText(/no image selected yet/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /upload photo/i }),
    ).toBeDisabled();
  });

  it("rejects unsupported file types with an assertive alert", async () => {
    render(<UploadPhotoPanel plantId="plant-1" />);
    const input = getFileInput();
    // Use fireEvent.change to bypass userEvent's `accept` attribute check —
    // this exercises our own handler's defense-in-depth rejection.
    const gif = new File(["x"], "evil.gif", { type: "image/gif" });
    fireEvent.change(input, { target: { files: [gif] } });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/use jpg, png, webp, or heic/i);
    expect(
      screen.getByRole("button", { name: /upload photo/i }),
    ).toBeDisabled();
  });

  it("rejects files larger than 15 MB", async () => {
    const user = userEvent.setup();
    render(<UploadPhotoPanel plantId="plant-1" />);
    const oversized = makeFile("huge.png", "image/png", 16 * 1024 * 1024);
    const input = getFileInput();
    await user.upload(input, oversized);
    expect(await screen.findByRole("alert")).toHaveTextContent(/under 15 mb/i);
  });

  it("enables submit and shows file details after a valid selection", async () => {
    const user = userEvent.setup();
    render(<UploadPhotoPanel plantId="plant-1" />);
    const input = getFileInput();
    await user.upload(input, makeFile("leaf.png", "image/png", 2048));
    expect(screen.getByText("leaf.png")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /upload photo/i })).toBeEnabled();
  });

  it("runs the full happy path: sign → storage upload → finalize → analyze", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        makeResponse({
          imageId: "img-1",
          storagePath: "plant-1/leaf.png",
          token: "tok-1",
        }),
      )
      .mockResolvedValueOnce(makeResponse({}))
      .mockResolvedValueOnce(
        makeResponse({
          analysis: {
            analysisMode: "openai",
            summary: "Healthy canopy, no anomalies detected.",
          },
        }),
      );

    const user = userEvent.setup();
    render(<UploadPhotoPanel plantId="plant-1" />);
    const input = getFileInput();
    await user.upload(input, makeFile("leaf.png", "image/png", 2048));
    await user.click(screen.getByRole("button", { name: /upload photo/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3));

    const [signUrl, signInit] = getFetchCall(0);
    expect(signUrl).toBe("/api/uploads/sign");
    expect(signInit?.method).toBe("POST");
    expect(JSON.parse((signInit?.body as string) ?? "{}")).toMatchObject({
      contentType: "image/png",
      fileName: "leaf.png",
      plantId: "plant-1",
    });

    expect(uploadToSignedUrl).toHaveBeenCalledWith(
      "plant-1/leaf.png",
      "tok-1",
      expect.any(File),
      { contentType: "image/png" },
    );

    expect(getFetchCall(1)[0]).toBe("/api/plants/plant-1/images");
    expect(getFetchCall(2)[0]).toBe("/api/plants/plant-1/analyze");

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/healthy canopy/i);
    expect(refresh).toHaveBeenCalled();
  });

  it("surfaces a danger alert when the sign endpoint fails", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse({ error: "Storage quota exceeded." }, 500),
    );

    const user = userEvent.setup();
    render(<UploadPhotoPanel plantId="plant-1" />);
    const input = getFileInput();
    await user.upload(input, makeFile("leaf.png", "image/png", 2048));
    await user.click(screen.getByRole("button", { name: /upload photo/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/storage quota exceeded/i);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("downgrades to a warning when analysis is unavailable", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        makeResponse({
          imageId: "img-1",
          storagePath: "plant-1/leaf.png",
          token: "tok-1",
        }),
      )
      .mockResolvedValueOnce(makeResponse({}))
      .mockResolvedValueOnce(makeResponse({ error: "Analysis offline." }, 503));

    const user = userEvent.setup();
    render(<UploadPhotoPanel plantId="plant-1" />);
    const input = getFileInput();
    await user.upload(input, makeFile("leaf.png", "image/png", 2048));
    await user.click(screen.getByRole("button", { name: /upload photo/i }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/analysis offline/i);
    expect(refresh).toHaveBeenCalled();
  });

  it("flags fallback analyses with warning copy", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        makeResponse({
          imageId: "img-1",
          storagePath: "plant-1/leaf.png",
          token: "tok-1",
        }),
      )
      .mockResolvedValueOnce(makeResponse({}))
      .mockResolvedValueOnce(
        makeResponse({
          analysis: {
            analysisMode: "fallback",
            summary: "inconclusive",
          },
        }),
      );

    const user = userEvent.setup();
    render(<UploadPhotoPanel plantId="plant-1" />);
    const input = getFileInput();
    await user.upload(input, makeFile("leaf.png", "image/png", 2048));
    await user.click(screen.getByRole("button", { name: /upload photo/i }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/inconclusive fallback output/i);
  });

  it("surfaces danger when supabase upload itself fails", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeResponse({
        imageId: "img-1",
        storagePath: "plant-1/leaf.png",
        token: "tok-1",
      }),
    );
    uploadToSignedUrl.mockResolvedValueOnce({
      error: { message: "Storage upload denied." },
    });

    const user = userEvent.setup();
    render(<UploadPhotoPanel plantId="plant-1" />);
    const input = getFileInput();
    await user.upload(input, makeFile("leaf.png", "image/png", 2048));
    await user.click(screen.getByRole("button", { name: /upload photo/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/storage upload denied/i);
  });
});
