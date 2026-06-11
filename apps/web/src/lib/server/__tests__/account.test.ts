import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const createSupabaseServerClient = vi.fn();
const getServerUser = vi.fn();
const getDbClient = vi.fn();
const getStorageClient = vi.fn();
const logServerEvent = vi.fn();

vi.mock("../auth", () => ({
  createSupabaseServerClient: (...args: unknown[]) =>
    createSupabaseServerClient(...args),
  getServerUser: (...args: unknown[]) => getServerUser(...args),
}));
vi.mock("../db", () => ({
  getDbClient: (...args: unknown[]) => getDbClient(...args),
}));
vi.mock("../storage", () => ({
  getStorageClient: (...args: unknown[]) => getStorageClient(...args),
}));
vi.mock("../request-id", () => ({
  logServerEvent: (...args: unknown[]) => logServerEvent(...args),
}));

import { deleteAccount, exportAccountData } from "../account";

describe("exportAccountData", () => {
  beforeEach(() => {
    for (const mock of [createSupabaseServerClient, getServerUser]) {
      (mock as Mock).mockReset();
    }
  });

  it("returns null when there is no authenticated user", async () => {
    getServerUser.mockResolvedValue(null);
    await expect(exportAccountData()).resolves.toBeNull();
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("collects every table through the RLS-scoped session client", async () => {
    getServerUser.mockResolvedValue({ id: "u1", email: "a@b.co" });
    const queried: string[] = [];
    const from = vi.fn((table: string) => {
      queried.push(table);
      return {
        select: vi.fn(() => ({
          limit: vi
            .fn()
            .mockResolvedValue({ data: [{ id: `${table}-row` }], error: null }),
        })),
      };
    });
    createSupabaseServerClient.mockResolvedValue({ from });

    const result = await exportAccountData();

    expect(result?.userId).toBe("u1");
    expect(result?.email).toBe("a@b.co");
    expect(queried).toContain("grows");
    expect(queried).toContain("plant_findings");
    expect(queried).toContain("chat_messages");
    expect(result?.tables["grows"]).toEqual([{ id: "grows-row" }]);
  });

  it("throws when any table read fails", async () => {
    getServerUser.mockResolvedValue({ id: "u1", email: null });
    const from = vi.fn((table: string) => ({
      select: vi.fn(() => ({
        limit: vi
          .fn()
          .mockResolvedValue(
            table === "plants"
              ? { data: null, error: { message: "denied" } }
              : { data: [], error: null },
          ),
      })),
    }));
    createSupabaseServerClient.mockResolvedValue({ from });

    await expect(exportAccountData()).rejects.toThrow(
      "Failed to export plants: denied",
    );
  });
});

describe("deleteAccount", () => {
  const deleteUser = vi.fn();
  const remove = vi.fn();

  function makeDb(opts: {
    growIds?: string[];
    uploadedPaths?: string[];
    growPaths?: string[];
  }) {
    const from = vi.fn((table: string) => {
      if (table === "grows") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: (opts.growIds ?? []).map((id) => ({ id })),
              error: null,
            }),
          })),
        };
      }
      // plant_images: .select().eq() for uploads, .select().in() for grows
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({
            data: (opts.uploadedPaths ?? []).map((p) => ({
              storage_path: p,
            })),
            error: null,
          }),
          in: vi.fn().mockResolvedValue({
            data: (opts.growPaths ?? []).map((p) => ({ storage_path: p })),
            error: null,
          }),
        })),
      };
    });
    return { from, auth: { admin: { deleteUser } } };
  }

  beforeEach(() => {
    getDbClient.mockReset();
    getStorageClient.mockReset();
    logServerEvent.mockReset();
    deleteUser.mockReset();
    remove.mockReset();
    deleteUser.mockResolvedValue({ error: null });
    // Mirror the real Storage API: remove() resolves with the list of
    // objects it actually deleted.
    remove.mockImplementation((paths: string[]) =>
      Promise.resolve({ data: paths.map((name) => ({ name })), error: null }),
    );
    getStorageClient.mockReturnValue({ from: vi.fn(() => ({ remove })) });
  });

  it("removes the union of uploaded + owned-grow images, then the auth user", async () => {
    getDbClient.mockReturnValue(
      makeDb({
        growIds: ["g1"],
        uploadedPaths: ["p1/a.jpg", "p1/b.jpg"],
        growPaths: ["p1/b.jpg", "p2/c.jpg"],
      }),
    );

    const result = await deleteAccount("u1", "req-1");

    // Deduplicated union: 3 unique paths in one batch.
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining(["p1/a.jpg", "p1/b.jpg", "p2/c.jpg"]),
    );
    expect(remove.mock.calls[0]?.[0]).toHaveLength(3);
    expect(deleteUser).toHaveBeenCalledWith("u1");
    expect(result.deletedStorageObjects).toBe(3);
    expect(result.storageErrors).toBe(0);
  });

  it("still deletes the auth user when a storage batch fails", async () => {
    getDbClient.mockReturnValue(
      makeDb({ growIds: [], uploadedPaths: ["p1/a.jpg"] }),
    );
    remove.mockResolvedValue({ error: { message: "storage down" } });

    const result = await deleteAccount("u1", "req-1");

    expect(deleteUser).toHaveBeenCalledWith("u1");
    expect(result.storageErrors).toBe(1);
    expect(logServerEvent).toHaveBeenCalledWith(
      "warn",
      "account delete: storage batch failed",
      expect.objectContaining({ userId: "u1" }),
    );
  });

  it("skips storage entirely when the user has no images", async () => {
    getDbClient.mockReturnValue(makeDb({ growIds: [] }));
    await deleteAccount("u1", "req-1");
    expect(getStorageClient).not.toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalledWith("u1");
  });

  it("throws and does not touch storage when the grow listing fails", async () => {
    const from = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi
          .fn()
          .mockResolvedValue({ data: null, error: { message: "boom" } }),
      })),
    }));
    getDbClient.mockReturnValue({ from, auth: { admin: { deleteUser } } });

    await expect(deleteAccount("u1", "req-1")).rejects.toThrow(
      "Failed to list grows for deletion: boom",
    );
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("throws when auth user deletion fails", async () => {
    getDbClient.mockReturnValue(makeDb({ growIds: [] }));
    deleteUser.mockResolvedValue({ error: { message: "admin denied" } });
    await expect(deleteAccount("u1", "req-1")).rejects.toThrow(
      "Failed to delete auth user: admin denied",
    );
  });
});
