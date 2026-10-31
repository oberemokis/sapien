// Шапка заметки между строками «---» в самом начале, как в Obsidian.
export const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

// Шапка и текст под ней. У заметки без шапки весь текст это тело.
export function splitFrontmatter(text: string) {
  const head = FRONTMATTER.exec(text);

  if (head === null) {
    return { yaml: "", body: text };
  }

  return { yaml: head[1] ?? "", body: text.slice(head[0].length) };
}

function keyLine(key: string) {
  return new RegExp(`^${key}\\s*:`);
}

// Значения списка в шапке и где они в ней: «key: a, b», «key: [a, b]» или
// строками «- a» ниже. YAML разбирается только в этих трёх видах: другого
// заметкам не нужно. Кавычки остаются в значении, их снимает потребитель.
export function frontmatterList(yaml: string, key: string) {
  const lines = yaml.split("\n");
  let offset = 0;
  const starts = lines.map((line) => {
    const start = offset;

    offset += line.length + 1;

    return start;
  });
  const at = lines.findIndex((line) => keyLine(key).test(line));

  if (at === -1) {
    return [];
  }

  const line = lines[at] ?? "";
  const head = line.indexOf(":") + 1;
  const inline = [...line.slice(head).matchAll(/[^\s,[\]]+/g)];
  const values = inline.map((match) => ({ raw: match[0], from: (starts[at] ?? 0) + head + match.index }));

  if (inline.length > 0) {
    return values;
  }

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

  return values;
}

// Одно значение «key: значение», без кавычек вокруг. Нет ключа, null.
export function frontmatterValue(yaml: string, key: string) {
  const line = yaml.split("\n").find((text) => keyLine(key).test(text));

  if (line === undefined) {
    return null;
  }

  return line
    .slice(line.indexOf(":") + 1)
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2");
}
