/**
 * Unit test cho `lib/vnDate.ts`. Run directly with:
 *   node --experimental-strip-types lib/__tests__/vnDate.test.mts
 */

import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

// Allow Node ESM (`--experimental-strip-types`) to resolve extensionless relative `.ts` imports
// used by Next.js / TypeScript `moduleResolution: "bundler"` — tsc disallows an explicit `.ts`
// extension in the import path (TS5097), so we resolve it at runtime instead (same pattern as
// lib/__tests__/zaloMessageContent.test.mts).
const tsResolveHook = `
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

export async function resolve(specifier, context, nextResolve) {
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !/\\.(?:[cm]?js|[cm]?ts|json)$/i.test(specifier) &&
    context.parentURL
  ) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    const tsCandidate = path.resolve(parentDir, specifier + ".ts");
    if (existsSync(tsCandidate)) {
      return nextResolve(pathToFileURL(tsCandidate).href, context);
    }
  }
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript;base64,${Buffer.from(tsResolveHook).toString("base64")}`);

const { vnTodayIso } = await import("../vnDate");

test("vnTodayIso: 03:00 gio VN (= 20:00 UTC hom truoc) tra ve dung ngay lich VN, khong phai ngay UTC", () => {
  // UTC 2026-11-25T20:00:00Z = VN (UTC+7) 2026-11-26T03:00:00 -> phai la "2026-11-26".
  // Bug cu (new Date().toISOString().slice(0,10)) se tra ve "2026-11-25" (sai).
  const mocked = new Date("2026-11-25T20:00:00.000Z");
  assert.equal(vnTodayIso(mocked), "2026-11-26");
});

test("vnTodayIso: dung luc nua dem VN (00:00) van la ngay moi theo gio VN", () => {
  // UTC 2026-11-25T17:00:00Z = VN 2026-11-26T00:00:00 -> "2026-11-26".
  const mocked = new Date("2026-11-25T17:00:00.000Z");
  assert.equal(vnTodayIso(mocked), "2026-11-26");
});

test("vnTodayIso: ngoai khung lech (buoi chieu/toi VN) van dung, khop UTC cung ngay", () => {
  // UTC 2026-11-26T10:00:00Z = VN 2026-11-26T17:00:00 -> "2026-11-26" (khong lech).
  const mocked = new Date("2026-11-26T10:00:00.000Z");
  assert.equal(vnTodayIso(mocked), "2026-11-26");
});

test("vnTodayIso: khong truyen now mac dinh dung Date.now(), tra ve chuoi YYYY-MM-DD hop le", () => {
  const result = vnTodayIso();
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
});
