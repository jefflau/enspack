import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

describe("GET / static claim page", () => {
  it("returns HTML containing the form ids", async () => {
    const { app, db } = await createTestApp();
    try {
      const res = await app.request("/");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('id="hf-namespace"');
      expect(html).toContain('id="connect"');
      expect(html).toContain('id="create-claim"');
      expect(html).toContain('id="challenge"');
      expect(html).toContain('id="file-contents"');
      expect(html).toContain('id="sign"');
      expect(html).toContain('id="repo"');
      expect(html).toContain('id="verify"');
      expect(html).toContain('id="status"');
      expect(html).toContain('id="ens-version"');
    } finally {
      await db.close();
    }
  });
});
