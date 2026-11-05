import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { commands, type Project } from "@sapien/ipc";

const PROJECTS_KEY = ["projects"] as const;

export function useProjects() {
  return useQuery({ queryKey: PROJECTS_KEY, queryFn: commands.projectsList });
}

// Папку выбирают в системном диалоге, закрытый диалог даёт null. Что
// делать с добавленным проектом, решает тот, кто добавляет: окно сразу
// начинает в нём сессию, и добавление ждёт её.
export function useAddProject(onAdded?: (project: Project) => Promise<unknown>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: commands.projectsAdd,
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: PROJECTS_KEY });

      if (project !== null) {
        await onAdded?.(project);
      }
    },
  });
}

// Проект уходит из списка вместе со своими сессиями. Их список перечитывает
// тот, кто их показывает: onSettled.
export function useRemoveProject(onSettled?: () => Promise<unknown>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: commands.projectsRemove,
    onSettled: () => Promise.all([queryClient.invalidateQueries({ queryKey: PROJECTS_KEY }), onSettled?.()]),
  });
}
