import { useSelector } from "@tanstack/react-store";
import { readDefaultProject, writeDefaultProject } from "../infrastructure/project.device";
import { projectStore } from "../store/project.store";

export function useDefaultProject() {
  return useSelector(projectStore);
}

export function restoreDefaultProject() {
  projectStore.setState(() => readDefaultProject().trim());
}

export function changeDefaultProject(project: string) {
  projectStore.setState(() => project.trim());
  writeDefaultProject(projectStore.get());
}
