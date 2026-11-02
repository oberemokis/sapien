import { useTranslation } from "react-i18next";
import { Button } from "@/core/ui/button";
import { SettingsGroup, SettingsRow, SettingsSection, SettingsSelect } from "@/core/ui/settings";
import { useClaudeStatus } from "../interactions/claude";
import { setAgentModel, useAgentModel } from "../interactions/model";
import { AGENT_MODELS, MODEL_NAMES } from "../model/chat";

// Раздел «Агент»: Claude Code на устройстве и модель. Агент работает
// подпиской Claude через Claude Code, своих ключей у приложения нет.
export function AgentSettings() {
  const { t } = useTranslation();
  const model = useAgentModel();
  const claude = useClaudeStatus();
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

  return (
    <SettingsSection title={t("agent.settings.title")} description={t("agent.settings.description")}>
      <SettingsGroup title="Claude Code" description={t("agent.settings.claude.description")}>
        <SettingsRow title="Claude Code" description={description}>
          <Button disabled={claude.checking} onClick={() => claude.check()}>
            {t("agent.settings.claude.check")}
          </Button>
        </SettingsRow>
        <SettingsRow title={t("agent.settings.model")} description={t("agent.settings.modelHint")}>
          <SettingsSelect
            label={t("agent.settings.model")}
            value={model}
            options={AGENT_MODELS.map((value) => ({ value, label: MODEL_NAMES[value] }))}
            onChange={setAgentModel}
          />
        </SettingsRow>
      </SettingsGroup>
    </SettingsSection>
  );
}
