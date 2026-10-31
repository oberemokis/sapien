// Строка сравнения двух текстов: общая, только в первом или только во втором.
export type DiffLine = { kind: "same" | "removed" | "added"; text: string };

// ponytail: таблица общей подпоследовательности растёт как произведение
// длин изменённой середины. Больше этого середина показывается целиком
// убранной и добавленной, алгоритм Майерса понадобится, если такое
// станет частым.
const TABLE_LIMIT = 1_000_000;

function linesOf(text: string) {
  if (text === "") {
    return [];
  }

  return text.split("\n");
}

function line(kind: DiffLine["kind"]) {
  return (text: string): DiffLine => ({ kind, text });
}

function diffMiddle(before: string[], after: string[]): DiffLine[] {
  if (before.length * after.length > TABLE_LIMIT) {
    return [...before.map(line("removed")), ...after.map(line("added"))];
  }

  // Длина общей подпоследовательности хвостов before[i..] и after[j..].
  const width = after.length + 1;
  const common = new Uint32Array((before.length + 1) * width);
  const at = (i: number, j: number) => common[i * width + j] ?? 0;

  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      if (before[i] === after[j]) {
        common[i * width + j] = at(i + 1, j + 1) + 1;
      } else {
        common[i * width + j] = Math.max(at(i + 1, j), at(i, j + 1));
      }
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < before.length && j < after.length) {
    const left = before[i] ?? "";
    const right = after[j] ?? "";

    if (left === right) {
      lines.push(line("same")(left));
      i += 1;
      j += 1;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      lines.push(line("removed")(left));
      i += 1;
    } else {
      lines.push(line("added")(right));
      j += 1;
    }
  }

  return [...lines, ...before.slice(i).map(line("removed")), ...after.slice(j).map(line("added"))];
}

// Построчное сравнение. Общие начало и конец срезаются сразу: правка
// обычно трогает несколько строк посередине, и таблица остаётся маленькой.
export function diffLines(before: string, after: string): DiffLine[] {
  const left = linesOf(before);
  const right = linesOf(after);
  let start = 0;
  let end = 0;

  while (start < left.length && start < right.length && left[start] === right[start]) {
    start += 1;
  }

  while (
    end < left.length - start &&
    end < right.length - start &&
    left[left.length - 1 - end] === right[right.length - 1 - end]
  ) {
    end += 1;
  }

  return [
    ...left.slice(0, start).map(line("same")),
    ...diffMiddle(left.slice(start, left.length - end), right.slice(start, right.length - end)),
    ...left.slice(left.length - end).map(line("same")),
  ];
}
