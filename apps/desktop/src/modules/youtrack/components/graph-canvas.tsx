import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { lineKey, type Line, type Point } from "../model/graph";
import { placeBodies, step, type Body } from "../model/layout";
import { noteTitle } from "../model/draft";

// Цвета статусов по порядку статусов в графе. Закрытые задачи всегда
// зелёные, как добавленное в истории версий.
export const STATE_COLORS = ["#60a5fa", "#f59e0b", "#a78bfa", "#f472b6", "#22d3ee", "#fb923c", "#facc15"];
export const RESOLVED_COLOR = "#10b981";
const CYCLE_COLOR = "#f43f5e";
const RADIUS = 6;
const CENTER_RADIUS = 9;
// Точка на экране не мельче этого при любом масштабе.
const MIN_SCREEN_RADIUS = 2.5;
// Сотни задач занимают несколько экранов: уменьшить можно в двадцать раз.
const MIN_SCALE = 0.05;
// Остывшая раскладка больше не считается: кадры идут, только пока точки
// движутся или их тянут.
const COOL = 0.01;

type Props = {
  points: Point[];
  lines: Line[];
  center: string;
  // Цвет точки по статусу, его же показывает легенда.
  colorOf: (point: Point) => string;
  chain: Set<string>;
  cycles: Set<string>;
  onOpen: (point: Point) => void;
};

type View = { x: number; y: number; scale: number };

type Drag = { key: string | null; startX: number; startY: number; viewX: number; viewY: number; moved: boolean };

type Sim = {
  bodies: Body[];
  byKey: Map<string, Body>;
  springs: [number, number][];
  // Точки и линии последней раскладки: тот же граф её не трогает.
  shape: string;
  alpha: number;
  view: View;
  hover: string | null;
  drag: Drag | null;
  frame: number;
  draw: () => void;
};

function tick(sim: Sim) {
  sim.frame = 0;

  if (sim.alpha > COOL) {
    step(sim.bodies, sim.springs, sim.alpha);
    sim.alpha *= 0.97;
  }

  sim.draw();

  if (sim.alpha > COOL || sim.drag?.key != null) {
    sim.frame = requestAnimationFrame(() => tick(sim));
  }
}

// Раскладка оживает до температуры alpha, кадры идут, пока она не остынет.
function kick(sim: Sim, alpha: number) {
  sim.alpha = Math.max(sim.alpha, alpha);

  if (sim.frame === 0) {
    sim.frame = requestAnimationFrame(() => tick(sim));
  }
}

// Масштаб и сдвиг, при которых все точки видны с полями под подписи.
function fit(sim: Sim, canvas: HTMLCanvasElement | null) {
  if (canvas === null || sim.bodies.length === 0 || canvas.clientWidth === 0) {
    return;
  }

  const xs = sim.bodies.map((body) => body.x);
  const ys = sim.bodies.map((body) => body.y);
  const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min(
    1,
    (canvas.clientWidth - 120) / Math.max(right - left, 1),
    (canvas.clientHeight - 80) / Math.max(bottom - top, 1),
  );

  sim.view = { x: (-(left + right) / 2) * scale, y: (-(top + bottom) / 2) * scale, scale: Math.max(scale, MIN_SCALE) };
}

// Точка под курсором в координатах графа и на экране от середины холста.
function toWorld(canvas: HTMLCanvasElement | null, view: View, event: { clientX: number; clientY: number }) {
  if (canvas === null) {
    return { x: 0, y: 0, screenX: 0, screenY: 0 };
  }

  const box = canvas.getBoundingClientRect();
  const screenX = event.clientX - box.left - box.width / 2;
  const screenY = event.clientY - box.top - box.height / 2;

  return { x: (screenX - view.x) / view.scale, y: (screenY - view.y) / view.scale, screenX, screenY };
}

