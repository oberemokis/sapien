// [[заметка]] и [[заметка|подпись]], как в Obsidian. lezer такие ссылки
// не разбирает, они ищутся в тексте.
const WIKI_LINK = /\[\[([^[\]|\n]+)(\|[^[\]\n]+)?\]\]/g;

export type WikiLink = {
  from: number;
  to: number;
  // Имя или путь заметки, как написан.
  target: string;
  // Что видно на месте ссылки и откуда это начинается в тексте.
  label: string;
  labelFrom: number;
};

export function wikiLinks(text: string): WikiLink[] {
  return [...text.matchAll(WIKI_LINK)].map((match) => {
    const target = match[1] ?? "";
    const alias = match[2];
    let label = target;
    let labelFrom = match.index + 2;

    if (alias !== undefined) {
      label = alias.slice(1);
      labelFrom += target.length + 1;
    }

    return { from: match.index, to: match.index + match[0].length, target, label, labelFrom };
  });
}
