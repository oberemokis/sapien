import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { openLink } from "@/core/links/open-link";
import { IconButton } from "@/core/ui/icon-button";
import { Segmented } from "@/core/ui/segmented";
import { closeTaskGraph, useTaskGraph, useTaskGraphPath } from "../interactions/graph";
import { noteTitle, type LinkedNote } from "../model/draft";
import {
  blockingChain,
  buildView,
  centerOf,
  choicesOf,
  cycleLines,
  filterView,
  graphRoots,
  type GraphFilter,
  type Point,
} from "../model/graph";
import { EDGE_KINDS, type EdgeKind } from "../model/youtrack";
import { GraphCanvas, RESOLVED_COLOR, STATE_COLORS } from "./graph-canvas";

const DEPTHS = ["1", "2", "3"] as const;

// Точка без статуса: черновик или задача, о которой YouTrack не ответил.
const NO_STATE_COLOR = "#9ca3af";

const SELECT =
  "h-7 rounded-md border border-stroke bg-transparent px-1.5 text-[12px] text-content outline-none focus:border-accent";

// Как линия выглядит в легенде: подзадача сплошная, «блокирует» со
// стрелкой, «связана с» пунктиром.
const KIND_SIGNS: Record<EdgeKind, string> = { subtask: "—", blocks: "→", relates: "┄" };

// Закрытая задача зелёная при любом статусе, у остальных цвет по имени
// статуса: «Open» одного цвета в любом графе.
function stateColor(state: string | null, resolved: boolean) {
  if (resolved) {
    return RESOLVED_COLOR;
  }

  if (state === null) {
    return NO_STATE_COLOR;
  }

  const hash = [...state].reduce((sum, letter) => (sum * 31 + (letter.codePointAt(0) ?? 0)) % 9973, 7);

  return STATE_COLORS[hash % STATE_COLORS.length] ?? NO_STATE_COLOR;
}

function colorOf(point: Point) {
  return stateColor(point.state, point.resolved);
}

type Props = {
  notes: LinkedNote[];
  // Клик по точке черновика открывает его заметку: путь отдаёт страница.
  onOpenNote: (path: string) => void;
};

