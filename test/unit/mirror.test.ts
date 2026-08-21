/**
 * The text mirror.
 *
 * Many MCP clients render only the text block, so it has to stand on its own:
 * within budget, honest about what it dropped, and never losing the credit on
 * writing this server did not produce. Appending an attribution and truncating
 * afterwards loses exactly the attribution, which is why the budget is worked
 * out around the trailer instead.
 */

import { describe, expect, it } from "vitest";
import {
  ATTRIBUTION,
  MAX_TEXT_MIRROR_CHARS,
  ok,
  sliceAtLineBoundary,
  truncate,
} from "../../src/tools/shared.js";

const textOf = (result: ReturnType<typeof ok>) => result.content[0]!.text;

const longBody = (chars: number) =>
  Array.from({ length: Math.ceil(chars / 60) }, (_, index) => `${index + 1}. a line of listing`)
    .join("\n")
    .slice(0, chars);

describe("ok()", () => {
  it("ends a short result with its attribution", () => {
    const text = textOf(ok({}, '3 entries for "lantern"'));

    expect(text.endsWith(ATTRIBUTION)).toBe(true);
    expect(text).toContain("3 entries");
  });

  it("keeps the attribution when the body is far over budget", () => {
    const text = textOf(ok({}, longBody(10_000)));

    expect(text.length).toBeLessThanOrEqual(MAX_TEXT_MIRROR_CHARS);
    expect(text.endsWith(ATTRIBUTION), "the credit is what must survive the cut").toBe(true);
  });

  it("says that it shortened the text, since the structured output is not always shown", () => {
    const text = textOf(ok({}, longBody(10_000)));

    expect(text).toContain("shortened");
    expect(text).toContain("structured output");
  });

  it("leaves a body that fits exactly as it was written", () => {
    const body = "one line\nanother line";
    const text = textOf(ok({}, body));

    expect(text).toBe(`${body}\n\n${ATTRIBUTION}`);
  });

  it("makes room for a longer trailer rather than overrunning the budget", () => {
    const sourceUrl = "https://www.metacritic.com/movie/blue-horizon/";
    const text = textOf(ok({}, longBody(10_000), { sourceUrl }));

    expect(text.length).toBeLessThanOrEqual(MAX_TEXT_MIRROR_CHARS);
    expect(text.endsWith(`${ATTRIBUTION} — ${sourceUrl}`)).toBe(true);
  });

  it("carries the notes into the text, since they are what qualifies the answer", () => {
    const notes = ["The list was capped at 25 entries.", "The user score could not be read."];
    const text = textOf(ok({}, longBody(10_000), { notes }));

    expect(text.length).toBeLessThanOrEqual(MAX_TEXT_MIRROR_CHARS);
    for (const note of notes) {
      expect(text).toContain(note);
    }
    expect(text.endsWith(ATTRIBUTION)).toBe(true);
  });

  it("drops the tail of a run of notes rather than crowding out the answer", () => {
    const notes = Array.from({ length: 40 }, (_, index) => `${"n".repeat(120)} ${index}`);
    const text = textOf(ok({}, longBody(10_000), { notes }));

    expect(text.length).toBeLessThanOrEqual(MAX_TEXT_MIRROR_CHARS);
    expect(text).toContain(notes[0] as string);
    expect(text).not.toContain(notes[39] as string);
    const body = text.split("\n\n")[0] ?? "";
    expect(body.length, "the body keeps a readable share").toBeGreaterThan(500);
  });

  it("hands the structured payload through untouched", () => {
    const structured = { results: [{ slug: "blue-horizon" }], notes: [] };
    const result = ok(structured, longBody(10_000));

    expect(result.structuredContent).toBe(structured);
    expect(result.isError).toBeUndefined();
  });
});

describe("truncate()", () => {
  it("marks a cut, so a reader can tell text is missing", () => {
    expect(truncate("abcdefghij", 5)).toContain("…");
    expect(truncate("abcdefghij", 5).length).toBeLessThanOrEqual(5);
  });

  it("leaves text that fits alone", () => {
    expect(truncate("abcde", 5)).toBe("abcde");
  });
});

describe("sliceAtLineBoundary()", () => {
  it("returns everything, and no next offset, when it fits", () => {
    const { slice, nextOffset } = sliceAtLineBoundary("one\ntwo", 0, 100);

    expect(slice).toBe("one\ntwo");
    expect(nextOffset).toBeNull();
  });

  it("cuts on a line boundary and hands back where to resume", () => {
    const text = "first line\nsecond line\nthird line";
    const { slice, nextOffset } = sliceAtLineBoundary(text, 0, 20);

    expect(slice).toBe("first line");
    expect(nextOffset).toBe(10);
    expect(text.slice(nextOffset!)).toContain("second line");
  });

  it("never splits a surrogate pair, which no offset could reassemble", () => {
    const text = `${"a".repeat(9)}🎬🎬🎬`;
    const { slice } = sliceAtLineBoundary(text, 0, 10);

    expect(slice).toBe("a".repeat(9));
    expect(slice).not.toContain("�");
    expect([...slice].every((char) => char.codePointAt(0)! < 0xd800)).toBe(true);
  });

  it("returns nothing for an offset past the end, rather than throwing", () => {
    const { slice, nextOffset } = sliceAtLineBoundary("short", 99, 100);

    expect(slice).toBe("");
    expect(nextOffset).toBeNull();
  });
});
