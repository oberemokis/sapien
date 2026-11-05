import { afterEach, describe, expect, it, vi } from "vitest";
import { defineSetting } from "./index";

const SIDES = ["left", "right"] as const;
type Side = (typeof SIDES)[number];

function parseSide(stored: unknown): Side {
  return SIDES.find((side) => side === stored) ?? "left";
}

function parseOrder(stored: unknown): string[] {
  if (!Array.isArray(stored)) {
    return [];
  }

  return stored.map(String);
}

const side = defineSetting({ key: "test.side", parse: parseSide, fallback: "left", text: true });
const order = defineSetting({ key: "test.order", parse: parseOrder, fallback: [] });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("настройка устройства", () => {
  it("строка лежит как есть, остальное JSON", () => {
    side.write("right");
    order.write(["b", "a"]);

    expect(localStorage.getItem("test.side")).toBe("right");
    expect(localStorage.getItem("test.order")).toBe('["b","a"]');
    expect(side.read()).toBe("right");
    expect(order.read()).toEqual(["b", "a"]);
  });

  it("нет записи, побитая запись или чужое значение дают значение по умолчанию", () => {
    expect(order.read()).toEqual([]);

    localStorage.setItem("test.order", "[");
    localStorage.setItem("test.side", "up");

    expect(order.read()).toEqual([]);
    expect(side.read()).toBe("left");
  });

  it("закрытое хранилище окна не роняет ни чтение, ни запись", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new DOMException("закрыто политикой", "SecurityError");
    });
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("закрыто политикой", "SecurityError");
    });

    expect(() => side.write("right")).not.toThrow();
    expect(side.read()).toBe("left");
  });
});
