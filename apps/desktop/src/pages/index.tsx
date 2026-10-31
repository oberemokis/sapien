import BubbleChatIcon from "@hugeicons/core-free-icons/BubbleChatIcon";
import Note01Icon from "@hugeicons/core-free-icons/Note01Icon";
import type { IconSvgElement } from "@hugeicons/react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Icon } from "@/core/ui/icon";
import { showPanel, Workspace } from "@/modules/layout";
import { SettingsButton } from "@/modules/settings";
import { VaultGate, VaultTree } from "@/modules/vault";

export const Route = createFileRoute("/")({ component: Home });

// Пустые панели до дерева файлов, редактора и чата: строка серого текста
// под иконкой, как «Select a note» в MonoCode.
function Empty({ icon, text }: { icon: IconSvgElement; text: string }) {
  return (
    <div className="grid flex-1 place-items-center p-4">
      <div className="flex flex-col items-center gap-2 text-center text-content/50">
        <Icon icon={icon} size={20} />
        <p className="text-sm">{text}</p>
      </div>
    </div>
  );
}

// Поле имени нового файла живёт в дереве: спрятанное дерево показывается.
function showFiles() {
  showPanel("files");
}

function Home() {
  const { t } = useTranslation();

  return (
    <Workspace
      files={<VaultTree onCreateStart={showFiles} />}
      main={
        <VaultGate>
          <Empty icon={Note01Icon} text={t("editor.empty")} />
        </VaultGate>
      }
      chat={<Empty icon={BubbleChatIcon} text={t("chat.empty")} />}
      actions={<SettingsButton />}
    />
  );
}
