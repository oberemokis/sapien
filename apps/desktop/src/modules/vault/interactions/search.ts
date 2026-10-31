import { useSelector } from "@tanstack/react-store";
import { FILES, searchStore, type SearchMode } from "../store/search.store";

export function useSearchOpen() {
  return useSelector(searchStore, (state) => state.open);
}

// Запрос, с которым окно открылось. Дальше его правит само окно.
export function useSearchStartQuery() {
  return useSelector(searchStore, (state) => state.query);
}

export function useSearchMode() {
  return useSelector(searchStore, (state) => state.mode);
}

export function openSearch(query = "") {
  searchStore.setState(() => ({ open: true, query, mode: FILES }));
}

// Заметки с тегом: окно поиска с запросом «#тег» и пробелом после него,
// чтобы дописанное слово искалось в имени.
export function showTag(tag: string) {
  openSearch(`#${tag} `);
}

// Окно со списком шаблонов: для нового файла в папке или для вставки
// в открытую заметку.
export function pickTemplate(mode: Exclude<SearchMode, { kind: "files" }>) {
  searchStore.setState(() => ({ open: true, query: "", mode }));
}

export function closeSearch() {
  searchStore.setState(() => ({ open: false, query: "", mode: FILES }));
}
