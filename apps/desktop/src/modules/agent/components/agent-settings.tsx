import { useTranslation } from "react-i18next";
import { Button } from "@/core/ui/button";
import { SettingsGroup, SettingsRow, SettingsSection } from "@/core/ui/settings";
import { useProviders } from "../interactions/agents";
import { useClaudeStatus } from "../interactions/claude";

// Раздел «Агент»: Claude Code на устройстве. Агент работает подпиской
// Claude через Claude Code, своих ключей у приложения нет. Модель
// и размышление выбираются под полем ввода, у каждой сессии свои.
export function AgentSettings() {
  const { t } = useTranslation();
  const claude = useClaudeStatus();
  const providers = useProviders();
  const status = claude.status;
  let description: string = t("agent.settings.claude.failed");

  if (status !== undefined) {
    description = t(`agent.settings.claude.${status.state}`);
  }

  if (status?.version != null) {
    description = `${description} ${t("agent.settings.claude.version", { version: status.version })}`;
  }

  if (claude.checking) {
    description = t("agent.settings.claude.checking");
  }

  // Проверка заодно перечитывает агентов и их модели: после установки или
  // входа они появятся под полем ввода без перезапуска.
  function check() {
    void claude.check();
    void providers.refetch();
  }

  return (
    <SettingsSection title={t("agent.settings.title")} description={t("agent.settings.description")}>
      <SettingsGroup title="Claude Code" description={t("agent.settings.claude.description")}>
        <SettingsRow title="Claude Code" description={description}>
          <Button disabled={claude.checking} onClick={check}>
            {t("agent.settings.claude.check")}
          </Button>
        </SettingsRow>
      </SettingsGroup>
    </SettingsSection>
  );
}
