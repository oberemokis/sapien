import { currentCompletions } from "@codemirror/autocomplete";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownEditor, MarkdownReader } from "@/modules/editor";
import type { IssueMention, IssueMentions } from "./components/issues";
import { setEditorMode } from "./interactions/editor-mode";
import { editorModeStore } from "./store/editor-mode.store";

function view() {
  const content = screen.getByRole("textbox", { name: "план" });
  const found = EditorView.findFromDOM(content);

  if (found === null) {
    throw new Error("редактор не найден");
  }

  return found;
}

// Набор человека: правка от курсора, как её делает CodeMirror на ввод.
function typeAt(position: number, text: string) {
  act(() => {
    view().dispatch({ changes: { from: position, insert: text }, userEvent: "input.type" });
  });
}

// Набор, после которого курсор стоит за набранным: подсказка смотрит
// на место курсора.
function typeWithCursor(position: number, text: string) {
  act(() => {
    view().dispatch({
      changes: { from: position, insert: text },
      selection: { anchor: position + text.length },
      userEvent: "input.type",
    });
  });
}

const mod = /Mac/.test(navigator.userAgent) ? { metaKey: true } : { ctrlKey: true };

// Кусок строки редактора с этим текстом: подсветка разбивает строку
// на такие куски, когда разобрала разметку.
async function piece(text: string) {
  return vi.waitFor(() => {
    const found = [...document.querySelectorAll(".cm-line span")].find((span) => span.textContent === text);

    if (found === undefined) {
      throw new Error(`нет куска «${text}»`);
    }

    return found;
  });
}

// Блоки верхнего уровня разобранного текста по порядку.
function blocks() {
  const { state } = view();
  const names: string[] = [];
  let node = ensureSyntaxTree(state, state.doc.length, 1000)?.topNode.firstChild ?? null;

  while (node !== null) {
    names.push(node.name);
    node = node.nextSibling;
  }

  return names;
}

