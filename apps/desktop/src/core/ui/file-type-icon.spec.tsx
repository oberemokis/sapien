import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Пакет иконок держится в модуле, поэтому каждый тест берёт модуль заново:
// иначе только первый увидел бы состояние до загрузки.
async function freshFileTypeIcon() {
  vi.resetModules();

  return (await import("./file-type-icon")).FileTypeIcon;
}

async function svgOf(icon: string) {
  const { getIconSvg } = await import("react-material-icon-theme");

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(getIconSvg(icon) ?? "")}`;
}

function sizeOf(element: HTMLElement) {
  return [element.style.width, element.style.height];
}

describe("значок типа файла", () => {
  it("до загрузки пакета держит пустое место того же размера", async () => {
    const FileTypeIcon = await freshFileTypeIcon();
    const { container } = render(<FileTypeIcon name="notes.md" size={16} />);
    const placeholder = container.firstElementChild as HTMLElement;

    expect(placeholder.tagName).toBe("SPAN");

    const icon = await screen.findByRole("presentation", { hidden: true });

    expect(sizeOf(icon)).toEqual(sizeOf(placeholder));
    expect(icon.getAttribute("src")).toBe(await svgOf("markdown"));
  });

  it.each([
    ["package.json", "nodejs"],
    ["types.d.ts", "typescript-def"],
    ["api.service.ts", "typescript"],
    [".gitignore", "git"],
    ["без-расширения", "file"],
  ])("%s получает значок %s", async (name, expected) => {
    const FileTypeIcon = await freshFileTypeIcon();
    render(<FileTypeIcon name={name} />);

    const icon = await screen.findByRole("presentation", { hidden: true });

    expect(icon.getAttribute("src")).toBe(await svgOf(expected));
  });

  it("папка получает значок по имени и по тому, открыта ли она", async () => {
    const FileTypeIcon = await freshFileTypeIcon();
    render(<FileTypeIcon name="src" isFolder isOpen />);

    const icon = await screen.findByRole("presentation", { hidden: true });

    expect(icon.getAttribute("src")).toBe(await svgOf("folder-src-open"));
  });
});
