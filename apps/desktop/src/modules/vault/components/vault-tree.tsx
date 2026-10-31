import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import FileAddIcon from "@hugeicons/core-free-icons/FileAddIcon";
import FolderAddIcon from "@hugeicons/core-free-icons/FolderAddIcon";
import RestoreBinIcon from "@hugeicons/core-free-icons/RestoreBinIcon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import SquareLock02Icon from "@hugeicons/core-free-icons/SquareLock02Icon";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { ContextMenu, type MenuItem } from "@/core/ui/context-menu";
import { FileTypeIcon } from "@/core/ui/file-type-icon";
import { Icon } from "@/core/ui/icon";
import { IconButton } from "@/core/ui/icon-button";
import { hasModKey, shortcutLabel } from "@/core/ui/keys";
import {
  cancelCreate,
  openNote,
  selectEntry,
  startCreate,
  toggleFolder,
  useTreeState,
} from "../interactions/tree";
import { openSearch, pickTemplate, showDeleted } from "../interactions/search";
import {
  useCloseForAgent,
  useCreateEntry,
  useTrashEntry,
  useVaultStatus,
  useVaultTree,
} from "../interactions/vault";
import {
  checkName,
  nameProblemOf,
  noteTitle,
  parentOf,
  suggestName,
  type EntryKind,
  type VaultEntry,
} from "../model/vault";
import type { TreeState } from "../store/tree.store";

const ROW = "flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-[13px]";

// Отступ строки от вложенности: ступень 12px, как в дереве MonoCode.
// У заметки нет стрелки, и её место (12px и зазор 6px) уходит в отступ:
// значок заметки встаёт под значок папки того же уровня.
function indent(depth: number, arrow = true) {
  return { paddingLeft: 8 + depth * 12 + (arrow ? 0 : 18) };
}

type Draft = NonNullable<TreeState["draft"]>;

// Поле имени нового элемента. Занятое или недопустимое имя подсвечивается
// сразу, и Enter его не пропускает. Escape отменяет создание, уход фокуса
// создаёт, если имя годится, иначе тоже отменяет.
function DraftRow({ draft, siblings, depth }: { draft: Draft; siblings: VaultEntry[]; depth: number }) {
  const { t } = useTranslation();
  const create = useCreateEntry(draft.id);
  const [name, setName] = useState(() => suggestName(t("vault.untitled"), draft.kind, siblings));
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const problem = checkName(name, draft.kind, siblings);
  const refused = nameProblemOf(create.error);
  let hint: string | null = null;

  if (problem !== null && problem !== "name_empty") {
    hint = t(`vault.create.${problem}`);
  } else if (refused !== null) {
    hint = t(`vault.create.${refused}`);
  } else if (create.isError) {
    hint = t("vault.create.failed");
  }

  // Поле появляется по просьбе создать элемент, и печатать начинают сразу.
  // Имя выделено целиком: начал печатать, и оно заменилось.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function submit() {
    if (problem === null && !create.isPending) {
      create.mutate({ parent: draft.parent, name: name.trim(), kind: draft.kind, template: draft.template });
    }
  }

  return (
    <li className="pr-2" style={indent(depth, false)}>
      <div className="flex h-7 items-center gap-1.5">
        <FileTypeIcon name="draft.md" isFolder={draft.kind === "folder"} />
        <input
          ref={inputRef}
          value={name}
          aria-label={t("vault.create.name")}
          aria-invalid={hint !== null}
          aria-describedby={hint === null ? undefined : hintId}
          readOnly={create.isPending}
          className="h-6 min-w-0 flex-1 rounded-[5px] border border-accent bg-card px-1.5 text-[13px] outline-none selection:bg-accent/35 aria-invalid:border-diff-del"
          onChange={(event) => {
            setName(event.target.value);
            create.reset();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }

            if (event.key === "Escape") {
              event.preventDefault();
              cancelCreate();
            }
          }}
          onBlur={() => {
            if (problem === null) {
              submit();
            } else {
              cancelCreate();
            }
          }}
        />
      </div>
      {hint !== null && (
        <p id={hintId} className="pb-1 pl-5.5 text-[12px] text-diff-del-fg">
          {hint}
        </p>
      )}
    </li>
  );
}

// Строка дерева, на которой случилось событие.
function rowOf(target: EventTarget) {
  return target instanceof Element ? target.closest<HTMLElement>("[data-entry]") : null;
}

