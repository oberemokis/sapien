// Наименьшая замена, которая превращает прежний текст в новый. Общее начало
// и общий конец остаются на месте, и курсор в них не прыгает, когда файл
// поменяли снаружи.
export function textChange(before: string, after: string) {
  const limit = Math.min(before.length, after.length);
  let from = 0;

  while (from < limit && before[from] === after[from]) {
    from += 1;
  }

  let tail = 0;

  while (tail < limit - from && before[before.length - 1 - tail] === after[after.length - 1 - tail]) {
    tail += 1;
  }

  return { from, to: before.length - tail, insert: after.slice(from, after.length - tail) };
}
