import { GFM, parser } from "@lezer/markdown";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Frontmatter, Hashtags } from "@/core/markdown/tags";
import { wikiLinks } from "../model/wiki-links";

const readerParser = parser.configure([GFM, Hashtags, Frontmatter]);

type Node = ReturnType<typeof readerParser.parse>["topNode"];

// Знаки разметки: в чтении их не видно.
const MARKS = new Set([
  "EmphasisMark",
  "CodeMark",
  "CodeInfo",
  "LinkMark",
  "LinkLabel",
  "LinkTitle",
  "HeaderMark",
  "QuoteMark",
  "ListMark",
  "TaskMarker",
  "StrikethroughMark",
  "TableDelimiter",
]);

const HEADINGS = ["text-[1.6em]", "text-[1.35em]", "text-[1.15em]", "text-[1em]", "text-[1em]", "text-[1em]"];

type Props = {
  value: string;
  onChange: (text: string) => void;
  readOnly: boolean;
  label: string;
  hidden: boolean;
  // Каждый новый номер больше нуля ставит фокус в чтение, когда оно на экране.
  focusRequest: number;
  onTagClick: (tag: string) => void;
  onLinkClick: (url: string) => void;
  findNote: (target: string) => string | null;
  onNoteClick: (path: string) => void;
};

type Context = Pick<Props, "readOnly" | "findNote" | "onChange" | "onTagClick" | "onLinkClick" | "onNoteClick"> & {
  text: string;
  missing: string;
};

function childrenOf(node: Node) {
  const children: Node[] = [];

  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    children.push(child);
  }

  return children;
}

function NoteLink({ cx, target, label }: { cx: Context; target: string; label: string }) {
  const path = cx.findNote(target);

  if (path === null) {
    return (
      <span title={cx.missing} className="text-content/50 underline decoration-dashed underline-offset-2">
        {label}
      </span>
    );
  }

  return (
    <button
      type="button"
      className="cursor-pointer text-link underline underline-offset-2"
      onClick={() => cx.onNoteClick(path)}
    >
      {label}
    </button>
  );
}

function WebLink({ cx, url, children }: { cx: Context; url: string; children: ReactNode }) {
  // В href попадает только адрес сайта или почты: остальное, например
  // javascript:, уходит наружу щелчком, и его не пустит Rust.
  let href = "#";

  if (/^(https?:|mailto:)/i.test(url)) {
    href = url;
  }

  return (
    <a
      href={href}
      className="text-link underline underline-offset-2"
      onClick={(event) => {
        event.preventDefault();
        cx.onLinkClick(url);
      }}
    >
      {children}
    </a>
  );
}

// Текст между узлами. [[заметки]] lezer не знает, они ищутся здесь.
function plain(cx: Context, from: number, to: number): ReactNode[] {
  const text = cx.text.slice(from, to);
  const out: ReactNode[] = [];
  let at = 0;

  for (const wiki of wikiLinks(text)) {
    out.push(
      text.slice(at, wiki.from),
      <NoteLink key={from + wiki.from} cx={cx} target={wiki.target} label={wiki.label} />,
    );
    at = wiki.to;
  }

  out.push(text.slice(at));

  return out;
}

// Узлы строки от from до to. «[[заметка]]» lezer разбирает как ссылку
// без адреса внутри скобок: такие куски целиком уходят в plain.
function inline(node: Node, cx: Context, from = node.from, to = node.to): ReactNode[] {
  const out: ReactNode[] = [];
  const wikis = wikiLinks(cx.text.slice(from, to)).map((wiki) => ({ from: from + wiki.from, to: from + wiki.to }));
  let at = from;

  for (const child of childrenOf(node)) {
    const inWiki = wikis.some((wiki) => child.from >= wiki.from && child.to <= wiki.to);

    if (child.to <= at || child.from >= to || inWiki) {
      continue;
    }

    out.push(...plain(cx, at, child.from), span(child, cx));
    at = child.to;
  }

  out.push(...plain(cx, at, to));

  return out;
}

