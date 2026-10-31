import { useQuery } from "@tanstack/react-query";
import { youtrackAssignees } from "../infrastructure/youtrack.api";

// Кого можно назначить в проекте по умолчанию. Состав команды за минуту
// не меняется, а без проекта спрашивать не о чем.
export function useAssignees(project: string) {
  return useQuery({
    queryKey: ["youtrack-assignees", project],
    queryFn: () => youtrackAssignees(project),
    enabled: project !== "",
    staleTime: 60_000,
    retry: false,
  });
}
