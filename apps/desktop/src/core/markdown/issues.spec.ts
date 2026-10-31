import { GFM, parser } from "@lezer/markdown";
import { describe, expect, it } from "vitest";
import { IssueIds, issueIds, projectOf } from "./issues";
import { Frontmatter, Hashtags } from "./tags";

const issueParser = parser.configure([GFM, Hashtags, Frontmatter, IssueIds]);

function parsed(text: string) {
  const found: string[] = [];

  issueParser.parse(text).iterate({
    enter(node) {
      if (node.name === "IssueId") {
        found.push(text.slice(node.from, node.to));
      }
    },
  });

  return found;
}

describe("номера задач в тексте", () => {
  it.each([
    ["SAP-12 в начале строки", ["SAP-12"]],
    ["сделать SAP-12 и web_2-7, потом SAP-3.", ["SAP-12", "web_2-7", "SAP-3"]],
    ["- [ ] (SAP-12) **SAP-13**", ["SAP-12", "SAP-13"]],
    ["[задача SAP-12](https://yt.example/issue/SAP-12)", ["SAP-12"]],
  ])("%s", (text, ids) => {
    expect(parsed(text)).toEqual(ids);
    expect(issueIds(text)).toEqual(ids);
  });

  it.each([
    ["блок кода", "```\nSAP-12\n```"],
    ["код с отступом", "    SAP-12"],
    ["код в строке", "ветка `SAP-12`"],
    ["голый адрес", "https://yt.example/issue/SAP-12"],
    ["шапка", "---\nyoutrack: SAP-12\n---\nтекст"],
    ["часть слова", "xSAP-12z и ЯSAP-1 и SAP-12a"],
    ["без номера", "SAP- и SAP-x"],
  ])("не номер: %s", (_case, text) => {
    expect(parsed(text)).toEqual([]);
  });

  it("повторы в списке номеров один раз", () => {
    expect(issueIds("SAP-1, SAP-2 и снова SAP-1")).toEqual(["SAP-1", "SAP-2"]);
  });

  it("проект номера всё до последнего дефиса", () => {
    expect(projectOf("SAP-12")).toBe("SAP");
    expect(projectOf("web_2-7")).toBe("web_2");
  });
});
