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

  return unquote(line.slice(line.indexOf(":") + 1));
}

function unquote(value: string) {
  return value.trim().replace(/^(["'])(.*)\1$/, "$2");
}

// Пары «имя: значение» под ключом-картой, строками с отступом:
// «fields:», ниже «  Severity: High».
export function frontmatterMap(yaml: string, key: string) {
  const lines = yaml.split("\n");
  const at = lines.findIndex((line) => keyLine(key).test(line));
  const entries: { name: string; value: string }[] = [];

  if (at === -1) {
    return entries;
  }

  for (const line of lines.slice(at + 1)) {
    const entry = /^\s+([^:]+):(.*)$/.exec(line);

    if (entry === null) {
      break;
    }

    entries.push({ name: (entry[1] ?? "").trim(), value: unquote(entry[2] ?? "") });
  }

  return entries;
}

// Значение с «: » или « #» YAML прочёл бы иначе: такое берётся в кавычки.
// ponytail: кавычки внутри значения не экранируются, полям задач их не нужно.
function yamlValue(value: string) {
  if (/: | #|^[\s"'[\]{}>|*&!%@`#,?:-]/.test(value)) {
    return `"${value}"`;
  }

  return value;
}

// Текст, в шапке которого ключ записан заново: строка ключа и строки под
// ней (список «- a» или карта с отступом) меняются на новые. Без новых
// строк ключ уходит. Шапки нет, она появляется.
function withKey(text: string, key: string, replacement: string[]) {
  const head = FRONTMATTER.exec(text);

  if (head === null) {
    if (replacement.length === 0) {
      return text;
    }

    return `---\n${replacement.join("\n")}\n---\n${text}`;
  }

  const yaml = head[1] ?? "";
  let lines: string[] = [];

  if (yaml !== "") {
    lines = yaml.split(/\r?\n/);
  }

  const at = lines.findIndex((line) => keyLine(key).test(line));
  let next = [...lines, ...replacement];

  if (at !== -1) {
    let end = at + 1;

    while (end < lines.length && /^(\s+\S|-\s)/.test(lines[end] ?? "")) {
      end += 1;
    }

    next = [...lines.slice(0, at), ...replacement, ...lines.slice(end)];
  }

  return `---\n${next.join("\n")}\n---\n${text.slice(head[0].length)}`;
}

// Пустое значение убирает ключ из шапки.
export function withFrontmatterValue(text: string, key: string, value: string) {
  const trimmed = value.trim();

  if (trimmed === "") {
    return withKey(text, key, []);
  }

  return withKey(text, key, [`${key}: ${yamlValue(trimmed)}`]);
}

// Список одной строкой, «key: [a, b]». Пустой список убирает ключ.
export function withFrontmatterList(text: string, key: string, items: string[]) {
  const kept = items.map((item) => item.trim()).filter((item) => item !== "");

  if (kept.length === 0) {
    return withKey(text, key, []);
  }

  return withKey(text, key, [`${key}: [${kept.map(yamlValue).join(", ")}]`]);
}

// Карта под ключом целиком. Пары без имени не пишутся, пустая карта
// убирает ключ.
export function withFrontmatterMap(text: string, key: string, entries: { name: string; value: string }[]) {
  const kept = entries.filter((entry) => entry.name.trim() !== "");
  const lines = kept.map((entry) => `  ${entry.name.trim()}: ${yamlValue(entry.value.trim())}`);

  if (kept.length === 0) {
    return withKey(text, key, []);
  }

  return withKey(text, key, [`${key}:`, ...lines]);
}
