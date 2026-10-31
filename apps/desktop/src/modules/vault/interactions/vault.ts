import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  onVaultChanged,
  onVaultOpen,
  vaultChoose,
  vaultCloseForAgent,
  vaultCreate,
  vaultOpened,
  vaultStatus,
  vaultTrash,
  vaultTree,
  vaultWrite,
} from "../infrastructure/vault.api";
import { errorCodeOf, type EntryKind, type VaultStatus } from "../model/vault";
import { dropNotesWithin, followNoteMoves, forgetNotes } from "./note";
import { readTemplate } from "./templates";
import { closeNotesWithin, finishCreate, followTreeMoves, openNote, resetTree } from "./tree";

type CreateInput = { parent: string; name: string; kind: EntryKind; template?: string; text?: string };

// Шаблон читается до создания: пропал он, и пустой файл не остаётся.
async function createEntry({ template, text: given, ...input }: CreateInput) {
  let text = given;

  if (template !== undefined) {
    text = await readTemplate(template, input.name);
  }

  if (text === undefined) {
    return vaultCreate(input);
  }

  const path = await vaultCreate(input);

  // Файл только что создан пустым, сверять его не с чем.
  await vaultWrite(path, text, null);

  return path;
}

// Ключи из имён команд vault_status и vault_tree: общий префикс ["vault"]
// перечитывает всё хранилище разом.
export const VAULT_KEY = ["vault"] as const;

// Ошибка локального диска за секунду сама не пройдёт: повтор только оттянул
// бы её показ. Повторить можно кнопкой.
export const NO_RETRY = { retry: false } as const;

export function useVaultStatus() {
  return useQuery({ queryKey: [...VAULT_KEY, "status"], queryFn: vaultStatus, ...NO_RETRY });
}

export function useVaultTree() {
  const status = useVaultStatus();

  return useQuery({
    queryKey: [...VAULT_KEY, "tree"],
    queryFn: vaultTree,
    enabled: status.data?.kind === "ready",
    ...NO_RETRY,
  });
}

// Пути в дереве и несохранённые правки относятся к прежней папке. В другой
// папке под тем же путём лежит другой файл, и правка ушла бы не туда.
export function useChooseVault() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: vaultChoose,
    onSuccess: (status) => {
      const before = queryClient.getQueryData<VaultStatus>([...VAULT_KEY, "status"]);
      const same = before !== undefined && "path" in before && "path" in status && before.path === status.path;

      if (!same) {
        resetTree();
        forgetNotes();
      }

      return queryClient.invalidateQueries({ queryKey: VAULT_KEY });
    },
  });
}

// Поле имени уходит, когда дерево уже перечитано: новая строка встаёт
// на его место без мигания. Без поля в дереве, например из поиска, номер
// поля 0: такого поля не бывает, и чужое не закроется.
export function useCreateEntry(draftId = 0) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createEntry,
    onSuccess: async (path, { kind }) => {
      await queryClient.invalidateQueries({ queryKey: VAULT_KEY });
      finishCreate(draftId, path, kind);
    },
  });
}

// Файл или папка, которых может не быть. Занятое имя значит, что они уже
// есть: существующее не трогается, и ответ null.
export async function createMissing(parent: string, name: string, kind: EntryKind) {
  try {
    return await vaultCreate({ parent, name, kind });
  } catch (error) {
    if (errorCodeOf(error) !== "name_taken") {
      throw error;
    }

    return null;
  }
}

type NoteInput = { folder: string; name: string; text: string };

// Заметка с готовым текстом в папке, которой может ещё не быть, вложенной
// тоже: так соседние модули кладут в хранилище свои файлы. Пустая папка
// это корень. Занятое имя заметки отвечает name_taken, как поле имени
// в дереве. Вкладку новая заметка не открывает.
export function useCreateNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ folder, name, text }: NoteInput) => {
      const parts = folder.split("/").filter((part) => part !== "");

      for (const [index, part] of parts.entries()) {
        // oxlint-disable-next-line no-await-in-loop -- папка появляется раньше вложенной
        await createMissing(parts.slice(0, index).join("/"), part, "folder");
      }

      return createEntry({ parent: parts.join("/"), name, kind: "note", text });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: VAULT_KEY }),
  });
}

// Удалённое уходит в системную корзину, оттуда его можно вернуть. Вкладки
// внутри него закрываются, а правки забываются: человек сам решил, что они
// не нужны.
export function useTrashEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: vaultTrash,
    onSuccess: (_, entry) => {
      dropNotesWithin(entry);
      closeNotesWithin(entry);

      return queryClient.invalidateQueries({ queryKey: VAULT_KEY });
    },
  });
}

// Папка закрыта для агента или открыта снова: дерево перечитывается
// и показывает замок.
export function useCloseForAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ path, closed }: { path: string; closed: boolean }) => vaultCloseForAgent(path, closed),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: VAULT_KEY }),
  });
}

// Перечитывает хранилище, когда Rust сообщает о правке снаружи, и когда окно
// снова в фокусе: папку могли переименовать, пока окно было в фоне, а слежение
// за переименованием самой папки есть не на всех системах. Переименованное
// снаружи окно переводит на новые пути до того, как перечитать: иначе
// вкладка на миг узнала бы, что файла нет. Открывает заметки, на которые
// вела ссылка sapien://.
export function useVaultSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    function refresh() {
      void queryClient.invalidateQueries({ queryKey: VAULT_KEY });
    }

    const stop = onVaultChanged((moved) => {
      if (moved.length > 0) {
        followNoteMoves(queryClient, moved);
        followTreeMoves(moved);
      }

      refresh();
    });
    window.addEventListener("focus", refresh);

    return () => {
      stop();
      window.removeEventListener("focus", refresh);
    };
  }, [queryClient]);

  // Ссылка sapien://, которой приложение запустили, приходит раньше этой
  // подписки, поэтому заметки из ссылок забираются и сразу, и по событию.
  // Ссылка пришла снаружи и не знает, что открыто сейчас: заметка встаёт
  // новой вкладкой, а не на место той, с которой работают.
  useEffect(() => {
    function openLinked() {
      void vaultOpened()
        .then((paths) => {
          for (const path of paths) {
            openNote(path, { focus: true, newTab: true });
          }
        })
        .catch(() => undefined);
    }

    openLinked();

    return onVaultOpen(openLinked);
  }, []);
}
