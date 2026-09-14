import { describe, expect, it } from "vitest";
import { createDb, selectDriver } from "../src/db.js";

describe("db drivers", () => {
  it("selects pglite when DATABASE_URL is unset and pg when it is set", () => {
    expect(selectDriver(undefined)).toBe("pglite");
    expect(selectDriver("")).toBe("pglite");
    expect(selectDriver("postgres://enspack:enspack@127.0.0.1:5432/enspack")).toBe("pg");
  });

  it("applies schema on PGlite and round-trips a claims row", async () => {
    const db = await createDb();
    expect(db.driver).toBe("pglite");
    await db.query(
      `INSERT INTO claims (id, hf_namespace, label, address, challenge, expires_at, verified, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE, $7)`,
      [
        "claim-1",
        "alice",
        "alice",
        "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
        "enspack-verify:ab",
        "2026-09-15T00:00:00.000Z",
        "2026-09-14T00:00:00.000Z",
      ],
    );
    const { rows } = await db.query<{ label: string }>("SELECT label FROM claims WHERE id = $1", [
      "claim-1",
    ]);
    expect(rows[0]?.label).toBe("alice");
    await db.close();
  });
});
