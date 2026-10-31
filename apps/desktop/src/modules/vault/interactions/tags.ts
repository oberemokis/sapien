import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { tagsOf } from "@/core/markdown/tags";
import { vaultTexts } from "../infrastructure/vault.api";
import { tagList, type NoteTags } from "../model/tags";
import type { NoteText } from "../model/vault";
import { TEXTS_KEY } from "./note";
import { NO_RETRY, useVaultStatus } from "./vault";

// ponytail: каждая правка в хранилище перечитывает и разбирает все заметки.
// Когда на большом хранилище это станет заметно, разбирать только
// изменившиеся файлы.
function noteTagsOf(texts: NoteText[]): NoteTags[] {
  return texts.map(({ path, text }) => ({ path, tags: tagsOf(text) }));
}

// Теги каждой заметки. Ключ под общим префиксом хранилища: правка снаружи
// перечитывает и теги, своя правка кладёт текст сюда сама.
export function useNoteTags() {
  const status = useVaultStatus();

  return useQuery({
    queryKey: TEXTS_KEY,
    queryFn: vaultTexts,
    select: noteTagsOf,
    enabled: status.data?.kind === "ready",
    ...NO_RETRY,
  });
}

// Все теги хранилища с числом заметок.
export function useTagList() {
  const noteTags = useNoteTags();

  return useMemo(() => tagList(noteTags.data ?? []), [noteTags.data]);
}
