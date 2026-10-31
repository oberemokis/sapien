import { describe, expect, it } from "vitest";
import {
  frontmatterMap,
  frontmatterValue,
  splitFrontmatter,
  withFrontmatterMap,
  withFrontmatterValue,
} from "./frontmatter";

const NOTE = "---\nproject: SAP\ndepends_on:\n  - SAP-1\n  - SAP-2\nfields:\n  Severity: High\n---\n# Вход\n";

describe("запись в шапку", () => {
  it("значение меняется на месте вместе со строками списка под ним", () => {
    const text = withFrontmatterValue(NOTE, "depends_on", "SAP-3");

    expect(text).toBe("---\nproject: SAP\ndepends_on: SAP-3\nfields:\n  Severity: High\n---\n# Вход\n");
  });

  it("новый ключ дописывается в конец шапки, пустой уходит", () => {
    const added = withFrontmatterValue(NOTE, "sprint", "Sprint 5");

    expect(frontmatterValue(splitFrontmatter(added).yaml, "sprint")).toBe("Sprint 5");
    expect(withFrontmatterValue(added, "sprint", " ")).toBe(NOTE);
  });

  it("у заметки без шапки она появляется", () => {
    expect(withFrontmatterValue("# Вход\n", "project", "SAP")).toBe("---\nproject: SAP\n---\n# Вход\n");
  });

  it("значение, которое YAML прочёл бы иначе, берётся в кавычки и читается обратно", () => {
    const text = withFrontmatterValue(NOTE, "assignee", "#ilya");

    expect(text).toContain('assignee: "#ilya"');
    expect(frontmatterValue(splitFrontmatter(text).yaml, "assignee")).toBe("#ilya");
  });

  it("карта читается парами и пишется целиком", () => {
    expect(frontmatterMap(splitFrontmatter(NOTE).yaml, "fields")).toEqual([{ name: "Severity", value: "High" }]);

    const text = withFrontmatterMap(NOTE, "fields", [
      { name: "Severity", value: "Low" },
      { name: "Fix versions", value: "2.0" },
      { name: " ", value: "без имени" },
    ]);

    expect(frontmatterMap(splitFrontmatter(text).yaml, "fields")).toEqual([
      { name: "Severity", value: "Low" },
      { name: "Fix versions", value: "2.0" },
    ]);
    expect(withFrontmatterMap(text, "fields", [])).not.toContain("fields");
  });
});
