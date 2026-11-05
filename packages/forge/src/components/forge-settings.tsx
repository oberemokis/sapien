import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Forge, ForgeStatus } from "@sapien/ipc";
import { Button, FIELD, SettingsGroup, SettingsRow, SettingsSection } from "@sapien/ui";
import { useForgeConnect, useForgeDisconnect, useForgeStatus } from "../interactions/forge";
import { FORGE_NAMES, forgeProblemOf, type ForgeProblem } from "../model/forge";

// Подключение одного сервиса: токен, у GitLab ещё адрес. Поле токена
// пустеет сразу после отправки: токен ушёл в Rust, окну он больше не нужен.
function ForgeGroup({ forge, status }: { forge: Forge; status: ForgeStatus | undefined }) {
  const { t } = useTranslation("forge");
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

  let description: string = t(`${forge}.hint`);

  if (status === undefined || connect.isPending) {
    description = t("checking");
  } else if (status.kind === "connected") {
    description = t("connected", { login: status.login, host: status.host });
  }

  if (problem !== null) {
    description = t(`problems.${problem}`);
  }

  return (
    <SettingsGroup title={name} description={t(`${forge}.description`)}>
      {/* Адрес своей строкой: в строке подключения два поля сжимали
          пояснение в узкий столбик. */}
      {forge === "gitlab" && status?.kind !== "connected" && (
        <SettingsRow title={t("host")} description={t("hostHint")}>
          <input
            aria-label={t("host")}
            placeholder="gitlab.com"
            value={host}
            autoComplete="off"
            spellCheck={false}
            className={`${FIELD} w-56`}
            onChange={(event) => setHost(event.target.value)}
          />
        </SettingsRow>
      )}
      <SettingsRow title={t("connection")} description={description}>
        {status?.kind === "connected" ? (
          <Button
            variant="danger"
            disabled={disconnect.isPending}
            onClick={() => {
              setProblem(null);
              disconnect.mutate(forge, { onError: () => setProblem("failed") });
            }}
          >
            {t("disconnect")}
          </Button>
        ) : (
          <>
            <input
              type="password"
              aria-label={t("token", { name })}
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
              {t("connect")}
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
  const { t } = useTranslation("forge");
  const status = useForgeStatus();

  return (
    <SettingsSection title={t("title")} description={t("description")}>
      <ForgeGroup forge="github" status={status.data?.github} />
      <ForgeGroup forge="gitlab" status={status.data?.gitlab} />
    </SettingsSection>
  );
}
