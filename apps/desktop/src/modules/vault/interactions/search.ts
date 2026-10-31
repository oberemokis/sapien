import { useSelector } from "@tanstack/react-store";
import { searchStore } from "../store/search.store";

export function useSearchOpen() {
  return useSelector(searchStore, (state) => state.open);
}

// Запрос, с которым окно открылось. Дальше его правит само окно.
export function useSearchStartQuery() {
  return useSelector(searchStore, (state) => state.query);
}

export function openSearch(query = "") {
  searchStore.setState(() => ({ open: true, query }));
}

// Заметки с тегом: окно поиска с запросом «#тег» и пробелом после него,
// чтобы дописанное слово искалось в имени.
export function showTag(tag: string) {
  openSearch(`#${tag} `);
}

export function closeSearch() {
  searchStore.setState(() => ({ open: false, query: "" }));
}
