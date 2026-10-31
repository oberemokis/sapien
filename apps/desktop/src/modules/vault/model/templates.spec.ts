import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES, fillTemplate, formatDate, isTemplate, parseTemplateSettings } from "./templates";

const now = new Date(2026, 9, 29, 14, 5, 9);

describe("шаблоны", () => {
  it("подстановки по умолчанию: имя, дата и время", () => {
    expect(fillTemplate("# {{title}}\n{{date}} {{ time }}", "Встреча", now, DEFAULT_TEMPLATES)).toBe(
      "# Встреча\n2026-10-29 14:05",
    );
  });

  it("неизвестная подстановка остаётся как есть", () => {
    expect(fillTemplate("{{foo}} и {{title}}", "план", now, DEFAULT_TEMPLATES)).toBe("{{foo}} и план");
  });

  it("формат даты и времени из настроек", () => {
    expect(formatDate(now, "DD.MM.YYYY")).toBe("29.10.2026");
    expect(formatDate(now, "HH:mm:ss")).toBe("14:05:09");
  });

  it("испорченные настройки заменяются умолчанием, папка без косых", () => {
    expect(parseTemplateSettings(null)).toEqual(DEFAULT_TEMPLATES);
    expect(parseTemplateSettings({ folder: " /Мои/шаблоны/ ", dateFormat: 5, timeFormat: "" })).toEqual({
      ...DEFAULT_TEMPLATES,
      folder: "Мои/шаблоны",
    });
  });

  it("шаблон это заметка внутри папки шаблонов", () => {
    expect(isTemplate("Шаблоны/встреча.md", "Шаблоны")).toBe(true);
    expect(isTemplate("Шаблоны.md", "Шаблоны")).toBe(false);
    expect(isTemplate("Шаблоны старые/встреча.md", "Шаблоны")).toBe(false);
  });
});
