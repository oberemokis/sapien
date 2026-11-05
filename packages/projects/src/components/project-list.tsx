import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Project } from "@sapien/ipc";
import { IconButton } from "@sapien/ui";
import { useAddProject, useProjects } from "../interactions/projects";

// Заголовок проектов в левой панели и кнопка добавления. onAdded говорит,
// что начать в добавленном проекте: добавление ждёт его.
export function ProjectsHeader({ onAdded }: { onAdded: (project: Project) => Promise<unknown> }) {
  const { t } = useTranslation("projects");
  const add = useAddProject(onAdded);

  return (
    <>
      <div className="mt-3 flex h-9 shrink-0 items-center gap-1 pr-1.5 pl-3">
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-text-muted">{t("title")}</span>
        <IconButton icon="folder-add-left" label={t("add")} onClick={() => add.mutate()} />
      </div>
      {add.isError && (
        <p role="alert" className="px-3 pb-1 text-[12px]/[18px] text-state-fg-danger">
          {t("addFailed")}
        </p>
      )}
    </>
  );
}

// Проекты по порядку, под каждым то, что даст children: у окна это его
// сессии. Пустой список говорит, с чего начать.
export function ProjectList({ children }: { children: (project: Project) => ReactNode }) {
  const { t } = useTranslation("projects");
  const projects = useProjects();

  return (
    <>
      {projects.data?.length === 0 && <p className="p-2 text-[13px]/5 text-text-muted">{t("empty")}</p>}
      <ul className="flex flex-col gap-3">{projects.data?.map((project) => children(project))}</ul>
    </>
  );
}
