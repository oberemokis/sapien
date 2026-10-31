import { useSelector } from "@tanstack/react-store";
import { searchStore } from "../store/search.store";

export function useSearchOpen() {
  return useSelector(searchStore, (state) => state.open);
}

export function openSearch() {
  searchStore.setState(() => ({ open: true }));
}

export function closeSearch() {
  searchStore.setState(() => ({ open: false }));
}
