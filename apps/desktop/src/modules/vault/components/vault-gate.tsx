import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/ui/button";
import { Icon } from "@/core/ui/icon";
import { useChooseVault, useVaultStatus } from "../interactions/vault";

function Prompt({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="grid flex-1 place-items-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <Icon icon={Folder01Icon} size={20} className="text-content/50" />
        <div className="flex flex-col gap-1">
          <h1 className="text-sm font-medium">{title}</h1>
          {description !== undefined && <p className="text-[13px] text-content/50">{description}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

// Середина окна, пока хранилище не открыто: первый запуск, пропавшая папка
// или ошибка. Открытое хранилище показывает то, что внутри.
export function VaultGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const status = useVaultStatus();
  const choose = useChooseVault();
  const chooseButton = (
    <Button disabled={choose.isPending} onClick={() => choose.mutate()}>
      {t("vault.choose")}
    </Button>
  );

  if (status.isError) {
    return (
      <Prompt title={t("vault.error")}>
        <Button onClick={() => void status.refetch()}>{t("vault.retry")}</Button>
      </Prompt>
    );
  }

  // Статус читается с локального диска мгновенно: пустое место на этот миг
  // не успевает мигнуть, и заглушка ему не нужна.
  if (status.data === undefined) {
    return null;
  }

  switch (status.data.kind) {
    case "none":
      return (
        <Prompt title={t("vault.none.title")} description={t("vault.none.description")}>
          {chooseButton}
        </Prompt>
      );
    case "missing":
      return (
        <Prompt
          title={t("vault.missing.title")}
          description={t("vault.missing.description", { path: status.data.path })}
        >
          {chooseButton}
        </Prompt>
      );
    case "ready":
      return children;
  }
}
