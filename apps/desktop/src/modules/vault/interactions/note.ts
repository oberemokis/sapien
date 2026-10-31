import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { useCallback, useEffect } from "react";
import { vaultForgetUnsaved, vaultRead, vaultWrite } from "../infrastructure/vault.api";
import { errorCodeOf, isWithin, movedPath, type Moved, type NoteText, type Unsaved } from "../model/vault";
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

function without<T>(record: Record<string, T>, path: string) {
  const { [path]: _dropped, ...rest } = record;

  return rest;
}

async function write(queryClient: QueryClient, path: string) {
  const { unsaved, bases } = notesStore.get();
  const text = unsaved[path];

  if (text === undefined) {
    return;
  }

  try {
    await vaultWrite(path, text, bases[path] ?? null);
  } catch (error) {
    const code = errorCodeOf(error) ?? "note_unwritable";

    notesStore.setState((state) => ({ ...state, failed: { ...state.failed, [path]: code } }));

    // Файл изменили снаружи: его новый текст нужен на экране рядом с правкой.
    if (code === "note_conflict") {
      void queryClient.invalidateQueries({ queryKey: noteKey(path) });
    }

    return;
  }

  // Чтение, начатое до записи, принесло бы прежний текст поверх нового.
  await queryClient.cancelQueries({ queryKey: noteKey(path) });
  queryClient.setQueryData(noteKey(path), text);
  // Теги этой заметки видны сразу, не дожидаясь слежения за папкой.
  queryClient.setQueryData<NoteText[]>(TEXTS_KEY, (texts) => withText(texts, path, text));

  notesStore.setState((state) => {
    const failed = without(state.failed, path);

    // Пока шла запись, человек печатал дальше: новый текст ещё не на диске,
    // и идёт он уже от записанного.
    if (state.unsaved[path] !== text) {
      return { ...state, bases: { ...state.bases, [path]: text }, failed };
    }

    return { unsaved: without(state.unsaved, path), bases: without(state.bases, path), failed };
  });
}

// Пишет правку заметки сейчас, не дожидаясь паузы. Записи одного файла идут
// по очереди: поздняя не обгонит раннюю и не оставит на диске старый текст.
export function saveNote(queryClient: QueryClient, path: string) {
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

// Спор с правкой снаружи решён в пользу человека: его правка пишется поверх.
function keepMine(queryClient: QueryClient, path: string) {
  notesStore.setState((state) => ({ ...state, bases: without(state.bases, path), failed: without(state.failed, path) }));

  return saveNote(queryClient, path);
}

// Правка заметки больше не нужна: взята версия с диска или файл удалён.
// Из журнала она уходит тоже, иначе следующий запуск предложит её вернуть.
function dropNote(path: string) {
  clearTimeout(timers.get(path));
  timers.delete(path);
  notesStore.setState((state) => ({
    unsaved: without(state.unsaved, path),
    bases: without(state.bases, path),
    failed: without(state.failed, path),
  }));
  void vaultForgetUnsaved(path).catch(() => undefined);
}

// Правки заметок внутри удалённого: человек сам решил, что они не нужны.
export function dropNotesWithin(entry: string) {
  const { unsaved, failed } = notesStore.get();

  for (const path of new Set([...Object.keys(unsaved), ...Object.keys(failed)])) {
    if (isWithin(path, entry)) {
      dropNote(path);
    }
  }
}

function moveKeys<T>(record: Record<string, T>, moved: Moved[]) {
  return Object.fromEntries(Object.entries(record).map(([path, value]) => [movedPath(path, moved), value]));
}

// Файлы переименовали снаружи. Текст с диска, несохранённая правка и её
// основа переходят на новый путь, и правка сразу пишется туда: текст файла
// при переименовании не меняется, и сверка с основой запись пропустит.
// Запись, начатая по прежнему пути, сначала доходит или падает, а потом
// прежний путь забывается вместе с журналом.
export function followNoteMoves(queryClient: QueryClient, moved: Moved[]) {
  for (const [[, , path], text] of queryClient.getQueriesData<string>({ queryKey: ["vault", "note"] })) {
    if (typeof path === "string" && text !== undefined && movedPath(path, moved) !== path) {
      queryClient.setQueryData(noteKey(movedPath(path, moved)), text);
    }
  }

  const left = Object.keys(notesStore.get().unsaved).filter((path) => movedPath(path, moved) !== path);

  notesStore.setState((state) => ({
    unsaved: moveKeys(state.unsaved, moved),
    bases: moveKeys(state.bases, moved),
    failed: Object.fromEntries(Object.entries(state.failed).filter(([path]) => movedPath(path, moved) === path)),
  }));

  for (const path of left) {
    clearTimeout(timers.get(path));
    timers.delete(path);
    void (queue.get(path) ?? Promise.resolve()).then(() => dropNote(path));
    void saveNote(queryClient, movedPath(path, moved));
  }
}

// Правки из журнала встают на место несохранённых и пишутся. Файл с тех пор
// изменили, и запись покажет спор, а не затрёт его.
export function restoreNotes(queryClient: QueryClient, entries: Unsaved[]) {
  notesStore.setState((state) => {
    let { unsaved, bases } = state;

    for (const { path, base, text } of entries) {
      unsaved = { ...unsaved, [path]: text };
      bases = without(bases, path);

      if (base !== null) {
        bases[path] = base;
      }
    }

    return { ...state, unsaved, bases };
  });

  for (const { path } of entries) {
    void saveNote(queryClient, path);
  }
}

export function forgetNotes() {
  timers.forEach(clearTimeout);
  timers.clear();
  notesStore.setState(() => EMPTY_NOTES);
}

// Текст открытой заметки и его сохранение. Пока правка человека не на диске,
// изменение файла снаружи её не заменяет. Запись правки его тоже не затрёт:
// Rust ответит спором, и человек выберет версию сам.
// Текст заметки, как его видит человек: правка, если она есть, иначе файл.
// Только для показа рядом, например в истории версий: без записи и сохранения
// при уходе.
export function useNoteText(path: string) {
  const disk = useQuery({ queryKey: noteKey(path), queryFn: () => vaultRead(path), retry: false });
  const unsaved = useSelector(notesStore, (state) => state.unsaved[path]);

  return { text: unsaved ?? disk.data, loading: disk.isPending };
}

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
      notesStore.setState((state) => {
        const next = { ...state, unsaved: { ...state.unsaved, [path]: text } };
        const read = queryClient.getQueryData<string>(noteKey(path));

        // Первая буква правки запоминает, от какого текста файла она пошла.
        if (state.unsaved[path] === undefined && read !== undefined) {
          next.bases = { ...state.bases, [path]: read };
        }

        return next;
      });
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
  const keep = useCallback(() => void keepMine(queryClient, path), [queryClient, path]);
  const take = useCallback(() => dropNote(path), [path]);
  const readError = errorCodeOf(disk.error);

  return {
    text: unsaved ?? disk.data,
    // Текст файла на диске, когда он разошёлся с правкой.
    disk: disk.data,
    change,
    save,
    keepMine: keep,
    takeDisk: take,
    // Файл пропал: показывается последний известный текст.
    missing: readError === "note_missing" || failed === "note_missing",
    unreadable: disk.isError && readError !== "note_missing",
    conflict: failed === "note_conflict",
    saveFailed: failed !== undefined && failed !== "note_missing" && failed !== "note_conflict",
  };
}
