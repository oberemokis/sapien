import type { MarkdownConfig } from "@lezer/markdown";

// Номер задачи вида SAP-12: короткое имя проекта латиницей, дефис и номер.
// Слева и справа не буква и не цифра, иначе это кусок слова.
const ID = "[A-Za-z][A-Za-z0-9_]*-\\d+(?![\\p{L}\\p{N}_])";
const AT_START = new RegExp(`^${ID}`, "u");
const ANYWHERE = new RegExp(`(?<![\\p{L}\\p{N}_-])${ID}`, "gu");
const WORD = /[\p{L}\p{N}_-]/u;

function isLatin(code: number) {
  // oxlint-disable-next-line no-bitwise -- строчная и заглавная отличаются одним битом
  const lower = code | 32;

  return lower >= 97 && lower <= 122;
}

// Номер задачи в тексте как узел разбора markdown. Внутри кода, адреса
// ссылки и шапки разбор строки сюда не доходит, поэтому номер там остаётся
// текстом. Чей это номер и есть ли такой проект, решает тот, кто узел
// показывает.
export const IssueIds: MarkdownConfig = {
  defineNodes: [{ name: "IssueId" }],
  parseInline: [
    {
      name: "IssueId",
      parse(cx, next, pos) {
        if (!isLatin(next) || (pos > cx.offset && WORD.test(cx.slice(pos - 1, pos)))) {
          return -1;
        }

        // Короткое имя проекта не бывает длиннее пары десятков знаков.
        const id = AT_START.exec(cx.slice(pos, Math.min(cx.end, pos + 64)))?.[0];

        if (id === undefined) {
          return -1;
        }

        return cx.addElement(cx.elt("IssueId", pos, pos + id.length));
      },
    },
  ],
};

// Номера задач в тексте без повторов. Код от текста не отличает: номер
// из кода будет лишним вопросом к YouTrack, а плашки над ним всё равно нет.
export function issueIds(text: string) {
  return [...new Set(text.match(ANYWHERE))];
}

// Короткое имя проекта из номера: всё до последнего дефиса.
export function projectOf(id: string) {
  return id.slice(0, id.lastIndexOf("-"));
}
