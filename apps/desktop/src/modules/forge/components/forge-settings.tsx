import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/ui/button";
import { FIELD, SettingsGroup, SettingsRow, SettingsSection } from "@/core/ui/settings";
import { useForgeConnect, useForgeDisconnect, useForgeStatus } from "../interactions/forge";
import { FORGE_NAMES, forgeProblemOf, type Forge, type ForgeProblem, type ForgeStatus } from "../model/forge";

// Подключение одного сервиса: токен, у GitLab ещё адрес. Поле токена
// пустеет сразу после отправки: токен ушёл в Rust, окну он больше не нужен.
function ForgeGroup({ forge, status }: { forge: Forge; status: ForgeStatus | undefined }) {
  const { t } = useTranslation();
  const connect = useForgeConnect();
  const disconnect = useForgeDisconnect();
  const [host, setHost] = useState("");
  const [token, setToken] = useState("");
  const [problem, setProblem] = useState<ForgeProblem | null>(null);
  const name = FORGE_NAMES[forge];
  const ready = token.trim() !== "" && !connect.isPending;

  function submit() {
    if (!ready) {
      return;
    }

    setProblem(null);
    setToken("");
    connect.mutate(
      { forge, host: host.trim() === "" ? null : host.trim(), token: token.trim() },
      { onSuccess: () => setHost(""), onError: (error) => setProblem(forgeProblemOf(error)) },
    );
  }

  let description: string = t(`forge.${forge}.hint`);

  if (status === undefined || connect.isPending) {
    description = t("forge.checking");
  } else if (status.kind === "connected") {
    description = t("forge.connected", { login: status.login, host: status.host });
  }

  if (problem !== null) {
    description = t(`forge.problems.${problem}`);
  }

  return (
    <SettingsGroup title={name} description={t(`forge.${forge}.description`)}>
      {/* Адрес своей строкой: в строке подключения два поля сжимали
          пояснение в узкий столбик. */}
      {forge === "gitlab" && status?.kind !== "connected" && (
        <SettingsRow title={t("forge.host")} description={t("forge.hostHint")}>
          <input
            aria-label={t("forge.host")}
            placeholder="gitlab.com"
            value={host}
            autoComplete="off"
            spellCheck={false}
            className={`${FIELD} w-56`}
            onChange={(event) => setHost(event.target.value)}
          />
        </SettingsRow>
      )}
      <SettingsRow title={t("forge.connection")} description={description}>
        {status?.kind === "connected" ? (
          <Button
            variant="danger"
            disabled={disconnect.isPending}
            onClick={() => {
              setProblem(null);
              disconnect.mutate(forge, { onError: () => setProblem("failed") });
            }}
          >
            {t("forge.disconnect")}
          </Button>
        ) : (
          <>
            <input
              type="password"
              aria-label={t("forge.token", { name })}
              placeholder={forge === "github" ? "ghp_…" : "glpat-…"}
              value={token}
              autoComplete="off"
              spellCheck={false}
              className={`${FIELD} w-56`}
              onChange={(event) => setToken(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  submit();
                }
              }}
            />
            <Button variant="submit" disabled={!ready} onClick={submit}>
              {t("forge.connect")}
            </Button>
          </>
        )}
      </SettingsRow>
    </SettingsGroup>
  );
}

// Раздел «Интеграции»: GitHub и GitLab по токену. Пока подключение
// и проверка, что токен рабочий: что агент с ними делает, решим позже.
export function ForgeSettings() {
  const { t } = useTranslation();
  const status = useForgeStatus();

  return (
    <SettingsSection title={t("forge.title")} description={t("forge.description")}>
      <ForgeGroup forge="github" status={status.data?.github} />
      <ForgeGroup forge="gitlab" status={status.data?.gitlab} />
    </SettingsSection>
  );
}
