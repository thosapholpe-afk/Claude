import { describe, expect, it } from "vitest";
import { mapQuestions, parseFormPage } from "../server/form";

const page = (items: unknown[]) =>
  `<html><script type="text/javascript" nonce="x">var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify([null, ["", items, null, null, null, null, null, null, "Sign-ups"], "/forms", "Thosaphol Connect sign-ups", null, null, null, "", null, 0, 0])};</script></html>`;

const q = (id: number, title: string, entry: number, required = 0) => [id, title, null, 0, [[entry, null, required]]];

describe("Google Form setup", () => {
  it("reads questions and entry IDs from the public page", () => {
    const p = parseFormPage(page([q(1, "ชื่อที่ใช้แสดง", 101, 1), q(2, "Email", 102), [3, "Section", null, 8, null], q(4, "Login provider", 104), q(5, "Role", 105), q(6, "Organization", 106), q(7, "Event", 107), q(8, "เวลา", 108)]))!;
    expect(p.title).toBe("Thosaphol Connect sign-ups");
    expect(p.questions).toHaveLength(7);
    expect(p.questions[0]).toEqual({ title: "ชื่อที่ใช้แสดง", entry: "101", required: true });
    const { map, left, byOrder } = mapQuestions(p.questions);
    expect(byOrder).toBe(false);
    expect(left).toHaveLength(0);
    expect(Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v!.entry]))).toEqual({ name: "101", email: "102", provider: "104", role: "105", org: "106", event: "107", time: "108" });
  });

  it("falls back to question order when titles are generic", () => {
    const p = parseFormPage(page([1, 2, 3, 4, 5, 6, 7].map((i) => q(i, `Q${i}`, 200 + i))))!;
    const { map, byOrder } = mapQuestions(p.questions);
    expect(byOrder).toBe(true);
    expect(map.name?.entry).toBe("201");
    expect(map.time?.entry).toBe("207");
  });

  it("returns null for pages without form data", () => {
    expect(parseFormPage("<html>Sign in to continue</html>")).toBeNull();
  });
});
