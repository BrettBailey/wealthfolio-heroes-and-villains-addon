import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeFakeStorage } from "../fixtures/fakeHostApi";
import { usePersistentState } from "./usePersistentState";

const identity = {
  serialize: (value: string) => value,
  parse: (raw: string) => raw,
};

function renderPersistentState(storage: ReturnType<typeof makeFakeStorage>, defaultValue = "default") {
  return renderHook(() => usePersistentState(storage, "key", defaultValue, identity.serialize, identity.parse));
}

describe("usePersistentState", () => {
  it("starts at the default, then adopts the stored value once the async read resolves", async () => {
    const storage = makeFakeStorage({ key: "saved" });
    const { result } = renderPersistentState(storage);

    expect(result.current[0]).toBe("default");
    expect(result.current[2].isLoaded).toBe(false);

    await waitFor(() => expect(result.current[2].isLoaded).toBe(true));
    expect(result.current[0]).toBe("saved");
  });

  it("keeps the default when nothing is stored", async () => {
    const storage = makeFakeStorage();
    const { result } = renderPersistentState(storage);

    await waitFor(() => expect(result.current[2].isLoaded).toBe(true));
    expect(result.current[0]).toBe("default");
  });

  it("does not write the default back over a saved value while the read is still in flight", async () => {
    const storage = makeFakeStorage({ key: "saved" });
    const set = vi.spyOn(storage, "set");

    const { result } = renderPersistentState(storage);
    await waitFor(() => expect(result.current[2].isLoaded).toBe(true));

    // The mount cycle must never persist anything by itself — only a real user
    // change may write. Otherwise the default clobbers the stored value.
    expect(set).not.toHaveBeenCalled();
    expect(storage.entries.get("key")).toBe("saved");
  });

  it("persists a user change once loaded", async () => {
    const storage = makeFakeStorage({ key: "saved" });
    const { result } = renderPersistentState(storage);
    await waitFor(() => expect(result.current[2].isLoaded).toBe(true));

    act(() => result.current[1]("chosen"));

    expect(result.current[0]).toBe("chosen");
    await waitFor(() => expect(storage.entries.get("key")).toBe("chosen"));
  });

  it("ignores a stored value the parser rejects, falling back to the default", async () => {
    const storage = makeFakeStorage({ key: "corrupt" });
    const { result } = renderHook(() =>
      usePersistentState(storage, "key", "default", identity.serialize, (raw) => (raw === "corrupt" ? null : raw)),
    );

    await waitFor(() => expect(result.current[2].isLoaded).toBe(true));
    expect(result.current[0]).toBe("default");
  });

  it("falls back to the default when the read fails outright", async () => {
    const storage = makeFakeStorage();
    vi.spyOn(storage, "get").mockRejectedValue(new Error("storage unavailable"));

    const { result } = renderPersistentState(storage);

    await waitFor(() => expect(result.current[2].isLoaded).toBe(true));
    expect(result.current[0]).toBe("default");
  });

  it("keeps the new value in memory even if persisting it fails", async () => {
    const storage = makeFakeStorage();
    const { result } = renderPersistentState(storage);
    await waitFor(() => expect(result.current[2].isLoaded).toBe(true));

    vi.spyOn(storage, "set").mockRejectedValue(new Error("disk full"));
    act(() => result.current[1]("chosen"));

    expect(result.current[0]).toBe("chosen");
  });
});
