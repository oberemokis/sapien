import { useTranslation } from "react-i18next";
import { Button, SettingsGroup, SettingsRow, SettingsSection } from "@sapien/ui";
import { useClaudeStatus } from "../interactions/claude";
import { useIntegrations, useToggleIntegration } from "../interactions/integrations";
import type { Integration } from "@sapien/ipc";
import { agentName } from "../model/agents";

// Строка интеграции агента: что с ней сейчас и кнопка поставить или снять.
// Без агента на устройстве ставить её некуда.
function IntegrationRow({ integration }: { integration: Integration }) {
  const { t } = useTranslation("agents");
  const toggle = useToggleIntegration();
  const { agent, state } = integration;
  const on = state === "on";
  let description: string = t(`integrations.${state}`);

  // Codex не запускает новый хук, пока человек ему не доверился.
  if (on && agent === "codex") {
    description = `${description} ${t("integrations.codexTrust")}`;
  }

  if (toggle.isError) {
    description = t("integrations.failed");
  }

  return (
    <SettingsRow title={agentName(agent)} description={description}>
      {state !== "missing" && (
        <Button
          variant={on ? "danger" : "neutral"}
          disabled={toggle.isPending}
          onClick={() => toggle.mutate({ agent, on: !on })}
        >
          {on ? t("integrations.remove") : t("integrations.install")}
        </Button>
      )}
    </SettingsRow>
  );
}

// Раздел «Агент»: Claude Code на устройстве и интеграции агентов. Агент
// работает подпиской Claude через Claude Code, своих ключей у приложения нет.
export function AgentSettings() {
  const { t } = useTranslation("agents");
  const claude = useClaudeStatus();
  const integrations = useIntegrations();
  const status = claude.status;
  let description: string = t("claude.failed");

  if (status !== undefined) {
    description = t(`claude.${status.state}`);
  }

  if (status?.version != null) {
    description = `${description} ${t("claude.version", { version: status.version })}`;
  }

  if (claude.checking) {
    description = t("claude.checking");
  }

  return (
    <SettingsSection title={t("title")} description={t("description")}>
      <SettingsGroup title="Claude Code" description={t("claude.description")}>
        <SettingsRow title="Claude Code" description={description}>
          <Button disabled={claude.checking} onClick={() => void claude.check()}>
            {t("claude.check")}
          </Button>
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup
        title={t("integrations.title")}
        description={t("integrations.description")}
      >
        {integrations.isError && (
          <p role="alert" className="py-4 text-[13px]/5 text-state-fg-danger">
            {t("integrations.loadFailed")}
          </p>
        )}
        {integrations.data?.map((integration) => (
          <IntegrationRow key={integration.agent} integration={integration} />
        ))}
      </SettingsGroup>
    </SettingsSection>
  );
}
