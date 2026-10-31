// Раскладка графа силами, как в графе Obsidian: точки отталкиваются друг
// от друга, линии тянут свои концы к длине LENGTH, всё слабо тянется
// к середине. Сотни точек считаются попарно за миллисекунды.

export type Body = { key: string; x: number; y: number; vx: number; vy: number; fixed: boolean };

const REPULSION = 6000;
const LENGTH = 90;
const SPRING = 0.06;
const GRAVITY = 0.012;
const FRICTION = 0.55;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

function bodyAt(key: string, x: number, y: number): Body {
  return { key, x, y, vx: 0, vy: 0, fixed: false };
}

// Начальные места. Точка, у которой место уже есть, остаётся на нём.
// Новая встаёт рядом с уже размещённым соседом, по кругу от него с золотым
// углом: подзадачи эпика сразу вокруг эпика, и раскладке не нужно тянуть
// их через весь граф. Первой встаёт start, точки без связей ложатся
// спиралью подсолнуха. Места не зависят от случая.
export function placeBodies(keys: string[], springs: [number, number][], previous: Map<string, Body>, start = keys[0]) {
  const placed: (Body | undefined)[] = keys.map((key) => previous.get(key));
  const near = keys.map((): number[] => []);
  const begin = Math.max(keys.indexOf(start ?? ""), 0);

  for (const [from, to] of springs) {
    near[from]?.push(to);
    near[to]?.push(from);
  }

  const queue = keys.map((_, index) => index).filter((index) => placed[index] !== undefined);
  let turn = 0;

  if (queue.length === 0 && keys.length > 0) {
    placed[begin] = bodyAt(keys[begin] ?? "", 0, 0);
    queue.push(begin);
  }

  for (let at = 0; at < queue.length; at += 1) {
    const index = queue[at] ?? 0;
    const parent = placed[index];

    for (const next of near[index] ?? []) {
      if (placed[next] === undefined && parent !== undefined) {
        turn += 1;
        placed[next] = bodyAt(
          keys[next] ?? "",
          parent.x + LENGTH * Math.cos(turn * GOLDEN),
          parent.y + LENGTH * Math.sin(turn * GOLDEN),
        );
        queue.push(next);
      }
    }
  }

  return keys.map((key, index) => {
    const radius = 24 * Math.sqrt(index + 0.5) + 200;

    return placed[index] ?? bodyAt(key, radius * Math.cos(index * GOLDEN), radius * Math.sin(index * GOLDEN));
  });
}

// Один шаг расчёта. alpha это температура: от 1 у новой раскладки к нулю,
// когда точки встали. Закреплённая точка стоит, где её держат.
export function step(bodies: Body[], springs: [number, number][], alpha: number) {
  for (let i = 0; i < bodies.length; i += 1) {
    const a = bodies[i];

    for (let j = i + 1; j < bodies.length; j += 1) {
      const b = bodies[j];

      if (a !== undefined && b !== undefined) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance2 = Math.max(dx * dx + dy * dy, 1);
        const force = (REPULSION * alpha) / distance2;

        a.vx -= dx * force * 0.05;
        a.vy -= dy * force * 0.05;
        b.vx += dx * force * 0.05;
        b.vy += dy * force * 0.05;
      }
    }
  }

  for (const [i, j] of springs) {
    const a = bodies[i];
    const b = bodies[j];

    if (a !== undefined && b !== undefined) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.max(Math.hypot(dx, dy), 1);
      const pull = ((distance - LENGTH) / distance) * SPRING * alpha;

      a.vx += dx * pull;
      a.vy += dy * pull;
      b.vx -= dx * pull;
      b.vy -= dy * pull;
    }
  }

  for (const body of bodies) {
    if (body.fixed) {
      body.vx = 0;
      body.vy = 0;
    } else {
      body.vx = (body.vx - body.x * GRAVITY * alpha) * FRICTION;
      body.vy = (body.vy - body.y * GRAVITY * alpha) * FRICTION;
      body.x += body.vx;
      body.y += body.vy;
    }
  }
}
