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

describe("редактор markdown", () => {
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
