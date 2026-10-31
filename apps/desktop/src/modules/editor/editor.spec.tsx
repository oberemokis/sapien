import { currentCompletions } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "@/modules/editor";

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

    expect(container.querySelector("script, img, iframe")).toBeNull();
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
});