function span(node: Node, cx: Context): ReactNode {
  const key = `${node.name}-${node.from}`;

  if (MARKS.has(node.name)) {
    return null;
  }

  switch (node.name) {
    case "Emphasis":
      return <em key={key}>{inline(node, cx)}</em>;
    case "StrongEmphasis":
      return <strong key={key}>{inline(node, cx)}</strong>;
    case "Strikethrough":
      return <s key={key}>{inline(node, cx)}</s>;
    case "InlineCode":
      return (
        <code key={key} className="rounded bg-content/8 px-1 py-px font-mono text-code">
          {inline(node, cx)}
        </code>
      );
    case "Link": {
      const url = node.getChild("URL");
      const [open, close] = node.getChildren("LinkMark");

      // «[текст]» без адреса это текст со скобками, как в Obsidian.
      if (url === null || open === undefined || close === undefined) {
        return <span key={key}>{plain(cx, node.from, node.to)}</span>;
      }

      return (
        <WebLink key={key} cx={cx} url={cx.text.slice(url.from, url.to)}>
          {inline(node, cx, open.to, close.from)}
        </WebLink>
      );
    }
    case "Autolink":
    case "URL": {
      const url = node.getChild("URL") ?? node;
      const address = cx.text.slice(url.from, url.to);

      return (
        <WebLink key={key} cx={cx} url={address}>
          {address}
        </WebLink>
      );
    }
    case "Hashtag": {
      const tag = cx.text.slice(node.from, node.to);

      return (
        <button
          key={key}
          type="button"
          className="cursor-pointer rounded bg-mention/14 px-[3px] py-px text-mention"
          onClick={() => cx.onTagClick(tag.replace(/^#/, ""))}
        >
          {tag}
        </button>
      );
    }
    case "HardBreak":
      return <br key={key} />;
    case "Escape":
      return cx.text.slice(node.from + 1, node.to);
    default:
      // Картинки, HTML и всё прочее остаётся текстом как есть: из заметки
      // ничего не рисуется как HTML и ничего не выполняется.
      return cx.text.slice(node.from, node.to);
  }
}

// Границы текста без пробелов по краям: «# Заголовок», «- [ ] задача».
function trimmed(cx: Context, from: number, to: number) {
  let start = from;
  let end = to;

  while (start < end && /\s/.test(cx.text[start] ?? "")) {
    start += 1;
  }

  while (end > start && /\s/.test(cx.text[end - 1] ?? "")) {
    end -= 1;
  }

  return [start, end] as const;
}

// Текст заголовка без решёток в начале и в конце или без черты под ним.
function headingText(node: Node, cx: Context) {
  let from = node.from;
  let to = node.to;

  for (const mark of node.getChildren("HeaderMark")) {
    if (mark.from === from) {
      from = mark.to;
    } else if (mark.to === to) {
      to = mark.from;
    }
  }

  return inline(node, cx, ...trimmed(cx, from, to));
}

function blocks(node: Node, cx: Context): ReactNode[] {
  return childrenOf(node).map((child) => block(child, cx));
}

function codeText(node: Node, cx: Context) {
  return node
    .getChildren("CodeText")
    .map((part) => cx.text.slice(part.from, part.to))
    .join("");
}

function Task({ node, cx }: { node: Node; cx: Context }) {
  const marker = node.getChild("TaskMarker");

  if (marker === null) {
    return null;
  }

  const checked = /x/i.test(cx.text.slice(marker.from, marker.to));

  function toggle() {
    if (marker === null) {
      return;
    }

    let mark = "x";

    if (checked) {
      mark = " ";
    }

    cx.onChange(cx.text.slice(0, marker.from + 1) + mark + cx.text.slice(marker.from + 2));
  }

  return (
    <div className="-ml-6 flex items-baseline gap-2">
      <input
        type="checkbox"
        className="accent-accent"
        checked={checked}
        disabled={cx.readOnly}
        aria-label={cx.text.slice(marker.to, node.to).trim()}
        onChange={toggle}
      />
      <span className={checked ? "whitespace-pre-line text-content/50 line-through" : "whitespace-pre-line"}>
        {inline(node, cx, ...trimmed(cx, marker.to, node.to))}
      </span>
    </div>
  );
}

// Шапка заметки списком «имя: значение». YAML читается в тех же видах,
// что пишет приложение: «key: value», «key: [a, b]» и строки «- a» ниже.
function properties(yaml: string) {
  const entries: { key: string; values: string[] }[] = [];

  for (const line of yaml.split("\n")) {
    const item = /^\s+-\s*(.*)$|^-\s*(.*)$/.exec(line);
    const last = entries.at(-1);

    if (item !== null && last !== undefined) {
      last.values.push(item[1] ?? item[2] ?? "");
      continue;
    }

    const pair = /^([^\s#:][^:]*):\s*(.*)$/.exec(line);

    if (pair !== null) {
      const value = (pair[2] ?? "").replace(/^\[(.*)\]$/, "$1");
      const values = value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);

      entries.push({ key: pair[1] ?? "", values });
    }
  }

  return entries.map(({ key, values }) => ({
    key,
    value: values.map((value) => value.replace(/^(["'])(.*)\1$/, "$2")).join(", "),
  }));
}

function block(node: Node, cx: Context): ReactNode {
  const key = `${node.name}-${node.from}`;
  const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(node.name);

  if (MARKS.has(node.name)) {
    return null;
  }

  if (heading !== null) {
    const level = Number(heading[1]);
    const Tag = `h${level}` as "h1";

    return (
      <Tag key={key} className={`mt-6 mb-2 font-semibold text-markdown-heading first:mt-0 ${HEADINGS[level - 1]}`}>
        {headingText(node, cx)}
      </Tag>
    );
  }

  switch (node.name) {
    case "Paragraph":
      return (
        <p key={key} className="my-3 whitespace-pre-line">
          {inline(node, cx)}
        </p>
      );
    case "Blockquote":
      return (
        <blockquote key={key} className="my-3 border-l-[3px] border-content/25 pl-3 text-content/80 italic">
          {blocks(node, cx)}
        </blockquote>
      );
    case "BulletList":
      return (
        <ul key={key} className="my-3 list-disc pl-6">
          {blocks(node, cx)}
        </ul>
      );
    case "OrderedList": {
      const first = node.getChild("ListItem")?.getChild("ListMark");
      const start = Number.parseInt(cx.text.slice(first?.from ?? 0, first?.to ?? 0), 10);

      return (
        <ol key={key} start={Number.isNaN(start) ? 1 : start} className="my-3 list-decimal pl-6">
          {blocks(node, cx)}
        </ol>
      );
    }
    case "ListItem":
      return (
        <li
          key={key}
          className={`my-1 [&>ol]:my-1 [&>p]:my-0 [&>ul]:my-1 ${node.getChild("Task") === null ? "" : "list-none"}`}
        >
          {blocks(node, cx)}
        </li>
      );
    case "Task":
      return <Task key={key} node={node} cx={cx} />;
    case "FencedCode":
    case "CodeBlock":
      return (
        <pre key={key} className="my-3 overflow-x-auto rounded-md bg-content/5 px-3 py-2 font-mono text-code">
          <code>{codeText(node, cx)}</code>
        </pre>
      );
    case "HorizontalRule":
      return <hr key={key} className="my-6 border-stroke" />;
    case "Table": {
      const [head, ...rows] = node.getChildren("TableHeader").concat(node.getChildren("TableRow"));

      return (
        <table key={key} className="my-3 border-collapse text-[14px]">
          {head !== undefined && (
            <thead>
              <tr>
                {head.getChildren("TableCell").map((cell) => (
                  <th key={cell.from} className="border border-stroke px-3 py-1 text-left font-semibold">
                    {inline(cell, cx)}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {rows.map((row) => (
              <tr key={row.from}>
                {row.getChildren("TableCell").map((cell) => (
                  <td key={cell.from} className="border border-stroke px-3 py-1">
                    {inline(cell, cx)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    case "Frontmatter": {
      const yaml = cx.text.slice(node.from, node.to).split("\n").slice(1, -1).join("\n");

      return (
        <dl
          key={key}
          className="mb-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 rounded-md border border-stroke px-3 py-2 text-[13px]"
        >
          {properties(yaml).map(({ key: name, value }) => (
            <div key={name} className="contents">
              <dt className="text-content/50">{name}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      );
    }
    case "LinkReference":
      return null;
    default:
      // HTML и прочие блоки остаются текстом.
      return (
        <p key={key} className="my-3 whitespace-pre-wrap">
          {cx.text.slice(node.from, node.to)}
        </p>
      );
  }
}

// Заметка целиком, как режим чтения в Obsidian: из того же разбора, что
// у редактора, прямо в элементы React, без строк HTML. Поэтому HTML,
// скрипты и javascript: из заметки остаются текстом. Спрятанное чтение
// текст не разбирает: оно показывает последнее увиденное и держит место
// прокрутки, пока вкладка в правке.
export function MarkdownReader({
  value,
  onChange,
  readOnly,
  label,
  hidden,
  focusRequest,
  onTagClick,
  onLinkClick,
  findNote,
  onNoteClick,
}: Props) {
  const { t } = useTranslation();
  const missing = t("editor.reader.missing");
  const rootRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(value);

  if (!hidden && shown !== value) {
    setShown(value);
  }

  // Чтение вышло на экран: фокус в него, а не в спрятанный редактор,
  // иначе набор правил бы невидимый текст.
  useEffect(() => {
    if (!hidden) {
      rootRef.current?.focus({ preventScroll: true });
    }
  }, [hidden]);

  useEffect(() => {
    if (focusRequest > 0 && !hidden) {
      rootRef.current?.focus({ preventScroll: true });
    }
  }, [focusRequest, hidden]);

  const content = useMemo(() => {
    const cx: Context = { text: shown, readOnly, findNote, missing, onChange, onTagClick, onLinkClick, onNoteClick };

    return blocks(readerParser.parse(shown).topNode, cx);
  }, [shown, readOnly, findNote, missing, onChange, onTagClick, onLinkClick, onNoteClick]);

  return (
    <div
      ref={rootRef}
      hidden={hidden}
      tabIndex={-1}
      aria-label={label}
      role="document"
      className="min-h-0 flex-1 overflow-auto outline-none"
    >
      <article className="mx-auto w-full max-w-[760px] px-8 pt-2 pb-[40vh] text-[15px] leading-[1.65] break-words">
        {content}
      </article>
    </div>
  );
}