// Цвет токена темы строкой rgb(): canvas не понимает var() и color-mix.
function themeColor(element: HTMLElement, token: string) {
  const probe = document.createElement("span");

  probe.style.color = `var(${token})`;
  element.append(probe);
  const color = getComputedStyle(probe).color;

  probe.remove();

  return color;
}

function labelOf(point: Point) {
  return point.id ?? noteTitle(point.path ?? point.key);
}

function arrow(context: CanvasRenderingContext2D, from: Body, to: Body, gap: number) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const tipX = to.x - Math.cos(angle) * gap;
  const tipY = to.y - Math.sin(angle) * gap;

  context.beginPath();
  context.moveTo(tipX, tipY);
  context.lineTo(tipX - Math.cos(angle - 0.45) * 7, tipY - Math.sin(angle - 0.45) * 7);
  context.lineTo(tipX - Math.cos(angle + 0.45) * 7, tipY - Math.sin(angle + 0.45) * 7);
  context.closePath();
  context.fill();
}

// Граф на холсте. Расчёт раскладки и кадры живут в ref, а не в состоянии
// React: перерисовка сотен точек шестьдесят раз в секунду мимо React.
export function GraphCanvas({ points, lines, center, colorOf, chain, cycles, onOpen }: Props) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState<{ point: Point; x: number; y: number } | null>(null);
  const latest = useRef({ points, lines, center, colorOf, chain, cycles, onOpen });
  const sim = useRef<Sim>({
    bodies: [],
    byKey: new Map(),
    springs: [],
    shape: "",
    alpha: 1,
    view: { x: 0, y: 0, scale: 1 },
    hover: null,
    drag: null,
    frame: 0,
    draw: () => {},
  });

  useLayoutEffect(() => {
    latest.current = { points, lines, center, colorOf, chain, cycles, onOpen };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const state = sim.current;

    if (canvas === null) {
      return;
    }

    const colors = {
      content: themeColor(canvas, "--color-content"),
      accent: themeColor(canvas, "--color-accent"),
    };

    state.draw = () => {
      const context = canvas.getContext("2d");

      if (context === null) {
        return;
      }

      const { points: shown, lines: drawn, center: middle, colorOf: color, chain: blocking, cycles: looped } = latest.current;
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.width / ratio;
      const height = canvas.height / ratio;
      const { view, byKey, hover } = state;
      let focus: Set<string> | null = null;

      if (hover !== null) {
        focus = new Set([hover]);

        for (const line of drawn) {
          if (line.from === hover) {
            focus.add(line.to);
          }

          if (line.to === hover) {
            focus.add(line.from);
          }
        }
      }

      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.translate(width / 2 + view.x, height / 2 + view.y);
      context.scale(view.scale, view.scale);

      for (const line of drawn) {
        const from = byKey.get(line.from);
        const to = byKey.get(line.to);

        if (from !== undefined && to !== undefined) {
          const key = lineKey(line);
          const lit = hover === null || line.from === hover || line.to === hover;
          let stroke = colors.content;

          if (blocking.has(key)) {
            stroke = colors.accent;
          }

          if (looped.has(key)) {
            stroke = CYCLE_COLOR;
          }

          context.globalAlpha = (lit ? 1 : 0.12) * (stroke === colors.content ? 0.4 : 1);
          context.strokeStyle = stroke;
          context.fillStyle = stroke;
          context.lineWidth = (blocking.has(key) || looped.has(key) ? 2 : 1.2) / Math.sqrt(view.scale);
          context.setLineDash(line.kind === "relates" ? [4, 4] : []);
          context.beginPath();
          context.moveTo(from.x, from.y);
          context.lineTo(to.x, to.y);
          context.stroke();

          if (line.kind === "blocks") {
            arrow(context, from, to, to.key === middle ? CENTER_RADIUS + 2 : RADIUS + 2);
          }
        }
      }

      context.setLineDash([]);
      context.font = "11px system-ui, sans-serif";
      context.textAlign = "center";

      for (const point of shown) {
        const body = byKey.get(point.key);

        if (body !== undefined) {
          const radius = Math.max(point.key === middle ? CENTER_RADIUS : RADIUS, MIN_SCREEN_RADIUS / view.scale);
          const dim = focus !== null && !focus.has(point.key);
          // Черновик ещё не задача: полупрозрачный, с пунктирной обводкой.
          const draft = point.id === null;

          context.globalAlpha = dim ? 0.15 : 1;
          context.beginPath();
          context.arc(body.x, body.y, radius, 0, Math.PI * 2);
          context.fillStyle = color(point);
          context.globalAlpha = (dim ? 0.15 : 1) * (draft ? 0.35 : 1);
          context.fill();
          context.globalAlpha = dim ? 0.15 : 1;

          if (draft) {
            context.setLineDash([2, 2]);
            context.strokeStyle = colors.content;
            context.lineWidth = 1;
            context.stroke();
            context.setLineDash([]);
          }

          if (point.key === middle) {
            context.strokeStyle = colors.accent;
            context.lineWidth = 2 / Math.min(view.scale, 1);
            context.beginPath();
            context.arc(body.x, body.y, radius + 3 / Math.min(view.scale, 1), 0, Math.PI * 2);
            context.stroke();
          }

          if (view.scale >= 0.7 || point.key === middle || point.key === hover) {
            context.fillStyle = colors.content;
            context.globalAlpha = dim ? 0.15 : 0.75;
            context.fillText(labelOf(point), body.x, body.y + radius + 12);
          }
        }
      }

      context.globalAlpha = 1;
    };

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;

      canvas.width = Math.round(canvas.clientWidth * ratio);
      canvas.height = Math.round(canvas.clientHeight * ratio);
      state.draw();
    };
    const observer = new ResizeObserver(resize);

    observer.observe(canvas);
    resize();

    return () => {
      observer.disconnect();
      cancelAnimationFrame(state.frame);
      state.frame = 0;
    };
  }, []);

  // Новые точки встают рядом с соседями, прежние остаются на месте. Тот же
  // граф из нового ответа YouTrack раскладку не трогает.
  useEffect(() => {
    const state = sim.current;
    const keys = points.map((point) => point.key);
    const shape = `${keys.join("|")}#${lines.map(lineKey).join("|")}`;

    if (shape === state.shape) {
      state.draw();
      return;
    }

    const index = new Map(keys.map((key, at) => [key, at]));
    const springs = lines.flatMap((line): [number, number][] => {
      const from = index.get(line.from);
      const to = index.get(line.to);

      if (from === undefined || to === undefined) {
        return [];
      }

      return [[from, to]];
    });
    const added = keys.filter((key) => !state.byKey.has(key)).length;

    state.shape = shape;
    state.springs = springs;
    state.bodies = placeBodies(keys, springs, state.byKey, center);
    state.byKey = new Map(state.bodies.map((body) => [body.key, body]));

    // Граф, который пришёл или заметно вырос, раскладывается до первого
    // кадра, чтобы не расти на глазах, и встаёт в окно целиком: мелкий
    // в натуральную величину, крупный уменьшенным. Пара новых точек
    // просто оживляет раскладку.
    if (added * 3 > keys.length) {
      state.alpha = 1;

      while (state.alpha > COOL) {
        step(state.bodies, state.springs, state.alpha);
        state.alpha *= 0.97;
      }

      fit(state, canvasRef.current);
      kick(state, 0);
      return;
    }

    kick(state, 0.3);
  }, [points, lines, center]);

  function hit(event: ReactPointerEvent) {
    const { x, y } = toWorld(canvasRef.current, sim.current.view, event);
    const { byKey, view } = sim.current;
    let found: Point | null = null;
    let best = (RADIUS + 6) / Math.min(view.scale, 1);

    for (const point of latest.current.points) {
      const body = byKey.get(point.key);

      if (body !== undefined) {
        const distance = Math.hypot(body.x - x, body.y - y);

        if (distance < best) {
          best = distance;
          found = point;
        }
      }
    }

    return found;
  }

  // Колесо и щипок на тачпаде, он приходит колесом с ctrlKey, меняют
  // масштаб вокруг курсора. Слушатель не пассивный: иначе прокрутится окно.
  useEffect(() => {
    const canvas = canvasRef.current;

    if (canvas === null) {
      return;
    }

    const zoom = (event: WheelEvent) => {
      event.preventDefault();
      const { view } = sim.current;
      const { screenX, screenY } = toWorld(canvas, view, event);
      const scale = Math.min(
        4,
        Math.max(MIN_SCALE, view.scale * Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002))),
      );

      view.x = screenX - ((screenX - view.x) * scale) / view.scale;
      view.y = screenY - ((screenY - view.y) * scale) / view.scale;
      view.scale = scale;
      sim.current.draw();
    };

    canvas.addEventListener("wheel", zoom, { passive: false });

    return () => canvas.removeEventListener("wheel", zoom);
  }, []);

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const state = sim.current;
    const point = hit(event);

    event.currentTarget.setPointerCapture(event.pointerId);
    state.drag = {
      key: point?.key ?? null,
      startX: event.clientX,
      startY: event.clientY,
      viewX: state.view.x,
      viewY: state.view.y,
      moved: false,
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const state = sim.current;
    const { drag } = state;

    if (drag === null) {
      const point = hit(event);
      const key = point?.key ?? null;

      event.currentTarget.style.cursor = point === null ? "grab" : "pointer";

      if (key !== state.hover) {
        state.hover = key;
        state.draw();
      }

      if (point === null) {
        setHovered(null);
      } else {
        const box = event.currentTarget.getBoundingClientRect();

        setHovered({ point, x: event.clientX - box.left, y: event.clientY - box.top });
      }

      return;
    }

    drag.moved ||= Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 3;

    if (drag.key === null) {
      state.view.x = drag.viewX + event.clientX - drag.startX;
      state.view.y = drag.viewY + event.clientY - drag.startY;
      state.draw();
      return;
    }

    const body = state.byKey.get(drag.key);

    if (body !== undefined && drag.moved) {
      const { x, y } = toWorld(event.currentTarget, state.view, event);

      // Точку держат на месте, а соседей тянут линии: раскладка оживает.
      body.fixed = true;
      body.x = x;
      body.y = y;
      setHovered(null);
      kick(state, 0.3);
    }
  }

  function onPointerUp() {
    const state = sim.current;
    const { drag } = state;

    state.drag = null;

    if (drag?.key == null) {
      return;
    }

    const body = state.byKey.get(drag.key);

    if (body !== undefined) {
      body.fixed = false;
    }

    const point = latest.current.points.find((candidate) => candidate.key === drag.key);

    if (!drag.moved && point !== undefined) {
      latest.current.onOpen(point);
    }
  }

  return (
    <div className="relative min-h-0 flex-1">
      <canvas
        ref={canvasRef}
        aria-hidden
        className="block h-full w-full cursor-grab touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          sim.current.hover = null;
          setHovered(null);
          sim.current.draw();
        }}
      />
      {hovered !== null && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 max-w-72 rounded-md border border-stroke bg-shell px-2.5 py-1.5 text-[12px] shadow-float"
          style={{ left: hovered.x + 14, top: hovered.y + 14 }}
        >
          <p className="font-medium">
            {labelOf(hovered.point)} {hovered.point.summary}
          </p>
          <p className="text-content/60">
            {[
              hovered.point.state ?? (hovered.point.id === null ? t("youtrack.graph.draft") : t("youtrack.graph.noState")),
              hovered.point.assignee ?? t("youtrack.graph.noAssignee"),
              t("youtrack.graph.project", { project: hovered.point.project }),
            ].join(" · ")}
          </p>
        </div>
      )}
    </div>
  );
}
