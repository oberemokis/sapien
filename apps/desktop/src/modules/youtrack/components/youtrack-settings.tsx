import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/ui/button";
import { SettingsGroup, SettingsRow, SettingsSection } from "@/core/ui/settings";
import { useYoutrack } from "../interactions/connection";
import { youtrackProblemOf, type YoutrackProblem } from "../model/youtrack";

const FIELD =
  "h-8 w-56 rounded-md border border-stroke bg-transparent px-2 text-[13px] outline-none focus:border-accent";

// Раздел «Интеграции»: подключение к своему YouTrack по адресу и токену.
// Токен после подключения не виден вовсе, его можно только стереть.
export function YoutrackSettings() {
  const { t } = useTranslation();
  const youtrack = useYoutrack();
  const status = youtrack.status;
  const [host, setHost] = useState("");
  const [token, setToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [problem, setProblem] = useState<YoutrackProblem | null>(null);
  const ready = host.trim() !== "" && token.trim() !== "" && !connecting;

  function connect() {
    if (!ready) {
      return;
    }

    // Поле токена пустеет сразу: токен ушёл в Rust, и в окне ему делать нечего.
    setToken("");
    setProblem(null);
    setConnecting(true);
    youtrack
      .connect(host, token)
      .then(() => setHost(""))
      .catch((error: unknown) => setProblem(youtrackProblemOf(error)))
      .finally(() => setConnecting(false));
  }

  function disconnect() {
    setProblem(null);
    youtrack.disconnect().catch(() => setProblem("failed"));
  }

  // Отказ последнего действия важнее обычной подсказки строки.
  function hint(usual: string) {
    if (problem !== null) {
      return t(`youtrack.problems.${problem}`);
    }

    return usual;
  }

  let rows = <SettingsRow title={t("youtrack.settings.connection")} description={t("youtrack.settings.checking")}>{null}</SettingsRow>;

  if (status?.kind === "connected") {
    rows = (
      <SettingsRow
        title={t("youtrack.settings.connection")}
        description={hint(t("youtrack.settings.connected", { name: status.name, host: status.host }))}
      >
        <Button onClick={disconnect}>{t("youtrack.settings.disconnect")}</Button>
      </SettingsRow>
    );
  }

  if (status?.kind === "broken") {
    rows = (
      <SettingsRow
        title={t("youtrack.settings.connection")}
        description={hint(`${status.host}. ${t(`youtrack.problems.${youtrackProblemOf(status.code)}`)}`)}
      >
        <div className="flex gap-2">
          <Button disabled={youtrack.checking} onClick={() => void youtrack.recheck()}>
            {t("youtrack.settings.recheck")}
          </Button>
          <Button onClick={disconnect}>{t("youtrack.settings.disconnect")}</Button>
        </div>
      </SettingsRow>
    );
  }

  let hostHint: string = t("youtrack.settings.hostHint");
  let tokenHint: string = hint(t("youtrack.settings.tokenHint"));

  if (connecting) {
    tokenHint = t("youtrack.settings.checking");
  }

  // Отказ адреса стоит под адресом, остальные под токеном рядом с кнопкой.
  if (problem?.startsWith("youtrack_host_") === true) {
    hostHint = hint(hostHint);
    tokenHint = t("youtrack.settings.tokenHint");
  }

  if (status?.kind === "none") {
    rows = (
      <>
        <SettingsRow title={t("youtrack.settings.host")} description={hostHint}>
          <input
            aria-label={t("youtrack.settings.host")}
            placeholder="acme.youtrack.cloud"
            value={host}
            autoComplete="off"
            spellCheck={false}
            className={FIELD}
            onChange={(event) => setHost(event.target.value)}
          />
        </SettingsRow>
        <SettingsRow title={t("youtrack.settings.token")} description={tokenHint}>
          <div className="flex gap-2">
            <input
              type="password"
              aria-label={t("youtrack.settings.token")}
              placeholder="perm:…"
              value={token}
              autoComplete="off"
              spellCheck={false}
              className={FIELD}
              onChange={(event) => setToken(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  connect();
                }
              }}
            />
            <Button disabled={!ready} onClick={connect}>
              {t("youtrack.settings.connect")}
            </Button>
          </div>
        </SettingsRow>
      </>
    );
  }

  return (
    <SettingsSection title={t("youtrack.settings.title")} description={t("youtrack.settings.description")}>
      <SettingsGroup title="YouTrack" description={t("youtrack.settings.youtrack")}>
        {rows}
      </SettingsGroup>
    </SettingsSection>
  );
}
