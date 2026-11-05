import { useTranslation } from "react-i18next";
import { Button, SettingsGroup, SettingsRow, SettingsSection } from "@sapien/ui";
import { useClaudeStatus } from "../interactions/claude";
import { useIntegrations, useToggleIntegration } from "../interactions/integrations";
import type { Integration } from "@sapien/ipc";
import { agentName } from "../model/sessions";

// Строка интеграции агента: что с ней сейчас и кнопка поставить или снять.
// Без агента на устройстве ставить её некуда.
function IntegrationRow({ integration }: { integration: Integration }) {
  const { t } = useTranslation();
  const toggle = useToggleIntegration();
  const { agent, state } = integration;
  const on = state === "on";
  let description: string = t(`agent.settings.integrations.${state}`);

  // Codex не запускает новый хук, пока человек ему не доверился.
  if (on && agent === "codex") {
    description = `${description} ${t("agent.settings.integrations.codexTrust")}`;
  }

  if (toggle.isError) {
    description = t("agent.settings.integrations.failed");
  }

  return (
    <SettingsRow title={agentName(agent)} description={description}>
      {state !== "missing" && (
        <Button
          variant={on ? "danger" : "neutral"}
          disabled={toggle.isPending}
          onClick={() => toggle.mutate({ agent, on: !on })}
        >
          {on ? t("agent.settings.integrations.remove") : t("agent.settings.integrations.install")}
        </Button>
      )}
    </SettingsRow>
  );
}

// Раздел «Агент»: Claude Code на устройстве и интеграции агентов. Агент
// работает подпиской Claude через Claude Code, своих ключей у приложения нет.
export function AgentSettings() {
  const { t } = useTranslation();
  const claude = useClaudeStatus();
  const integrations = useIntegrations();
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
          <Button disabled={claude.checking} onClick={() => void claude.check()}>
            {t("agent.settings.claude.check")}
          </Button>
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup
        title={t("agent.settings.integrations.title")}
        description={t("agent.settings.integrations.description")}
      >
        {integrations.isError && (
          <p role="alert" className="py-4 text-[13px]/5 text-state-fg-danger">
            {t("agent.settings.integrations.loadFailed")}
          </p>
        )}
        {integrations.data?.map((integration) => (
          <IntegrationRow key={integration.agent} integration={integration} />
        ))}
      </SettingsGroup>
    </SettingsSection>
  );
}
