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

const tagParser = parser.configure([GFM, Hashtags]);

// Шапка заметки между строками «---», как в Obsidian.
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

// Теги шапки: «tags: a, b», «tags: [a, b]» или списком строк «- a» ниже.
function frontmatterTags(yaml: string) {
  const lines = yaml.split(/\r?\n/);
  const at = lines.findIndex((line) => /^tags\s*:/.test(line));

  if (at === -1) {
    return [];
  }

  const inline = (lines[at] ?? "").replace(/^tags\s*:/, "").trim();
  let values = inline.replace(/^\[|\]$/g, "").split(/[\s,]+/);

  if (inline === "") {
    values = [];

    for (const line of lines.slice(at + 1)) {
      if (!/^\s*-/.test(line)) {
        break;
      }

      values.push(line.replace(/^\s*-/, ""));
    }
  }

  return values.flatMap((value) => {
    const name = tagName(value.trim().replace(/^["']|["']$/g, "").replace(/^#/, ""));

    if (name === null) {
      return [];
    }

    return [name];
  });
}

// Теги заметки как написаны, без решётки, с повторами: из шапки и из текста.
export function tagsOf(text: string): string[] {
  const head = FRONTMATTER.exec(text);
  const body = text.slice(head?.[0].length ?? 0);
  const found = frontmatterTags(head?.[1] ?? "");

  tagParser.parse(body).iterate({
    enter(node) {
      if (node.name === "Hashtag") {
        found.push(body.slice(node.from + 1, node.to));
      }
    },
  });

  return found;
}
