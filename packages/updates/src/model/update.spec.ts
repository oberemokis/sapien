import { describe, expect, it } from "vitest";
import { percentOf, releaseItems } from "./update";

describe("описание релиза", () => {
  it("пункты без типа коммита, автора, адреса и новых участников", () => {
    const notes = `## What's Changed
* feat(agent)!: действия из чата by @oberemokis in https://github.com/oberemokis/sapien/pull/65
* fix: курсор после сохранения by @some-one in https://github.com/oberemokis/sapien/pull/66
- Свой пункт без автора

## New Contributors
* @some-one made their first contribution in https://github.com/oberemokis/sapien/pull/66

**Full Changelog**: https://github.com/oberemokis/sapien/compare/v0.1.0...v0.2.0`;

    expect(releaseItems(notes)).toEqual(["Действия из чата", "Курсор после сохранения", "Свой пункт без автора"]);
  });

  it("пустое описание и повтор пункта", () => {
    expect(releaseItems(null)).toEqual([]);
    expect(releaseItems("* одно\n* одно")).toEqual(["Одно"]);
  });
});

describe("ход загрузки", () => {
  it("проценты только при известном размере", () => {
    expect(percentOf({ kind: "chunk", received: 256, total: 1024 })).toBe(25);
    expect(percentOf({ kind: "chunk", received: 256, total: null })).toBeNull();
    expect(percentOf({ kind: "chunk", received: 0, total: 0 })).toBeNull();
    expect(percentOf({ kind: "downloaded" })).toBeNull();
    expect(percentOf(null)).toBeNull();
  });
});
