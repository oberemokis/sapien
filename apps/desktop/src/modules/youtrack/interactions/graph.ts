import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { useOnline } from "@/core/network/online";
import { knownGraph, rememberGraph } from "../infrastructure/graph.device";
import { youtrackGraph } from "../infrastructure/youtrack.api";
import { youtrackProblemOf } from "../model/youtrack";
import { graphStore } from "../store/graph.store";
import { useYoutrack } from "./connection";

const GRAPH_KEY = ["youtrack-graph"] as const;

export function openTaskGraph(path: string) {
  graphStore.setState(() => path);
}

export function closeTaskGraph() {
  graphStore.setState(() => null);
}

export function useTaskGraphPath() {
  return useSelector(graphStore);
}

// Граф связей от задач roots. Связи меняют в YouTrack другие люди, поэтому
// открытое окно переспрашивает раз в минуту и при фокусе. Последний ответ
// помнится на устройстве: без связи граф строится по нему с пометкой.
export function useTaskGraph(roots: string[], depth: number) {
  const online = useOnline();
  const { status } = useYoutrack();
  const key = `${roots.join(",")}:${depth}`;
  const graph = useQuery({
    queryKey: [...GRAPH_KEY, roots, depth],
    queryFn: async () => {
      const found = await youtrackGraph(roots, depth);

      rememberGraph(key, found);

      return found;
    },
    enabled: online && status?.kind === "connected" && roots.length > 0,
    initialData: () => knownGraph(key),
    initialDataUpdatedAt: 0,
    // Другая глубина держит прежний граф, пока не придёт новый.
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
    refetchOnWindowFocus: "always",
    retry: false,
  });
  let problem = null;

  if (status?.kind === "broken") {
    problem = youtrackProblemOf(status.code);
  } else if (graph.error !== null) {
    problem = youtrackProblemOf(graph.error);
  }

  return {
    graph: graph.data,
    // Подключение ещё проверяется или граф идёт: о связях рано судить.
    loading: (status === undefined || graph.isFetching) && graph.data === undefined,
    // Ответа сейчас не будет: граф, если он есть, мог устареть.
    away: !online || problem !== null || status?.kind === "none",
    problem,
  };
}
