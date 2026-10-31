import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/ui/button";
import { SettingsGroup, SettingsRow, SettingsSection } from "@/core/ui/settings";
import { useYoutrack } from "../interactions/connection";
import { changeDefaultProject, useDefaultProject } from "../interactions/project";
import { youtrackProblemOf, type YoutrackProblem } from "../model/youtrack";

const FIELD =
  "h-8 w-48 rounded-md border border-stroke bg-transparent px-2 text-[13px] outline-none focus:border-accent";

// Раздел «Интеграции»: подключение к своему YouTrack по адресу и токену,
// одной строкой, как GitLab и ADO в MonoCode. Токен после подключения
// не виден вовсе, его можно только стереть.
export function YoutrackSettings() {
  const { t } = useTranslation();
  const youtrack = useYoutrack();
  const project = useDefaultProject();
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

  let description: string = t("youtrack.settings.checking");
  let controls = null;

  if (status?.kind === "none") {
    description = t("youtrack.settings.hint");
    controls = (
      <>
        <input
          aria-label={t("youtrack.settings.host")}
          placeholder="acme.youtrack.cloud"
          value={host}
          autoComplete="off"
          spellCheck={false}
          className={FIELD}
          onChange={(event) => setHost(event.target.value)}
        />
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
      </>
    );
  }

  if (status?.kind === "connected") {
    description = t("youtrack.settings.connected", { name: status.name });
  }

  if (status?.kind === "broken") {
    description = t(`youtrack.problems.${youtrackProblemOf(status.code)}`);
  }

  if (status?.kind === "connected" || status?.kind === "broken") {
    controls = (
      <>
        <span className="text-[13px] text-content/60">{status.host}</span>
        {status.kind === "broken" && (
          <Button disabled={youtrack.checking} onClick={() => void youtrack.recheck()}>
            {t("youtrack.settings.recheck")}
          </Button>
        )}
        <Button onClick={disconnect}>{t("youtrack.settings.disconnect")}</Button>
      </>
    );
  }

  if (connecting) {
    description = t("youtrack.settings.checking");
  }

  // Отказ последнего действия важнее обычного пояснения.
  if (problem !== null) {
    description = t(`youtrack.problems.${problem}`);
  }

  return (
    <SettingsSection title={t("youtrack.settings.title")} description={t("youtrack.settings.description")}>
      <SettingsGroup title="YouTrack" description={t("youtrack.settings.youtrack")}>
        <SettingsRow title={t("youtrack.settings.connection")} description={description}>
          <div className="flex items-center gap-2">{controls}</div>
        </SettingsRow>
        <SettingsRow title={t("youtrack.settings.project")} description={t("youtrack.settings.projectHint")}>
          <input
            aria-label={t("youtrack.settings.project")}
            placeholder="SAP"
            value={project}
            autoComplete="off"
            spellCheck={false}
            className={FIELD}
            onChange={(event) => changeDefaultProject(event.target.value)}
          />
        </SettingsRow>
      </SettingsGroup>
    </SettingsSection>
  );
}
