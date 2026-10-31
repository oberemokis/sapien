import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { useCallback, useEffect } from "react";
import { vaultRead, vaultWrite } from "../infrastructure/vault.api";
import { errorCodeOf, type NoteText } from "../model/vault";
import { EMPTY_NOTES, notesStore } from "../store/notes.store";

// Пауза в наборе, после которой правка уходит на диск. Короткая: окно могут
// закрыть сразу после последней буквы.
const SAVE_DELAY = 400;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const queue = new Map<string, Promise<void>>();

// Под общим префиксом хранилища: правка снаружи перечитывает и заметку.
function noteKey(path: string) {
  return ["vault", "note", path] as const;
}

// Тексты всех заметок, из них берутся теги.
export const TEXTS_KEY = ["vault", "texts"] as const;

function withText(texts: NoteText[] | undefined, path: string, text: string) {
  return texts?.map((note) => {
    if (note.path !== path) {
      return note;
    }

    return { path, text };
  });
}

async function write(queryClient: QueryClient, path: string) {
  const text = notesStore.get().unsaved[path];

  if (text === undefined) {
    return;
  }

  try {
    await vaultWrite(path, text);
  } catch (error) {
    notesStore.setState((state) => ({
      ...state,
      failed: { ...state.failed, [path]: errorCodeOf(error) ?? "note_unwritable" },
    }));
    return;
  }

  // Чтение, начатое до записи, принесло бы прежний текст поверх нового.
  await queryClient.cancelQueries({ queryKey: noteKey(path) });
  queryClient.setQueryData(noteKey(path), text);
  // Теги этой заметки видны сразу, не дожидаясь слежения за папкой.
  queryClient.setQueryData<NoteText[]>(TEXTS_KEY, (texts) => withText(texts, path, text));

  notesStore.setState((state) => {
    const { [path]: _failed, ...failed } = state.failed;

    // Пока шла запись, человек печатал дальше: новый текст ещё не на диске.
    if (state.unsaved[path] !== text) {
      return { ...state, failed };
    }

    const { [path]: _saved, ...unsaved } = state.unsaved;

    return { unsaved, failed };
  });
}

// Пишет правку заметки сейчас, не дожидаясь паузы. Записи одного файла идут
// по очереди: поздняя не обгонит раннюю и не оставит на диске старый текст.
function saveNote(queryClient: QueryClient, path: string) {
  clearTimeout(timers.get(path));
  timers.delete(path);

  const next = (queue.get(path) ?? Promise.resolve()).then(() => write(queryClient, path));
  queue.set(path, next);
  void next.finally(() => {
    if (queue.get(path) === next) {
      queue.delete(path);
    }
  });

  return next;
}

export function forgetNotes() {
  timers.forEach(clearTimeout);
  timers.clear();
  notesStore.setState(() => EMPTY_NOTES);
}

// Текст открытой заметки и его сохранение. Правка человека побеждает:
// пока она не на диске, изменение файла снаружи её не заменяет, а следующая
// запись перекроет его.
export function useNote(path: string) {
  const queryClient = useQueryClient();
  const disk = useQuery({ queryKey: noteKey(path), queryFn: () => vaultRead(path), retry: false });
  const unsaved = useSelector(notesStore, (state) => state.unsaved[path]);
  const failed = useSelector(notesStore, (state) => state.failed[path]);

  // Переход к другому файлу и уход из окна сохраняют правку сразу.
  useEffect(() => {
    function flush() {
      void saveNote(queryClient, path);
    }

    window.addEventListener("blur", flush);

    return () => {
      window.removeEventListener("blur", flush);
      flush();
    };
  }, [queryClient, path]);

  const change = useCallback(
    (text: string) => {
      notesStore.setState((state) => ({ ...state, unsaved: { ...state.unsaved, [path]: text } }));
      clearTimeout(timers.get(path));
      timers.set(
        path,
        setTimeout(() => void saveNote(queryClient, path), SAVE_DELAY),
      );
    },
    [queryClient, path],
  );

  // Пишет правку сейчас: повтор после ошибки, уход на другую вкладку.
  const save = useCallback(() => void saveNote(queryClient, path), [queryClient, path]);
  const readError = errorCodeOf(disk.error);

  return {
    text: unsaved ?? disk.data,
    change,
    save,
    // Файл пропал: показывается последний известный текст.
    missing: readError === "note_missing" || failed === "note_missing",
    unreadable: disk.isError && readError !== "note_missing",
    saveFailed: failed !== undefined && failed !== "note_missing",
  };
}
