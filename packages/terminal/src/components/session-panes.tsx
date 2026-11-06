import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { ContextMenu, hasModKey, LINK, Notice, type MenuItem } from "@sapien/ui";
import {
  activatePane,
  closePane,
  resizePanes,
  savePanes,
  splitActivePane,
  splitPane,
  usePanes,
} from "../interactions/panes";
import { attachTerminal, focusTerminal, restartTerminal, useTerminalState } from "../interactions/terminal";
import { panesIn, type Layout, type Side, type SplitPath } from "../model/panes";
import { PaneDivider } from "./pane-divider";

// ⌘D делит активную панель вправо, ⇧⌘D вниз, как в iTerm.
function usePaneShortcuts(session: string) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Код клавиши, а не символ: в русской раскладке та же клавиша печатает «в».
      if (event.defaultPrevented || event.code !== "KeyD" || event.altKey || !hasModKey(event)) {
        return;
      }

      event.preventDefault();
      splitActivePane(session, event.shiftKey ? "down" : "right");
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [session]);
}

type PaneProps = {
  session: string;
  pane: string;
  index: number;
  active: boolean;
  onMenu: (event: MouseEvent, pane: string) => void;
};

// Терминал панели. Панель, которую убрали с экрана переходом на другую
// вкладку, при возврате видит тот же терминал. Начатый заново терминал
// получает новое место на странице. Среди нескольких панелей фоновые
// бледнее активной.
function PaneTerminal({ session, pane, index, active, onMenu }: PaneProps) {
  const { t } = useTranslation("terminal");
  const { notice, generation } = useTerminalState(pane);
  const attach = useCallback((host: HTMLDivElement) => attachTerminal(session, pane, host), [session, pane]);

  // Фокус в активную панель: после деления, после закрытия соседки
  // и при возврате на вкладку. generation здесь нарочно: начатый заново
  // терминал тоже получает фокус.
  useEffect(() => {
    if (active) {
      focusTerminal(pane);
    }
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [active, pane, generation]);

  function restart(label: string) {
    return (
      <button type="button" className={LINK} onClick={() => restartTerminal(pane)}>
        {label}
      </button>
    );
  }

  return (
    <section
      aria-label={t("panes.label", { index })}
      data-active={active || undefined}
      className="flex min-h-0 min-w-0 flex-1 flex-col px-4 transition-opacity duration-120 not-data-active:opacity-60"
    >
      {notice === "exited" && (
        <Notice tone="warning" action={restart(t("restart"))}>
          {t("exited")}
        </Notice>
      )}
      {notice === "failed" && <Notice action={restart(t("retry"))}>{t("failed")}</Notice>}
      <div
        key={generation}
        ref={attach}
        data-testid="terminal"
        className="min-h-0 flex-1 py-2"
        onFocus={() => activatePane(session, pane)}
        onContextMenu={(event) => onMenu(event, pane)}
      />
    </section>
  );
}

type NodeProps = {
  session: string;
  node: Layout;
  path: SplitPath;
  active: string;
  panes: string[];
  onMenu: (event: MouseEvent, pane: string) => void;
};

// Панель или деление надвое: первая часть занимает свою долю, вторая
// остальное, граница между ними тянется.
function PaneNode({ session, node, path, active, panes, onMenu }: NodeProps) {
  const { t } = useTranslation("terminal");

  if (node.kind === "pane") {
    return (
      <PaneTerminal
        session={session}
        pane={node.id}
        index={panes.indexOf(node.id) + 1}
        active={node.id === active}
        onMenu={onMenu}
      />
    );
  }

  const inner = { session, active, panes, onMenu };

  return (
    <div className={`flex min-h-0 min-w-0 flex-1 ${node.direction === "row" ? "flex-row" : "flex-col"}`}>
      <div className="flex min-h-0 min-w-0" style={{ flex: `0 0 ${node.ratio * 100}%` }}>
        <PaneNode {...inner} node={node.first} path={[...path, "first"]} />
      </div>
      <PaneDivider
        direction={node.direction}
        ratio={node.ratio}
        label={t("panes.resize")}
        onResize={(ratio) => resizePanes(session, path, ratio)}
        onDone={savePanes}
      />
      <div className="flex min-h-0 min-w-0 flex-1">
        <PaneNode {...inner} node={node.second} path={[...path, "second"]} />
      </div>
    </div>
  );
}

type Menu = { x: number; y: number; pane: string };

// Панели сессии: каждая со своей оболочкой. Правая кнопка в панели делит
// её в любую сторону или закрывает, ⌘D и ⇧⌘D делят активную.
export function SessionPanes({ session }: { session: string }) {
  const { t } = useTranslation("terminal");
  const panes = usePanes(session);
  const [menu, setMenu] = useState<Menu | null>(null);
  const open = panesIn(panes.layout);

  usePaneShortcuts(session);

  function openMenu(event: MouseEvent, pane: string) {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, pane });
  }

  function items(pane: string): MenuItem[] {
    const split = (label: string, side: Side) => ({ label, onSelect: () => splitPane(session, pane, side) });
    const last = open.length === 1;

    return [
      split(t("panes.splitRight"), "right"),
      split(t("panes.splitLeft"), "left"),
      split(t("panes.splitDown"), "down"),
      split(t("panes.splitUp"), "up"),
      {
        label: t("panes.close"),
        separated: true,
        disabled: last,
        hint: last ? t("panes.last") : undefined,
        onSelect: () => closePane(session, pane),
      },
    ];
  }

  return (
    <>
      <PaneNode session={session} node={panes.layout} path={[]} active={panes.active} panes={open} onMenu={openMenu} />
      {menu !== null && <ContextMenu x={menu.x} y={menu.y} items={items(menu.pane)} onClose={() => setMenu(null)} />}
    </>
  );
}
