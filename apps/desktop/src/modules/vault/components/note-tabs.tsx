import Add01Icon from "@hugeicons/core-free-icons/Add01Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import {
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { FileTypeIcon } from "@/core/ui/file-type-icon";
import { Icon } from "@/core/ui/icon";
import { IconButton } from "@/core/ui/icon-button";
import { hasModKey, shortcutLabel } from "@/core/ui/keys";
import {
  closeActiveNote,
  closeNote,
  cycleNotes,
  keepExistingTabs,
  moveNote,
  startCreate,
  switchNote,
  useTreeState,
} from "../interactions/tree";
import { useVaultStatus, useVaultTree } from "../interactions/vault";
import { notesOf } from "../model/search";
import { tabLabels } from "../model/tabs";

// Указатель сдвинулся меньше, чем на столько, и это ещё щелчок, а не
// перетаскивание.
const DRAG_THRESHOLD = 4;

// Ctrl+Tab и Ctrl+Shift+Tab по соседним вкладкам, на macOS тоже Ctrl, как
// в браузерах. ⌘W закрывает активную вкладку.
function useTabShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey) {
        return;
      }

      if (event.code === "Tab" && event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        cycleNotes(event.shiftKey ? -1 : 1);
      }

      if (event.code === "KeyW" && !event.shiftKey && hasModKey(event)) {
        event.preventDefault();
        closeActiveNote();
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}

type TabProps = {
  path: string;
  title: string;
  folder: string;
  active: boolean;
  missing: boolean;
};

function Tab({ path, title, folder, active, missing }: TabProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; moved: boolean } | null>(null);
  const dragged = useRef(false);

  // Вкладок больше, чем влезает: ряд прокручивается, активная всегда видна.
  useEffect(() => {
    if (active) {
      ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [active]);

  // Перетаскивание на указателе, а не на drag and drop браузера: приём
  // файлов окном Tauri на Windows глушит его события.
  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    drag.current = { x: event.clientX, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const state = drag.current;

    if (state === null || (!state.moved && Math.abs(event.clientX - state.x) < DRAG_THRESHOLD)) {
      return;
    }

    state.moved = true;

    const row = [...(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>("[data-tab]") ?? [])];
    const to = row.findIndex((tab) => {
      const { left, right } = tab.getBoundingClientRect();

      return event.clientX >= left && event.clientX < right;
    });

    if (to !== -1 && row[to] !== event.currentTarget) {
      moveNote(path, to);
    }
  }

  function onPointerUp() {
    dragged.current = drag.current?.moved ?? false;
    drag.current = null;
  }

  // Стрелки ходят по вкладкам и оставляют фокус в ряду, Enter и пробел
  // переходят в текст.
  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      switchNote(path);
    }

    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();

      const sibling =
        event.key === "ArrowRight" ? event.currentTarget.nextElementSibling : event.currentTarget.previousElementSibling;

      if (sibling instanceof HTMLElement && sibling.dataset.tab !== undefined) {
        switchNote(sibling.dataset.tab, { focus: false });
        sibling.focus();
      }
    }
  }

  return (
    <div
      ref={ref}
      role="tab"
      data-tab={path}
      aria-label={[title, folder].filter(Boolean).join(", ")}
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      title={missing ? t("tabs.missing") : path}
      className="group flex h-7 w-48 min-w-28 cursor-default touch-none items-center gap-1.5 rounded-md pr-1 pl-2 text-[13px] text-content/60 select-none transition-colors duration-120 hover:bg-selection-hover aria-selected:bg-selection aria-selected:text-content"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={() => {
        if (dragged.current) {
          dragged.current = false;
          return;
        }

        switchNote(path);
      }}
      onAuxClick={(event) => {
        if (event.button === 1) {
          closeNote(path);
        }
      }}
      onKeyDown={onKeyDown}
    >
      <FileTypeIcon name={path} />
      <span className={`min-w-0 truncate ${missing ? "text-content/40 line-through" : ""}`}>{title}</span>
      {/* Папке достаётся место, что осталось после имени: тесно, и режется она. */}
      {folder !== "" && <span className="min-w-0 flex-1 truncate text-content/40">{folder}</span>}
      <button
        type="button"
        tabIndex={-1}
        aria-label={t("tabs.close", { title })}
        title={`${t("tabs.close", { title })} (${shortcutLabel("W")})`}
        className="ml-auto grid size-5 shrink-0 place-items-center rounded text-content/50 opacity-0 transition-opacity duration-120 group-hover:opacity-100 group-aria-selected:opacity-100 hover:bg-selection-hover hover:text-content"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          closeNote(path);
        }}
      >
        <Icon icon={Cancel01Icon} size={12} />
      </button>
    </div>
  );
}

// Окно сузили или открыли панель: активная вкладка не уезжает из виду.
function keepActiveInView(list: HTMLDivElement) {
  const observer = new ResizeObserver(() => {
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });

  observer.observe(list);

  return () => observer.disconnect();
}

type Props = {
  // Зовётся, когда в дереве открылось поле имени: страница показывает
  // спрятанную панель.
  onCreateStart: () => void;
};

// Вкладки открытых заметок в верхней полосе окна, как в MonoCode: иконка
// и имя, у активной плашка светлее, справа «+».
export function NoteTabs({ onCreateStart }: Props) {
  const { t } = useTranslation();
  const status = useVaultStatus();
  const tree = useVaultTree();
  const { tabs, active } = useTreeState();
  const ready = status.data?.kind === "ready";
  const existing = useMemo(() => new Set(notesOf(tree.data ?? []).map((note) => note.path)), [tree.data]);

  useTabShortcuts(ready);

  // Первое дерево после запуска убирает вкладки файлов, которых уже нет.
  useEffect(() => {
    if (tree.data !== undefined) {
      keepExistingTabs((path) => existing.has(path));
    }
  }, [tree.data, existing]);

  if (!ready) {
    return null;
  }

  return (
    <div className="flex min-w-0 items-center gap-1">
      <div
        ref={keepActiveInView}
        role="tablist"
        aria-label={t("tabs.list")}
        className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]"
      >
        {tabLabels(tabs).map((tab) => (
          <Tab
            key={tab.path}
            {...tab}
            active={tab.path === active}
            missing={tree.data !== undefined && !existing.has(tab.path)}
          />
        ))}
      </div>
      <IconButton
        icon={Add01Icon}
        label={t("tabs.new")}
        shortcut={shortcutLabel("N")}
        onClick={() => {
          startCreate("note");
          onCreateStart();
        }}
      />
    </div>
  );
}
