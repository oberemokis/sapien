import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { actionsCreate, actionsDelete, actionsList, actionsWrite } from "../infrastructure/agent.api";

const ACTIONS_KEY = ["agent", "actions"] as const;

export function useActionFiles() {
  return useQuery({ queryKey: ACTIONS_KEY, queryFn: actionsList });
}

function useInvalidateActions() {
  const queryClient = useQueryClient();

  return () => queryClient.invalidateQueries({ queryKey: ACTIONS_KEY });
}

export function useCreateAction() {
  const invalidate = useInvalidateActions();

  return useMutation({
    mutationFn: ({ name, text }: { name: string; text: string }) => actionsCreate(name, text),
    onSettled: invalidate,
  });
}

export function useWriteAction() {
  const invalidate = useInvalidateActions();

  return useMutation({
    mutationFn: ({ path, text }: { path: string; text: string }) => actionsWrite(path, text),
    onSettled: invalidate,
  });
}

export function useDeleteAction() {
  const invalidate = useInvalidateActions();

  return useMutation({ mutationFn: actionsDelete, onSettled: invalidate });
}
