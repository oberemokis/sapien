import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { youtrackCheck, youtrackIssueState, youtrackPublish, youtrackSimilar } from "../infrastructure/youtrack.api";
import type { DraftRequest } from "../model/draft";

const ISSUE_KEY = ["youtrack-issue"] as const;

// Статус и исполнитель задачи для плашки. Их меняют в YouTrack другие люди,
// поэтому ответ живёт минуту, а без сети не спрашивается.
export function useIssueState(id: string | null, online: boolean) {
  return useQuery({
    queryKey: [...ISSUE_KEY, id],
    queryFn: () => youtrackIssueState(id ?? ""),
    enabled: id !== null && online,
    staleTime: 60_000,
    retry: false,
  });
}

type Publish = { path: string; text: string; draft: DraftRequest; id: string | null; force: boolean };

// Публикация и обновление черновика. После неё плашка спрашивает статус
// заново.
export function usePublish() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ path, text, draft, id, force }: Publish) => youtrackPublish(path, text, draft, id, force),
    onSuccess: async (published) => {
      if (published.kind === "done") {
        await queryClient.invalidateQueries({ queryKey: [...ISSUE_KEY, published.id] });
      }
    },
  });
}

// Проверка черновика у YouTrack. Ответ держит форма: он про текст на момент
// проверки, а не общий для окна.
export function useCheck() {
  return useMutation({ mutationFn: youtrackCheck });
}

type SimilarTo = { project: string; summary: string };

// Поиск кандидатов в дубли, по кнопке.
export function useSimilar() {
  return useMutation({ mutationFn: ({ project, summary }: SimilarTo) => youtrackSimilar(project, summary) });
}
