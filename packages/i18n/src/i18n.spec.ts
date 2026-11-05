import { changeLanguage, t } from "i18next";
import { describe, expect, it } from "vitest";
import { startI18n } from "./index";

// Пакет со строками дополняет Resources так же, только своим словарём.
declare module "./index" {
  interface Resources {
    translation: { greeting: string; panes: { label: string } };
  }
}

const ru = { greeting: "Привет", panes: { label: "Панель {{index}}" } };

startI18n({ translation: { ru, en: { greeting: "Hello", panes: { label: "Pane {{index}}" } } } });

describe("словари", () => {
  it("без выбора окно на английском, выбор переключает язык", async () => {
    expect(t("greeting")).toBe("Hello");

    await changeLanguage("ru");

    expect(t("panes.label", { index: 2 })).toBe("Панель 2");
    await changeLanguage("en");
  });

  // Проверку делает tsc пакета: строка с @ts-expect-error без ошибки под
  // ней сама становится ошибкой, если `t` начнёт принимать любую строку.
  it("опечатка в ключе и неполный перевод не компилируются", () => {
    // @ts-expect-error ключа greting нет в словаре
    expect(t("greting")).toBe("greting");

    const incomplete: Parameters<typeof startI18n>[0] = {
      translation: {
        ru,
        // @ts-expect-error в переводе нет panes.label
        en: { greeting: "Hello", panes: {} },
      },
    };

    expect(incomplete.translation.ru).toBe(ru);
  });
});
