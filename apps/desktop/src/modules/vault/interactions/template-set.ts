import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { readSeeded, writeSeeded } from "../infrastructure/templates.device";
import { vaultStatus, vaultWrite } from "../infrastructure/vault.api";
import { parseSeeded, seededKey, type TemplateSet } from "../model/templates";
import { templatesStore } from "../store/templates.store";
import { pickTemplate } from "./search";
import { createMissing, VAULT_KEY } from "./vault";

// Стандартные шаблоны набора ложатся в папку шаблонов один раз на хранилище
// этого устройства. Шаблон с тем же именем не перезаписывается, а удалённый
// человеком после этого сам не возвращается.
async function seedTemplates(set: TemplateSet) {
  const status = await vaultStatus();

  if (status.kind !== "ready") {
    return;
  }

  const key = seededKey(status.path, set.folder);
  const seeded = parseSeeded(readSeeded());

  if (seeded.includes(key)) {
    return;
  }

  const parts = `${templatesStore.get().folder}/${set.folder}`.split("/");

  for (const [index, name] of parts.entries()) {
    // oxlint-disable-next-line no-await-in-loop -- папка появляется раньше вложенной
    await createMissing(parts.slice(0, index).join("/"), name, "folder");
  }

  await Promise.all(
    set.templates.map(async (template) => {
      const path = await createMissing(parts.join("/"), template.name, "note");

      // Файл только что создан пустым, сверять его не с чем.
      if (path !== null) {
        await vaultWrite(path, template.text, null);
      }
    }),
  );

  writeSeeded([...seeded, key]);
}

// «Новый файл из шаблона» среди шаблонов одного набора, например задач.
// Набор кладётся в папку шаблонов при первом вызове. Не вышло, окно выбора
// всё равно открывается: в нём то, что уже лежит в папке, или подсказка,
// куда положить шаблон.
export function useNewFromTemplateSet(set: TemplateSet) {
  const queryClient = useQueryClient();

  return useCallback(
    async (parent: string) => {
      await seedTemplates(set).catch(() => undefined);
      await queryClient.invalidateQueries({ queryKey: VAULT_KEY });
      pickTemplate({ kind: "newFromTemplate", parent, within: set.folder });
    },
    [queryClient, set],
  );
}
