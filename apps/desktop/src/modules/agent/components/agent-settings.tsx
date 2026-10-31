import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/ui/button";
import { Segmented } from "@/core/ui/segmented";
import { SettingsGroup, SettingsRow, SettingsSection } from "@/core/ui/settings";
import { setAgentMethod, useAgentMethod, useClaudeStatus } from "../interactions/method";
import { setAgentModel, useAgentModel } from "../interactions/model";
import { useModelKey } from "../interactions/model-key";
import { AGENT_MODELS, MODEL_NAMES } from "../model/chat";
import type { AgentMethod } from "../model/method";

// Подписка Claude через Claude Code: способ, версия и вход. Где Claude Code
// не поддержан, раздела нет, и агент идёт ключом.
function ClaudeCodeGroup() {
  const { t } = useTranslation();
  const method = useAgentMethod();
  const claude = useClaudeStatus();
  const status = claude.status;
  const methods: { value: AgentMethod; label: string }[] = [
    { value: "subscription", label: t("agent.settings.subscription") },
    { value: "key", label: t("agent.settings.keyMethod") },
  ];

  if (status?.state === "unsupported" || (status === undefined && !claude.failed)) {
    return null;
  }

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
    <SettingsGroup title="Claude Code" description={t("agent.settings.claude.description")}>
      <SettingsRow title={t("agent.settings.method")} description={t("agent.settings.methodHint")}>
        <Segmented label={t("agent.settings.method")} value={method} options={methods} onChange={setAgentMethod} />
      </SettingsRow>
      <SettingsRow title="Claude Code" description={description}>
        <Button disabled={claude.checking} onClick={() => claude.check()}>
          {t("agent.settings.claude.check")}
        </Button>
      </SettingsRow>
    </SettingsGroup>
  );
}

// Раздел «Агент»: способ, ключ API и модель. Ключ после сохранения
// виден только последними знаками, его можно заменить или стереть,
// но не прочитать.
export function AgentSettings() {
  const { t } = useTranslation();
  const model = useAgentModel();
  const key = useModelKey();
  const [draft, setDraft] = useState("");
  const [failed, setFailed] = useState(false);
  const status = key.status;

  function save() {
    if (draft.trim() === "") {
      return;
    }

    // Поле пустеет сразу: ключ ушёл в Rust, и в окне ему делать нечего.
    setDraft("");
    setFailed(false);
    key.save(draft).catch(() => setFailed(true));
  }

  function remove() {
    setFailed(false);
    key.remove().catch(() => setFailed(true));
  }

  let description: string = t("agent.settings.keyHint");

  if (status?.ending != null) {
    description = t("agent.settings.keySet", { ending: status.ending });
  }

  if (status?.kept === false) {
    description = `${description} ${t("agent.settings.notKept")}`;
  }

  if (failed) {
    description = t("agent.settings.keyFailed");
  }

  return (
    <SettingsSection title={t("agent.settings.title")} description={t("agent.settings.description")}>
      <ClaudeCodeGroup />
      <SettingsGroup title="Anthropic" description={t("agent.settings.anthropic")}>
        <SettingsRow title={t("agent.settings.key")} description={description}>
          <div className="flex gap-2">
            <input
              type="password"
              aria-label={t("agent.settings.key")}
              placeholder={status?.ending == null ? "sk-ant-…" : t("agent.settings.newKey")}
              value={draft}
              autoComplete="off"
              spellCheck={false}
              className="h-8 w-56 rounded-md border border-stroke bg-transparent px-2 text-[13px] outline-none focus:border-accent"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  save();
                }
              }}
            />
            <Button disabled={draft.trim() === ""} onClick={save}>
              {t("agent.settings.save")}
            </Button>
            {status?.ending != null && <Button onClick={remove}>{t("agent.settings.delete")}</Button>}
          </div>
        </SettingsRow>
        <SettingsRow title={t("agent.settings.model")} description={t("agent.settings.modelHint")}>
          <Segmented
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
