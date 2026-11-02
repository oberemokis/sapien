import { describe, expect, it } from "vitest";
import { agoOf, homeProject, searchSessions, sessionsOf, type Project, type SessionInfo } from "./sessions";

const project = (id: string, name: string): Project => ({ id, name, path: `/Users/me/${name}`, missing: false });

const session = (id: string, projectId: string, title: string, updated: number): SessionInfo => ({
  id,
  project: projectId,
  title,
  updated,
});

const PROJECTS = [project("p1", "sapien"), project("p2", "сайт")];

// У sapien пропала папка.
const MISSING_FIRST = [{ ...project("p1", "sapien"), missing: true }, project("p2", "сайт")];

const SESSIONS = [
  session("s1", "p1", "Рефакторинг парсера", 3000),
  session("s2", "p1", "Тесты окна", 5000),
  session("s3", "p2", "Лендинг", 4000),
  session("s4", "p2", "", 1000),
];

describe("сессии проекта", () => {
  it.each([
    ["p1", ["s2", "s1"]],
    ["p2", ["s3", "s4"]],
    ["p3", []],
  ])("проект %s: свои сессии, свежие сверху", (projectId, ids) => {
    expect(sessionsOf(SESSIONS, projectId).map((found) => found.id)).toEqual(ids);
  });
});

describe("проект для новой сессии", () => {
  it.each([
    ["открытой сессии, даже если есть свежее", PROJECTS, SESSIONS, "s3", "p2"],
    ["последней сессии, когда открытой нет", PROJECTS, SESSIONS, null, "p1"],
    ["последней сессии, когда открытой больше нет", PROJECTS, SESSIONS, "удалена", "p1"],
    ["первый в списке, когда сессий нет", PROJECTS, [], null, "p1"],
    ["никакой, когда проектов нет", [], [], null, null],
    ["без папки не годится: открытая сессия в нём уступает последней годной", MISSING_FIRST, SESSIONS, "s2", "p2"],
    ["без папки не годится: первым берётся проект с папкой", MISSING_FIRST, [], null, "p2"],
    ["никакой, когда ни у одного проекта нет папки", [{ ...PROJECTS[0], missing: true }], SESSIONS, null, null],
  ])("%s", (_case, projects, sessions, selected, home) => {
    expect(homeProject(projects, sessions, selected)).toBe(home);
  });
});

describe("поиск сессии", () => {
  it.each([
    ["", ["s2", "s3", "s1", "s4"]],
    ["парсер", ["s1"]],
    ["САЙТ", ["s3", "s4"]],
    ["sapien тест", ["s2"]],
    ["  окна   sapien ", ["s2"]],
    ["лендинг sapien", []],
    ["погода", []],
  ])("«%s»", (query, ids) => {
    expect(searchSessions(SESSIONS, PROJECTS, query).map((found) => found.id)).toEqual(ids);
  });

  it("найденная сессия несёт имя проекта, сессия убранного проекта без него", () => {
    const [found] = searchSessions([session("s9", "p9", "Старое", 1)], PROJECTS, "");

    expect(searchSessions(SESSIONS, PROJECTS, "лендинг")[0]?.projectName).toBe("сайт");
    expect(found?.projectName).toBe("");
  });

  it("без запроса отдаёт не больше limit последних", () => {
    expect(searchSessions(SESSIONS, PROJECTS, "", 2).map((found) => found.id)).toEqual(["s2", "s3"]);
  });
});

describe("давность сессии одной крупной единицей", () => {
  const MINUTE = 60_000;

  it.each([
    [10_000, { unit: "minutes", count: 1 }],
    [59 * MINUTE, { unit: "minutes", count: 59 }],
    [60 * MINUTE, { unit: "hours", count: 1 }],
    [(24 * 60 - 1) * MINUTE, { unit: "hours", count: 23 }],
    [2 * 24 * 60 * MINUTE + 5 * MINUTE, { unit: "days", count: 2 }],
    [7 * 24 * 60 * MINUTE, { unit: "weeks", count: 1 }],
  ])("прошло %i мс", (passed, ago) => {
    expect(agoOf(1_000_000_000, 1_000_000_000 + passed)).toEqual(ago);
  });
});
