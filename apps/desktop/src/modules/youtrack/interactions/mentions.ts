import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { openLink } from "@/core/links/open-link";
import { issueIds, projectOf } from "@/core/markdown/issues";
import { useOnline } from "@/core/network/online";
import { knownIssue, knownProjects, rememberProjects } from "../infrastructure/issues.device";
import { youtrackProjectIssues, youtrackProjects } from "../infrastructure/youtrack.api";
import { type IssueState, youtrackProblemOf } from "../model/youtrack";
import { useYoutrack } from "./connection";
import { fetchIssue, ISSUE_KEY } from "./draft";

// Что плашка номера показывает о задаче, как IssueMention в редакторе.
type Mention = { label: string; muted: boolean; title: string; details: string[] };

type Answer = { data: IssueState | undefined; error: unknown };

const PROJECTS_KEY = ["youtrack-projects"] as const;

async function fetchProjects() {
  const projects = await youtrackProjects();

  rememberProjects(projects);

  return projects;
}

// Из ответов запросов нужны только данные и отказ. Функция одна на всё
// окно: так набор ответов меняется, только когда меняется ответ.
function answers(results: Answer[]) {
  return results.map(({ data, error }) => ({ data, error }));
}

function stateOf(t: TFunction, state: IssueState) {
  if (state.state !== null) {
    return state.state;
  }

  if (state.resolved) {
    return t("youtrack.mention.resolved");
  }

  return t("youtrack.mention.open");
}

function detailsOf(t: TFunction, language: string, state: IssueState) {
  const details: string[] = [t("youtrack.mention.state", { state: stateOf(t, state) })];

  if (state.assignee === null) {
    details.push(t("youtrack.mention.noAssignee"));
  } else {
    details.push(t("youtrack.mention.assignee", { name: state.assignee }));
  }

  if (state.due !== null) {
    details.push(t("youtrack.mention.due", { date: new Intl.DateTimeFormat(language, { dateStyle: "long" }).format(state.due) }));
  }

  return [...details, ...state.links.map(({ kind, ids }) => t("youtrack.mention.link", { kind, ids: ids.join(", ") }))];
}

// Плашка по ответу YouTrack. Ответа ещё нет: null, номер ждёт. YouTrack
// не отвечает: последний известный статус серым с пометкой.
function mentionOf(t: TFunction, language: string, id: string, { data, error }: Answer, away: boolean): Mention | null {
  let problem = null;

  if (error !== null) {
    problem = youtrackProblemOf(error);
  }

  if (problem === "youtrack_missing") {
    return { label: t("youtrack.mention.missing"), muted: true, title: id, details: [t("youtrack.problems.youtrack_missing")] };
  }

  if (data === undefined && problem !== null) {
    return { label: t("youtrack.mention.unknown"), muted: true, title: id, details: [t(`youtrack.problems.${problem}`)] };
  }

  if (data === undefined && away) {
    return { label: t("youtrack.mention.unknown"), muted: true, title: id, details: [t("youtrack.mention.offline")] };
  }

  if (data === undefined) {
    return null;
  }

  const title = `${id} ${data.summary}`;
  const details = detailsOf(t, language, data);

  if (problem !== null || away) {
    const state = stateOf(t, data);

    return { label: t("youtrack.mention.stale", { state }), muted: true, title, details: [...details, t("youtrack.mention.staleHint")] };
  }

  return { label: stateOf(t, data), muted: false, title, details };
}

// Задачи для номеров вида SAP-12 в тексте заметки. Префиксы это короткие
// имена проектов YouTrack, статус каждой задачи переспрашивается раз
// в минуту. Последний ответ помнится на устройстве, и без сети плашка
// показывает его. YouTrack не подключён: null, номера остаются текстом.
export function useIssueMentions(text: string) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const online = useOnline();
  const { status } = useYoutrack();
  const enabled = online && status?.kind === "connected";
  // Сеть пропала или сервер не отвечает: новых ответов не будет.
  const away = !online || status?.kind === "broken";
  const projects = useQuery({
    queryKey: PROJECTS_KEY,
    queryFn: fetchProjects,
    enabled,
    // Проекты заводят редко.
    staleTime: 10 * 60_000,
    retry: false,
    initialData: knownProjects,
    initialDataUpdatedAt: 0,
  });
  const prefixes = useMemo(() => new Set(projects.data), [projects.data]);
  // Номера живут строкой: набор текста не меняет список, пока номера те же.
  const key = issueIds(text)
    .filter((id) => prefixes.has(projectOf(id)))
    .join(" ");
  const ids = useMemo(() => key.split(" ").filter((id) => id !== ""), [key]);
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: [...ISSUE_KEY, id],
      queryFn: () => fetchIssue(id),
      enabled,
      staleTime: 60_000,
      refetchInterval: 60_000,
      retry: false,
      initialData: () => knownIssue(id),
      initialDataUpdatedAt: 0,
    })),
    combine: answers,
  });

  const mentions = useMemo(() => {
    const found = new Map<string, Mention>();

    for (const [index, id] of ids.entries()) {
      const mention = mentionOf(t, i18n.language, id, results[index] ?? { data: undefined, error: null }, away);

      if (mention !== null) {
        found.set(id, mention);
      }
    }

    return found;
  }, [ids, results, away, t, i18n.language]);

  // Подсказка после «SAP-»: последние задачи проекта. Без ответа подсказки нет.
  const suggest = useCallback(
    async (project: string) => {
      try {
        return await queryClient.fetchQuery({
          queryKey: ["youtrack-project-issues", project],
          queryFn: () => youtrackProjectIssues(project),
          staleTime: 60_000,
          retry: false,
        });
      } catch {
        return [];
      }
    },
    [queryClient],
  );

  // Задача открывается в YouTrack по адресу из ответа о ней.
  const onOpen = useCallback(
    (id: string) => {
      const url = queryClient.getQueryData<IssueState>([...ISSUE_KEY, id])?.url;

      if (url !== undefined) {
        openLink(url);
      }
    },
    [queryClient],
  );

  return useMemo(() => {
    if (status?.kind === "none") {
      return null;
    }

    return { prefixes, mentions, suggest, onOpen };
  }, [status?.kind, prefixes, mentions, suggest, onOpen]);
}
