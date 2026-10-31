import { Tag } from "@lezer/highlight";
import { GFM, parser, type MarkdownConfig } from "@lezer/markdown";

// Тег по правилам Obsidian: после решётки буквы, цифры, «_», «-» и «/»
// для вложенных, и хотя бы один знак не цифра: «#2024» тегом не считается.
const TAG = /^[\p{L}\p{M}\p{N}_\-/]+/u;
const HASH = 35;

function tagName(raw: string) {
  const name = TAG.exec(raw)?.[0].replace(/\/+$/, "") ?? "";

  if (name === "" || /^\d+$/.test(name)) {
    return null;
  }

  return name;
}

// Стиль подсветки тега в редакторе.
export const hashtag = Tag.define();

// Стиль шапки заметки в редакторе.
export const frontmatter = Tag.define();

// Тег в тексте как узел разбора markdown. Решётка стоит в начале строки
// или после пробела, иначе это якорь адреса или «&#38;». Внутри кода,
// адреса ссылки и заголовка с пробелом после решётки разбор строки сюда
// не доходит.
export const Hashtags: MarkdownConfig = {
  defineNodes: [{ name: "Hashtag", style: hashtag }],
  parseInline: [
    {
      name: "Hashtag",
      parse(cx, next, pos) {
        if (next !== HASH || (pos > cx.offset && !/\s/.test(cx.slice(pos - 1, pos)))) {
          return -1;
        }

        const name = tagName(cx.slice(pos + 1, cx.end));

        if (name === null) {
          return -1;
        }

        return cx.addElement(cx.elt("Hashtag", pos, pos + 1 + name.length));
      },
    },
  ],
};

// Шапка заметки между строками «---» в самом начале, как в Obsidian.
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

// Теги шапки и где они в ней: «tags: a, b», «tags: [a, b]» или списком
// строк «- a» ниже. Кавычки и решётка перед именем в тег не входят.
function frontmatterTags(yaml: string) {
  const lines = yaml.split("\n");
  let offset = 0;
  const starts = lines.map((line) => {
    const start = offset;

    offset += line.length + 1;

    return start;
  });
  const at = lines.findIndex((line) => /^tags\s*:/.test(line));

  if (at === -1) {
    return [];
  }

  const line = lines[at] ?? "";
  const head = line.indexOf(":") + 1;
  const inline = [...line.slice(head).matchAll(/[^\s,[\]]+/g)];
  let values = inline.map((match) => ({ raw: match[0], from: (starts[at] ?? 0) + head + match.index }));

  if (inline.length === 0) {
    values = [];

    for (const [index, text] of lines.entries()) {
      if (index <= at) {
        continue;
      }

      const item = /^(\s*-\s*)(\S*)/.exec(text);

      if (item === null) {
        break;
      }

      values.push({ raw: item[2] ?? "", from: (starts[index] ?? 0) + (item[1] ?? "").length });
    }
  }

  return values.flatMap(({ raw, from }) => {
    const prefix = /^["']?#?/.exec(raw)?.[0].length ?? 0;
    const name = tagName(raw.slice(prefix));

    if (name === null) {
      return [];
    }

    return [{ name, from: from + prefix }];
  });
}

// Разбор блоков видит только строку вперёд, а закрыта ли шапка, видно лишь
// по тексту дальше. Текст берётся из входа разбора: поле внутреннее,
// но есть в @lezer/markdown давно, и тесты шапки заметят, если оно пропадёт.
type WithInput = { input?: { length: number; read: (from: number, to: number) => string } };

// Шапка заметки отдельным блоком, а не разметкой: строка «---» под ней
// не делает заголовок, а «#» в ней это комментарий YAML, а не тег. Теги
// из «tags:» в ней узлы Hashtag, как в тексте. Шапка без закрывающей
// строки остаётся обычным текстом. Узел Hashtag объявляет Hashtags,
// поэтому шапка подключается только вместе с ними.
export const Frontmatter: MarkdownConfig = {
  defineNodes: [{ name: "Frontmatter", block: true, style: frontmatter }],
  parseBlock: [
    {
      name: "Frontmatter",
      before: "HorizontalRule",
      parse(cx, line) {
        const { input } = cx as unknown as WithInput;

        if (cx.lineStart !== 0 || !/^---\s*$/.test(line.text) || input === undefined) {
          return false;
        }

        const head = FRONTMATTER.exec(input.read(0, input.length));

        if (head === null) {
          return false;
        }

        const block = head[0].replace(/\r?\n$/, "");
        const yaml = block.indexOf("\n") + 1;
        const tags = frontmatterTags(head[1] ?? "").map(({ name, from }) =>
          cx.elt("Hashtag", yaml + from, yaml + from + name.length),
        );

        for (let left = block.split("\n").length; left > 0; left -= 1) {
          cx.nextLine();
        }

        cx.addElement(cx.elt("Frontmatter", 0, block.length, tags));

        return true;
      },
    },
  ],
};

const tagParser = parser.configure([GFM, Hashtags, Frontmatter]);

// Теги заметки как написаны, без решётки, с повторами: из шапки и из текста.
export function tagsOf(text: string): string[] {
  const found: string[] = [];

  tagParser.parse(text).iterate({
    enter(node) {
      if (node.name === "Hashtag") {
        found.push(text.slice(node.from, node.to).replace(/^#/, ""));
      }
    },
  });

  return found;
}
