import { describe, expect, it } from "vitest";
import { resolveLocalImport } from "./index.js";

describe("resolveLocalImport", () => {
  it("resolves extensionless TypeScript imports", () => {
    expect(
      resolveLocalImport(
        "src/routes/login.ts",
        "../services/auth",
        new Set(["src/services/auth.ts"]),
      ),
    ).toBe("src/services/auth.ts");
  });
});
