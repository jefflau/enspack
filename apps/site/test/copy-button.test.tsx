import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyButton } from "../src/components/copy-button.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CopyButton", () => {
  it("shows Copied after the async clipboard succeeds", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CopyButton value="abc" />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByRole("button")).toHaveTextContent("Copied"));
    expect(writeText).toHaveBeenCalledWith("abc");
  });

  it("falls back to execCommand when the clipboard API is denied", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) },
      configurable: true,
    });
    const exec = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { value: exec, configurable: true });
    render(<CopyButton value="abc" />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByRole("button")).toHaveTextContent("Copied"));
    expect(exec).toHaveBeenCalledWith("copy");
  });
});
