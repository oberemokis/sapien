import { EditorView } from "@codemirror/view";
import { act, render, screen } from "@testing-library/react";
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
});
