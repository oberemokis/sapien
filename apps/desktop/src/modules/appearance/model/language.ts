// Языки окна и меню. Имя каждого написано на нём самом: так его найдёт тот,
// кто не понимает текущего.
export const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "ru", label: "Русский" },
] as const;

export type Language = (typeof LANGUAGES)[number]["value"];

// Без выбора и с побитым значением окно на английском.
export function parseLanguage(raw: unknown): Language {
  return LANGUAGES.find((language) => language.value === raw)?.value ?? "en";
}