// Выделенная строка прокручивается в видимую часть: так на виду оказывается
// и только что созданный элемент.
function Row({
  entry,
  depth,
  selected,
  expanded,
  onClick,
  onMiddleClick,
  children,
}: {
  entry: VaultEntry;
  depth: number;
  selected: boolean;
  expanded?: boolean;
  onClick: (event: MouseEvent) => void;
  // Средняя кнопка мыши.
  onMiddleClick?: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (selected) {
      ref.current?.scrollIntoView({ block: "nearest" });
    }
  }, [selected]);

  return (
    <button
      ref={ref}
      type="button"
      data-entry={entry.path}
      data-folder={entry.kind === "folder" || undefined}
      data-closed={(entry.kind === "folder" && entry.closed) || undefined}
      aria-expanded={expanded}
      aria-current={selected || undefined}
      className={`${ROW} text-content/80 transition-colors duration-120 hover:bg-selection-hover aria-current:bg-selection aria-current:text-content`}
      style={indent(depth, entry.kind === "folder")}
      onClick={onClick}
      onAuxClick={(event) => {
        if (event.button === 1) {
          onMiddleClick?.();
        }
      }}
    >
      {children}
    </button>
  );
}

// Замок у папки, закрытой для агента. Подпись входит в имя строки.
function ClosedMark() {
  const { t } = useTranslation();

  return (
    <span title={t("vault.agent.closed")} className="ml-auto">
      <Icon icon={SquareLock02Icon} size={12} className="text-content/40" />
      <span className="sr-only"> {t("vault.agent.closed")}</span>
    </span>
  );
}

function Entries({
  entries,
  depth,
  parent,
  state,
}: {
  entries: VaultEntry[];
  depth: number;
  parent: string;
  state: TreeState;
}) {
  return (
    <ul>
      {state.draft?.parent === parent && (
        <DraftRow key={state.draft.id} draft={state.draft} siblings={entries} depth={depth} />
      )}
      {entries.map((entry) => {
        const selected = state.selected?.path === entry.path;

        if (entry.kind === "note") {
          return (
            <li key={entry.path}>
              <Row
                entry={entry}
                depth={depth}
                selected={selected}
                onClick={(event) => openNote(entry.path, { newTab: hasModKey(event) })}
                onMiddleClick={() => openNote(entry.path, { newTab: true })}
              >
                <FileTypeIcon name={entry.name} />
                <span className="truncate">{noteTitle(entry.name)}</span>
              </Row>
            </li>
          );
        }

        const open = state.expanded.includes(entry.path);

        return (
          <li key={entry.path}>
            <Row
              entry={entry}
              depth={depth}
              selected={selected}
              expanded={open}
              onClick={() => {
                selectEntry(entry.path, "folder");
                toggleFolder(entry.path);
              }}
            >
              <Icon icon={ArrowRight01Icon} size={12} className={`shrink-0 text-content/50 ${open ? "rotate-90" : ""}`} />
              <FileTypeIcon name={entry.name} isFolder isOpen={open} />
              <span className="truncate">{entry.name}</span>
              {entry.closed && <ClosedMark />}
            </Row>
            {open && <Entries entries={entry.children} depth={depth + 1} parent={entry.path} state={state} />}
          </li>
        );
      })}
    </ul>
  );
}

// ⌘N создаёт файл так же, как кнопка, где бы ни стоял фокус. Код клавиши,
// а не символ: в русской раскладке та же клавиша печатает «т».
function useNewNoteShortcut(enabled: boolean, onCreate: () => void) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.code !== "KeyN" || event.shiftKey || event.altKey || !hasModKey(event)) {
        return;
      }

      event.preventDefault();
      onCreate();
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, onCreate]);
}

type Props = {
  // Зовётся, когда в дереве открылось поле имени: страница показывает
  // спрятанную панель, иначе поля не видно.
  onCreateStart?: () => void;
  // Пункты соседних модулей в меню заметки, например действия агента.
  noteMenu?: (path: string) => MenuItem[];
  // Пункты соседей рядом с «Новым файлом»: создают в папке parent,
  // например черновик задачи.
  createMenu?: (parent: string) => MenuItem[];
};

type Menu = {
  x: number;
  y: number;
  parent: string;
  entry: string | null;
  note: string | null;
  folder: { path: string; closed: boolean } | null;
};