describe("редактор markdown", () => {
  it("⌘клик по ссылке отдаёт её адрес, простой клик ставит курсор", async () => {
    const onLinkClick = vi.fn();
    render(
      <MarkdownEditor
        value="[доки](https://tauri.app/#start) и https://example.com"
        onChange={vi.fn()}
        label="план"
        onLinkClick={onLinkClick}
      />,
    );

    fireEvent.mouseDown(await piece("https://example.com"));
    expect(onLinkClick).not.toHaveBeenCalled();

    fireEvent.mouseDown(await piece("доки"), mod);
    fireEvent.mouseDown(await piece("https://example.com"), mod);
    expect(onLinkClick.mock.calls).toEqual([["https://tauri.app/#start"], ["https://example.com"]]);
  });

  it("HTML и javascript: из заметки остаются текстом и ничего не выполняют", async () => {
    const onLinkClick = vi.fn();
    const { container } = render(
      <MarkdownEditor
        value={'<script>window.hacked = 1</script>\n\n<img src=x onerror="window.hacked = 2">\n\n[жми](javascript:window.hacked=3)'}
        onChange={vi.fn()}
        label="план"
        onLinkClick={onLinkClick}
      />,
    );

    fireEvent.mouseDown(await piece("жми"), mod);

    // cm-widgetBuffer это пустая картинка самого CodeMirror рядом со
    // спрятанной разметкой, из заметки она не берётся.
    expect(container.querySelector("script, img:not(.cm-widgetBuffer), iframe")).toBeNull();
    expect(view().state.doc.line(3).text).toBe('<img src=x onerror="window.hacked = 2">');
    expect("hacked" in window).toBe(false);
    // Адрес уходит наружу как есть: в браузер его не пустит Rust.
    expect(onLinkClick).toHaveBeenCalledWith("javascript:window.hacked=3");
  });

  it("правка человека уходит наружу", () => {
    const onChange = vi.fn();
    render(<MarkdownEditor value="# План" onChange={onChange} label="план" />);

    typeAt(6, "\n- [ ] созвон");

    expect(onChange).toHaveBeenLastCalledWith("# План\n- [ ] созвон");
  });

  it("текст снаружи заменяет свой, не возвращается обратно, курсор на месте", () => {
    const onChange = vi.fn();
    const { rerender } = render(<MarkdownEditor value="раз три" onChange={onChange} label="план" />);
    act(() => view().dispatch({ selection: { anchor: 7 } }));

    rerender(<MarkdownEditor value="раз два три" onChange={onChange} label="план" />);

    expect(view().state.doc.toString()).toBe("раз два три");
    expect(view().state.selection.main.head).toBe(11);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("пропавший файл виден, но не правится", () => {
    const { rerender } = render(<MarkdownEditor value="план" onChange={vi.fn()} label="план" />);

    rerender(<MarkdownEditor value="план" onChange={vi.fn()} readOnly label="план" />);

    expect(view().state.facet(EditorView.editable)).toBe(false);
  });

  it("переименованный файл меняет подпись, редактор остаётся тем же", () => {
    const { rerender } = render(<MarkdownEditor value="план" onChange={vi.fn()} label="план" />);
    const before = view();

    rerender(<MarkdownEditor value="план" onChange={vi.fn()} label="итоги" />);

    expect(screen.getByRole("textbox", { name: "итоги" })).toBe(before.contentDOM);
  });

  it("вставка встаёт у курсора, выделенное остаётся, правка уходит наружу", () => {
    const onChange = vi.fn();
    const { rerender } = render(<MarkdownEditor value="раз три" onChange={onChange} label="план" />);
    act(() => view().dispatch({ selection: { anchor: 0, head: 4 } }));

    rerender(<MarkdownEditor value="раз три" onChange={onChange} insert="два " label="план" />);

    expect(view().state.doc.toString()).toBe("раз два три");
    expect(view().state.selection.main.head).toBe(8);
    expect(onChange).toHaveBeenLastCalledWith("раз два три");
  });

  it("тег выделен, клик по нему зовёт поиск, тег в коде не выделен", async () => {
    const onTagClick = vi.fn();
    render(<MarkdownEditor value={"созвон #работа\n`#код`"} onChange={vi.fn()} label="план" onTagClick={onTagClick} />);

    const tags = await vi.waitFor(() => {
      const found = [...document.querySelectorAll(".cm-hashtag")];

      expect(found).not.toHaveLength(0);

      return found;
    });

    expect(tags.map((tag) => tag.textContent)).toEqual(["#работа"]);
    fireEvent.mouseDown(tags[0] as Element);
    expect(onTagClick).toHaveBeenCalledWith("работа");
  });

  it("после решётки подсказывает теги хранилища, в блоке кода нет", async () => {
    render(<MarkdownEditor value={"```\n\n```\n"} onChange={vi.fn()} label="план" tags={["работа", "отпуск"]} />);

    // Пустая строка внутри блока кода.
    typeWithCursor(4, "#р");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(currentCompletions(view().state)).toEqual([]);

    typeWithCursor(view().state.doc.length, "#р");
    await vi.waitFor(() =>
      expect(currentCompletions(view().state).map((option) => option.label)).toEqual(["#работа"]),
    );
  });

  it("шапка отдельным блоком: под ней не заголовок, черта в середине осталась чертой", () => {
    render(<MarkdownEditor value={"---\ntags: [работа]\n---\n# План\n\n---\n\nтекст"} onChange={vi.fn()} label="план" />);

    expect(blocks()).toEqual(["Frontmatter", "ATXHeading1", "HorizontalRule", "Paragraph"]);
  });

  it("шапка без закрывающей строки остаётся обычным текстом", () => {
    render(<MarkdownEditor value={"---\ntags: [работа]\n# План"} onChange={vi.fn()} label="план" />);

    expect(blocks()).toEqual(["HorizontalRule", "Paragraph", "ATXHeading1"]);
  });

  it("тег шапки выделен как тег текста и ищется кликом, подсказки с решёткой в шапке нет", async () => {
    const onTagClick = vi.fn();
    render(
      <MarkdownEditor
        value={"---\ntags: [работа, план]\ntitle: x\n---\n#идея"}
        onChange={vi.fn()}
        label="план"
        tags={["работа"]}
        onTagClick={onTagClick}
      />,
    );

    const tags = await vi.waitFor(() => {
      const found = [...document.querySelectorAll(".cm-hashtag")];

      expect(found).toHaveLength(3);

      return found;
    });

    expect(tags.map((tag) => tag.textContent)).toEqual(["работа", "план", "#идея"]);
    fireEvent.mouseDown(tags[0] as Element);
    expect(onTagClick).toHaveBeenCalledWith("работа");

    // Конец строки «title: x»: в шапке «#» начинает комментарий YAML.
    typeWithCursor(view().state.doc.line(3).to, " #р");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(currentCompletions(view().state)).toEqual([]);
  });
});

// Строки редактора так, как их видит человек: спрятанная разметка
// в текст строки не попадает, точка списка попадает.
function lines() {
  return [...document.querySelectorAll(".cm-line")].map((line) => line.textContent);
}

function moveCursor(anchor: number) {
  act(() => {
    view().dispatch({ selection: { anchor } });
  });
}

describe("Live Preview", () => {
  afterEach(() => {
    editorModeStore.setState(() => "preview");
  });

  const note = [
    "# Заголовок",
    "**жирный**, _курсив_, ~~старое~~ и `код`",
    "[ссылка](https://tauri.app) и [[Планы|подпись]] и [[Встречи]]",
    "> цитата",
    "- пункт",
    "конец",
  ].join("\n");

  it("прячет разметку вне строки с курсором и показывает на строке с курсором", async () => {
    render(<MarkdownEditor value={note} onChange={vi.fn()} label="план" />);

    await vi.waitFor(() =>
      expect(lines()).toEqual([
        "# Заголовок",
        "жирный, курсив, старое и код",
        "ссылка и подпись и Встречи",
        "цитата",
        "• пункт",
        "конец",
      ]),
    );

    moveCursor(view().state.doc.line(2).from);

    expect(lines().slice(0, 3)).toEqual([
      "Заголовок",
      "**жирный**, _курсив_, ~~старое~~ и `код`",
      "ссылка и подпись и Встречи",
    ]);
    // Текст файла не меняется, меняется только вид.
    expect(view().state.doc.toString()).toBe(note);
  });

  it("⌘клик по спрятанной ссылке всё ещё отдаёт адрес", async () => {
    const onLinkClick = vi.fn();
    render(<MarkdownEditor value={note} onChange={vi.fn()} label="план" onLinkClick={onLinkClick} />);

    fireEvent.mouseDown(await piece("ссылка"), mod);

    expect(onLinkClick).toHaveBeenCalledWith("https://tauri.app");
  });

  it("флажок задачи отмечается щелчком и пишет в текст, курсор не двигается", async () => {
    const onChange = vi.fn();
    render(<MarkdownEditor value={"- [ ] купить\n- [x] готово\nконец"} onChange={onChange} label="план" />);
    moveCursor(view().state.doc.length);

    const boxes = await vi.waitFor(() => {
      const found = screen.getAllByRole("checkbox", { name: "Задача выполнена" });

      expect(found).toHaveLength(2);

      return found;
    });

    expect(boxes.map((box) => (box as HTMLInputElement).checked)).toEqual([false, true]);
    expect(lines()).toEqual([" купить", " готово", "конец"]);

    fireEvent.mouseDown(boxes[0] as Element);
    expect(onChange).toHaveBeenLastCalledWith("- [x] купить\n- [x] готово\nконец");

    fireEvent.mouseDown(screen.getAllByRole("checkbox", { name: "Задача выполнена" })[1] as Element);
    expect(onChange).toHaveBeenLastCalledWith("- [x] купить\n- [ ] готово\nконец");
    expect(view().state.selection.main.head).toBe(view().state.doc.length);
  });

  it("в пропавшем файле флажок не нажимается", async () => {
    const onChange = vi.fn();
    render(<MarkdownEditor value={"конец\n- [ ] купить"} onChange={onChange} label="план" readOnly />);

    const box = await screen.findByRole("checkbox", { name: "Задача выполнена" });
    fireEvent.mouseDown(box);

    expect((box as HTMLInputElement).disabled).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("код, картинки и таблицы остаются исходным текстом", async () => {
    render(
      <MarkdownEditor
        value={"начало\n\n```\n**не жирный** [[не ссылка]]\n```\n\n![схема](x.png)\n\n| а | б |\n| - | - |\n| 1 | 2 |"}
        onChange={vi.fn()}
        label="план"
      />,
    );

    await vi.waitFor(() => expect(lines()).toContain("**не жирный** [[не ссылка]]"));
    expect(lines()).toContain("![схема](x.png)");
    expect(lines()).toContain("| а | б |");
  });

  it("квадратные скобки без адреса остаются текстом", async () => {
    render(<MarkdownEditor value={"начало\n[x] и [1], а [доки](https://tauri.app)"} onChange={vi.fn()} label="план" />);

    await vi.waitFor(() => expect(lines()[1]).toBe("[x] и [1], а доки"));
  });

  it("исходный текст во «Внешнем виде» показывает разметку везде, переключение без нового редактора", async () => {
    setEditorMode("source");
    render(<MarkdownEditor value={note} onChange={vi.fn()} label="план" />);
    const before = view();

    expect(lines()).toEqual(note.split("\n"));

    act(() => setEditorMode("preview"));

    await vi.waitFor(() => expect(lines()[1]).toBe("жирный, курсив, старое и код"));
    expect(view()).toBe(before);
  });
});

function reader(value: string, props: Partial<ComponentProps<typeof MarkdownReader>> = {}) {
  const handlers = {
    onChange: vi.fn(),
    onTagClick: vi.fn(),
    onLinkClick: vi.fn(),
    onNoteClick: vi.fn(),
    findNote: (target: string) => ({ Идеи: "Идеи.md" })[target] ?? null,
  };
  const result = render(
    <MarkdownReader value={value} readOnly={false} label="план" hidden={false} focusRequest={0} {...handlers} {...props} />,
  );

  return { ...result, ...handlers };
}

describe("режим чтения", () => {
  it("заметка отрисована целиком: шапка, заголовки, списки, задачи, таблица, код, цитата, ссылки", () => {
    const { container } = reader(
      [
        "---",
        "tags: [работа, план]",
        "title: Итоги",
        "---",
        "# Заголовок",
        "",
        "Текст с **жирным**, _курсивом_, ~~старым~~ и `кодом`, тег #идея.",
        "",
        "- пункт",
        "- [x] сделано",
        "",
        "3. третий",
        "",
        "> цитата",
        "",
        "| а | б |",
        "| - | - |",
        "| 1 | **2** |",
        "",
        "```ts",
        "const x = 1;",
        "```",
        "",
        "---",
      ].join("\n"),
    );

    expect(screen.getByRole("heading", { level: 1, name: "Заголовок" })).toBeDefined();
    expect([...container.querySelectorAll("dt, dd")].map((cell) => cell.textContent)).toEqual([
      "tags",
      "работа, план",
      "title",
      "Итоги",
    ]);
    expect(container.querySelector("strong")?.textContent).toBe("жирным");
    expect(container.querySelector("em")?.textContent).toBe("курсивом");
    expect(container.querySelector("s")?.textContent).toBe("старым");
    expect(container.querySelector("p code")?.textContent).toBe("кодом");
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["пункт", "сделано", "третий"]);
    expect(container.querySelector("ol")?.getAttribute("start")).toBe("3");
    expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "сделано" }).checked).toBe(true);
    expect(container.querySelector("blockquote")?.textContent).toBe("цитата");
    expect(screen.getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["1", "2"]);
    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["а", "б"]);
    expect(container.querySelector("pre")?.textContent).toBe("const x = 1;");
    expect(container.querySelectorAll("hr")).toHaveLength(1);
  });

  it("HTML и javascript: из заметки остаются текстом и ничего не выполняют", () => {
    const { container, onLinkClick } = reader(
      '<script>window.hacked = 1</script>\n\n<img src=x onerror="window.hacked = 2">\n\nтекст <b onclick="window.hacked = 4">жирный</b>\n\n[жми](javascript:window.hacked=3)',
    );

    fireEvent.click(screen.getByRole("link", { name: "жми" }));

    expect(container.querySelector("script, img, iframe, b")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="window.hacked = 2">');
    expect(screen.getByRole("link", { name: "жми" }).getAttribute("href")).toBe("#");
    expect("hacked" in window).toBe(false);
    // Адрес уходит наружу как есть: в браузер его не пустит Rust.
    expect(onLinkClick).toHaveBeenCalledWith("javascript:window.hacked=3");
  });

  it("ссылка на сайт открывается щелчком, тег ищется, [[заметка]] открывает её, а без заметки это текст", () => {
    const { onLinkClick, onTagClick, onNoteClick } = reader(
      "[доки](https://tauri.app), https://example.com, #идея, [[Идеи]], [[Идеи|мысли]], [[Нет]] и [x]",
    );

    fireEvent.click(screen.getByRole("link", { name: "доки" }));
    fireEvent.click(screen.getByRole("link", { name: "https://example.com" }));
    fireEvent.click(screen.getByRole("button", { name: "#идея" }));
    fireEvent.click(screen.getByRole("button", { name: "Идеи" }));
    fireEvent.click(screen.getByRole("button", { name: "мысли" }));

    expect(onLinkClick.mock.calls).toEqual([["https://tauri.app"], ["https://example.com"]]);
    expect(onTagClick).toHaveBeenCalledWith("идея");
    expect(onNoteClick.mock.calls).toEqual([["Идеи.md"], ["Идеи.md"]]);
    expect(screen.queryByRole("button", { name: "Нет" })).toBeNull();
    expect(screen.getByTitle("Такой заметки нет").textContent).toBe("Нет");
    expect(screen.getByRole("document", { name: "план" }).textContent).toContain("Нет и [x]");
  });

  it("флажок задачи пишет в текст, в пропавшем файле не нажимается", () => {
    const { onChange, unmount } = reader("- [ ] купить\n- [x] готово");

    fireEvent.click(screen.getByRole("checkbox", { name: "купить" }));
    expect(onChange).toHaveBeenLastCalledWith("- [x] купить\n- [x] готово");
    fireEvent.click(screen.getByRole("checkbox", { name: "готово" }));
    expect(onChange).toHaveBeenLastCalledWith("- [ ] купить\n- [ ] готово");
    unmount();

    reader("- [ ] купить", { readOnly: true });
    expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "купить" }).disabled).toBe(true);
  });

  it("спрятанное чтение не разбирает новый текст, на экране показывает свежий и забирает фокус", () => {
    const { rerender, onChange, onTagClick, onLinkClick, onNoteClick, findNote } = reader("# Было");
    const props = { readOnly: false, label: "план", focusRequest: 0, onChange, onTagClick, onLinkClick, onNoteClick, findNote };

    rerender(<MarkdownReader value="# Стало" hidden {...props} />);
    expect(screen.getByRole("heading", { hidden: true }).textContent).toBe("Было");

    rerender(<MarkdownReader value="# Стало" hidden={false} {...props} />);
    expect(screen.getByRole("heading").textContent).toBe("Стало");
    expect(document.activeElement).toBe(screen.getByRole("document", { name: "план" }));
  });
});

