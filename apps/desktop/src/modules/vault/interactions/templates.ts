import { useSelector } from "@tanstack/react-store";
import { readTemplateSettings, writeTemplateSettings } from "../infrastructure/templates.device";
import { vaultRead } from "../infrastructure/vault.api";
import { fillTemplate, parseTemplateSettings, type TemplateSettings } from "../model/templates";
import { templatesStore } from "../store/templates.store";

export function useTemplateSettings() {
  return useSelector(templatesStore);
}

export function restoreTemplateSettings() {
  templatesStore.setState(() => parseTemplateSettings(readTemplateSettings()));
}

// Пустое и испорченное заменяется умолчанием, папка записывается без «/»
// по краям.
export function changeTemplateSettings(change: Partial<TemplateSettings>) {
  templatesStore.setState((state) => parseTemplateSettings({ ...state, ...change }));
  writeTemplateSettings(templatesStore.get());
}

// Текст шаблона с подстановками на эту минуту: {{title}} это имя заметки,
// куда он пойдёт.
export async function readTemplate(path: string, title: string) {
  return fillTemplate(await vaultRead(path), title, new Date(), templatesStore.get());
}