// Дерево хранилища в левой панели. Пока хранилище не открыто, панель пуста:
// что делать, объясняет середина окна.
export function VaultTree({ onCreateStart, noteMenu, createMenu }: Props) {
  const { t } = useTranslation();
  const status = useVaultStatus();
  const tree = useVaultTree();
  const state = useTreeState();
  const [menu, setMenu] = useState<Menu | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const trash = useTrashEntry();
  const closeForAgent = useCloseForAgent();

  const create = useCallback(
    (kind: EntryKind, parent?: string) => {
      startCreate(kind, parent);
      onCreateStart?.();
    },
    [onCreateStart],
  );

  const createNote = useCallback(() => create("note"), [create]);

  useNewNoteShortcut(status.data?.kind === "ready" && tree.data !== undefined, createNote);

  if (status.data?.kind !== "ready" || tree.data === undefined) {
    return null;
  }

  // Правый клик по папке создаёт внутри неё, по заметке рядом с ней,
  // по пустому месту в корне. Строку под курсором меню ещё и удаляет.
  function openMenu(event: MouseEvent) {
    event.preventDefault();
    const row = rowOf(event.target);
    let parent = "";
    let entry: string | null = null;
    let note: string | null = null;
    let folder: Menu["folder"] = null;

    if (row?.dataset.entry !== undefined) {
      const path = row.dataset.entry;
      const isFolder = row.dataset.folder !== undefined;

      selectEntry(path, isFolder ? "folder" : "note");
      parent = isFolder ? path : parentOf(path);
      entry = path;
      note = isFolder ? null : path;
      folder = isFolder ? { path, closed: row.dataset.closed !== undefined } : null;
    }

    setMenu({ x: event.clientX, y: event.clientY, parent, entry, note, folder });
  }

  // ⌘⌫ или Delete на строке дерева, как в Finder и Проводнике.
  function onRowKey(event: ReactKeyboardEvent) {
    const entry = rowOf(event.target)?.dataset.entry;

    if (entry !== undefined && (event.key === "Delete" || (event.key === "Backspace" && hasModKey(event)))) {
      event.preventDefault();
      trash.mutate(entry);
    }
  }

  const menuEntry = menu?.entry ?? null;
  let extra: MenuItem[] = [];

  // Пункты соседей отделены чертой от своих.
  if (menu?.note != null && noteMenu !== undefined) {
    extra = noteMenu(menu.note).map((item, index) => ({ ...item, separated: index === 0 }));
  }

  const folder = menu?.folder ?? null;

  if (folder !== null) {
    extra = [
      {
        label: t(folder.closed ? "vault.agent.open" : "vault.agent.close"),
        separated: true,
        onSelect: () => closeForAgent.mutate({ path: folder.path, closed: !folder.closed }),
      },
    ];
  }

  return (
    <>
      {/* Поле поиска над деревом, как в MonoCode: открывает то же окно, что ⌘K. */}
      <button
        type="button"
        className="mx-1.5 mt-0.5 flex h-8 shrink-0 items-center gap-2 rounded-md border border-stroke px-2 text-[13px] text-content/50 transition-colors duration-120 hover:bg-selection-hover"
        onClick={() => openSearch()}
      >
        <Icon icon={Search01Icon} size={14} className="shrink-0" />
        <span className="flex-1 text-left">{t("vault.search.open")}</span>
        <kbd className="font-sans text-[11px] text-content/40">{shortcutLabel("K")}</kbd>
      </button>
      <div className="flex h-9 shrink-0 items-center gap-1 pr-1.5 pl-3">
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-content/50">
          {status.data.path.split(/[/\\]/).at(-1)}
        </span>
        <IconButton
          icon={FileAddIcon}
          label={t("vault.create.note")}
          shortcut={shortcutLabel("N")}
          onClick={createNote}
        />
        <IconButton icon={FolderAddIcon} label={t("vault.create.folder")} onClick={() => create("folder")} />
        <IconButton icon={RestoreBinIcon} label={t("vault.history.deleted")} onClick={showDeleted} />
      </div>
      {trash.isError && (
        <p role="alert" className="px-3 pb-1 text-[12px] text-diff-del-fg">
          {t("vault.trash.failed")}
        </p>
      )}
      {closeForAgent.isError && (
        <p role="alert" className="px-3 pb-1 text-[12px] text-diff-del-fg">
          {t("vault.agent.failed")}
        </p>
      )}
      {/* Меню по правой кнопке повторяет кнопки над деревом и ⌘⌫ на строке,
          до которых доходят с клавиатуры, поэтому своего пути с клавиатуры
          ему не надо. Клавиши слушает дерево целиком, а приходят они
          со строк, это кнопки. */}
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <nav className="min-h-0 flex-1 overflow-y-auto p-1 pt-0" onContextMenu={openMenu} onKeyDown={onRowKey}>
        {tree.data.length === 0 && state.draft === null && (
          <p className="p-2 text-[13px] text-content/50">{t("files.empty")}</p>
        )}
        <Entries entries={tree.data} depth={0} parent="" state={state} />
      </nav>
      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            { label: t("vault.create.note"), onSelect: () => create("note", menu.parent) },
            {
              label: t("vault.templates.newFile"),
              onSelect: () => pickTemplate({ kind: "newFromTemplate", parent: menu.parent }),
            },
            ...(createMenu?.(menu.parent) ?? []),
            { label: t("vault.create.folder"), onSelect: () => create("folder", menu.parent) },
            menuEntry === null
              ? { label: t("vault.history.deleted"), onSelect: showDeleted }
              : { label: t("vault.trash.action"), onSelect: () => trash.mutate(menuEntry) },
            ...extra,
          ]}
          onClose={closeMenu}
        />
      )}
    </>
  );
}