function GraphDialog({ path, notes, onOpenNote }: Props & { path: string }) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnRef = useRef<Element | null>(null);
  const [depth, setDepth] = useState<(typeof DEPTHS)[number]>("2");
  const [filter, setFilter] = useState<GraphFilter>({ state: null, assignee: null, kinds: [...EDGE_KINDS] });
  const center = centerOf(path, notes);
  const roots = useMemo(() => graphRoots(center, Number(depth), notes), [center, depth, notes]);
  const graph = useTaskGraph(roots, Number(depth));
  const view = useMemo(() => buildView(center, Number(depth), graph.graph, notes), [center, depth, graph.graph, notes]);
  const shown = useMemo(() => filterView(view, center, filter), [view, center, filter]);
  const chain = useMemo(() => blockingChain(shown.lines, center), [shown.lines, center]);
  const cycles = useMemo(() => cycleLines(shown.lines), [shown.lines]);
  const states = choicesOf(view.points, "state");
  const assignees = choicesOf(view.points, "assignee");
  const centerPoint = view.points.find((point) => point.key === center);

  useEffect(() => {
    returnRef.current = document.activeElement;
    dialogRef.current?.showModal();
  }, []);

  function close() {
    dialogRef.current?.close();

    if (returnRef.current instanceof HTMLElement) {
      returnRef.current.focus();
    }

    closeTaskGraph();
  }

  // Клик закрывает окно: черновик открывается заметкой, задача в YouTrack.
  function open(point: Point) {
    close();

    if (point.path !== null) {
      onOpenNote(point.path);
    } else if (point.url !== null) {
      openLink(point.url);
    }
  }

  function toggleKind(kind: EdgeKind) {
    setFilter((current) => {
      if (current.kinds.includes(kind)) {
        return { ...current, kinds: current.kinds.filter((known) => known !== kind) };
      }

      return { ...current, kinds: [...current.kinds, kind] };
    });
  }

  let notice: string | null = null;

  if (graph.away && graph.graph !== undefined) {
    notice = t("youtrack.graph.stale");
  } else if (graph.problem !== null) {
    notice = t(`youtrack.problems.${graph.problem}`);
  } else if (graph.away && roots.length > 0) {
    notice = t("youtrack.graph.offline");
  } else if (graph.loading) {
    notice = t("youtrack.graph.loading");
  } else if (view.lines.length === 0) {
    notice = t("youtrack.graph.lonely");
  }

  const title = t("youtrack.graph.title", { title: centerPoint?.summary || noteTitle(path) });

  return (
    // Нажатие на затемнение вокруг окна закрывает его, как Escape.
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={dialogRef}
      aria-label={title}
      className="fixed inset-x-0 top-[6vh] mx-auto flex h-[min(720px,88vh)] w-[min(1100px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border border-content/8 bg-shell/95 p-0 text-content shadow-float backdrop-blur-xl backdrop:bg-scrim"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          close();
        }
      }}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-stroke pr-2 pl-4">
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-medium">{title}</h2>
        <IconButton icon={Cancel01Icon} label={t("youtrack.graph.close")} onClick={close} />
      </header>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-stroke px-4 py-2">
        <Segmented
          label={t("youtrack.graph.depth")}
          value={depth}
          options={DEPTHS.map((value) => ({ value, label: t(`youtrack.graph.depths.${value}`) }))}
          onChange={setDepth}
        />
        <select
          aria-label={t("youtrack.graph.state")}
          value={filter.state ?? ""}
          className={SELECT}
          onChange={(event) => setFilter({ ...filter, state: event.target.value || null })}
        >
          <option value="">{t("youtrack.graph.allStates")}</option>
          {states.map((state) => (
            <option key={state} value={state}>
              {state}
            </option>
          ))}
        </select>
        <select
          aria-label={t("youtrack.graph.assignee")}
          value={filter.assignee ?? ""}
          className={SELECT}
          onChange={(event) => setFilter({ ...filter, assignee: event.target.value || null })}
        >
          <option value="">{t("youtrack.graph.allAssignees")}</option>
          {assignees.map((assignee) => (
            <option key={assignee} value={assignee}>
              {assignee}
            </option>
          ))}
        </select>
        <fieldset className="flex items-center gap-1">
          <legend className="sr-only">{t("youtrack.graph.kinds")}</legend>
          {EDGE_KINDS.map((kind) => (
            <label
              key={kind}
              className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-content/50 has-checked:bg-selection has-checked:text-content has-focus-visible:outline-2 has-focus-visible:outline-accent"
            >
              <input type="checkbox" checked={filter.kinds.includes(kind)} className="sr-only" onChange={() => toggleKind(kind)} />
              <span aria-hidden>{KIND_SIGNS[kind]}</span>
              {t(`youtrack.graph.kind.${kind}`)}
            </label>
          ))}
        </fieldset>
      </div>
      {notice !== null && (
        <output className="block shrink-0 px-4 pt-2 text-[12px] text-content/60">{notice}</output>
      )}
      <GraphCanvas
        points={shown.points}
        lines={shown.lines}
        center={center}
        colorOf={colorOf}
        chain={chain}
        cycles={cycles}
        onOpen={open}
      />
      {/* Холст не читается с экрана: те же точки списком кнопок. */}
      <ul aria-label={t("youtrack.graph.points")} className="sr-only">
        {shown.points.map((point) => (
          <li key={point.key}>
            <button type="button" onClick={() => open(point)}>
              {[point.id ?? noteTitle(point.path ?? point.key), point.summary, point.state ?? t("youtrack.graph.noState")]
                .filter(Boolean)
                .join(", ")}
            </button>
          </li>
        ))}
      </ul>
      <footer className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-stroke px-4 py-2 text-[12px] text-content/60">
        {states.map((state) => (
          <span key={state} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{
                background: stateColor(
                  state,
                  view.points.some((point) => point.state === state && point.resolved),
                ),
              }}
            />
            {state}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full border border-dashed border-content/60" />
          {t("youtrack.graph.draft")}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-3 bg-accent" />
          {t("youtrack.graph.chain")}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-3 bg-diff-del" />
          {t("youtrack.graph.cycle")}
        </span>
        <span className="ml-auto">{t("youtrack.graph.help")}</span>
      </footer>
    </dialog>
  );
}

// Граф связей поверх всего, в body, как история версий. Открывается для
// черновика из его формы и из меню заметки.
export function TaskGraph({ notes, onOpenNote }: Props) {
  const path = useTaskGraphPath();

  if (path === null) {
    return null;
  }

  return createPortal(<GraphDialog key={path} path={path} notes={notes} onOpenNote={onOpenNote} />, document.body);
}
