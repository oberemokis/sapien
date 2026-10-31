import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import FileAddIcon from "@hugeicons/core-free-icons/FileAddIcon";
import FolderAddIcon from "@hugeicons/core-free-icons/FolderAddIcon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import { useCallback, useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ContextMenu } from "@/core/ui/context-menu";
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
import { openSearch } from "../interactions/search";
import { useCreateEntry, useVaultStatus, useVaultTree } from "../interactions/vault";
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
      create.mutate({ parent: draft.parent, name: name.trim(), kind: draft.kind });
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
};

// Дерево хранилища в левой панели. Пока хранилище не открыто, панель пуста:
// что делать, объясняет середина окна.
export function VaultTree({ onCreateStart }: Props) {
  const { t } = useTranslation();
  const status = useVaultStatus();
  const tree = useVaultTree();
  const state = useTreeState();
  const [menu, setMenu] = useState<{ x: number; y: number; parent: string } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

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
  // по пустому месту в корне.
  function openMenu(event: MouseEvent) {
    event.preventDefault();
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-entry]") : null;
    let parent = "";

    if (row?.dataset.entry !== undefined) {
      const path = row.dataset.entry;
      const isFolder = row.dataset.folder !== undefined;

      selectEntry(path, isFolder ? "folder" : "note");
      parent = isFolder ? path : parentOf(path);
    }

    setMenu({ x: event.clientX, y: event.clientY, parent });
  }

  return (
    <>
      {/* Поле поиска над деревом, как в MonoCode: открывает то же окно, что ⌘K. */}
      <button
        type="button"
        className="mx-1.5 mt-0.5 flex h-8 shrink-0 items-center gap-2 rounded-md border border-stroke px-2 text-[13px] text-content/50 transition-colors duration-120 hover:bg-selection-hover"
        onClick={openSearch}
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
      </div>
      {/* Меню по правой кнопке повторяет кнопки над деревом, до которых
          доходят с клавиатуры, поэтому своего пути с клавиатуры ему не надо. */}
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <nav className="min-h-0 flex-1 overflow-y-auto p-1 pt-0" onContextMenu={openMenu}>
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
            { label: t("vault.create.folder"), onSelect: () => create("folder", menu.parent) },
          ]}
          onClose={closeMenu}
        />
      )}
    </>
  );
}