// Задачи проекта SAP: ответы о номерах и подсказка после «SAP-».
function issues(mentions: Record<string, IssueMention>, onOpen = vi.fn()): IssueMentions {
  return {
    prefixes: new Set(["SAP"]),
    mentions: new Map(Object.entries(mentions)),
    suggest: async () => [
      { id: "SAP-12", summary: "Вход по ссылке" },
      { id: "SAP-7", summary: "Письмо со ссылкой" },
      { id: "SAP-3", summary: "Тёмная тема" },
    ],
    onOpen,
  };
}

const open: IssueMention = { label: "Open", muted: false, title: "SAP-1 Вход", details: [] };
const missing: IssueMention = { label: "не найдена", muted: true, title: "SAP-404", details: [] };

async function plaques(count: number) {
  return vi.waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>(".cm-issue")];

    expect(found).toHaveLength(count);

    return found;
  });
}

// Статусы за номерами: слово и серая ли плашка.
function states() {
  return [...document.querySelectorAll(".cm-issue-state")].map((state) => [
    state.textContent,
    state.classList.contains("cm-issue-muted"),
  ]);
}

describe("номера задач в редакторе", () => {
  it("номер известного проекта плашкой со статусом, в коде и с чужим префиксом текстом", async () => {
    render(
      <MarkdownEditor
        value={"SAP-1 и SAP-404, ещё SAP-9 и ABC-1\n\n`SAP-1`\n\n```\nSAP-1\n```"}
        onChange={vi.fn()}
        label="план"
        issues={issues({ "SAP-1": open, "SAP-404": missing })}
      />,
    );

    expect((await plaques(3)).map((plaque) => plaque.textContent)).toEqual(["SAP-1", "SAP-404", "SAP-9"]);
    // У SAP-9 ответа ещё нет: плашка без статуса.
    expect(states()).toEqual([
      ["Open", false],
      ["не найдена", true],
    ]);
  });

  it("новый статус меняет плашку без нового редактора", async () => {
    const { rerender } = render(
      <MarkdownEditor value="SAP-1" onChange={vi.fn()} label="план" issues={issues({ "SAP-1": open })} />,
    );
    const editor = view();

    await plaques(1);
    rerender(
      <MarkdownEditor
        value="SAP-1"
        onChange={vi.fn()}
        label="план"
        issues={issues({ "SAP-1": { ...open, label: "Fixed" } })}
      />,
    );

    await vi.waitFor(() => expect(states()).toEqual([["Fixed", false]]));
    expect(view()).toBe(editor);
  });

  it("клик по статусу и ⌘клик по номеру открывают задачу, простой клик по номеру нет", async () => {
    const onOpen = vi.fn();
    render(<MarkdownEditor value="SAP-1" onChange={vi.fn()} label="план" issues={issues({ "SAP-1": open }, onOpen)} />);

    const [plaque] = await plaques(1);

    // Выделение от редактора прошлого теста happy-dom не снимает, и простой
    // клик по новому редактору спотыкается о него.
    document.getSelection()?.removeAllRanges();
    fireEvent.mouseDown(plaque as Element, mod);
    fireEvent.mouseDown(document.querySelector(".cm-issue-state") as Element);
    expect(onOpen.mock.calls).toEqual([["SAP-1"], ["SAP-1"]]);

    fireEvent.mouseDown(plaque as Element);
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("после «SAP-» подсказывает задачи проекта по номеру и названию, после чужого префикса нет", async () => {
    render(<MarkdownEditor value="" onChange={vi.fn()} label="план" issues={issues({})} />);

    typeWithCursor(0, "ABC-");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(currentCompletions(view().state)).toEqual([]);

    typeWithCursor(view().state.doc.length, " SAP-");
    await vi.waitFor(() =>
      expect(currentCompletions(view().state).map((option) => option.label)).toEqual(["SAP-12", "SAP-7", "SAP-3"]),
    );

    typeWithCursor(view().state.doc.length, "1");
    await vi.waitFor(() => expect(currentCompletions(view().state).map((option) => option.label)).toEqual(["SAP-12"]));

    typeWithCursor(view().state.doc.length, " SAP-ссылк");
    await vi.waitFor(() =>
      expect(currentCompletions(view().state).map((option) => option.label)).toEqual(["SAP-12", "SAP-7"]),
    );
  });
});
