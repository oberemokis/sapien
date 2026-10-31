import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/ui/button";
import { SettingsGroup, SettingsRow, SettingsSection } from "@/core/ui/settings";
import {
  ACTIONS_FOLDER,
  actionsOf,
  actionText,
  DIGEST_ACTION,
  hotkeyLabel,
  hotkeyOf,
  hotkeyProblem,
  INTEGRATIONS,
  nameProblem,
  nameProblemOf,
  type Action,
  type ActionNameProblem,
  type Integration,
} from "../model/actions";

const FIELD = "h-8 w-56 rounded-md border border-stroke bg-transparent px-2 text-[13px] outline-none focus:border-accent";

const NAMES: Record<Integration, string> = { youtrack: "YouTrack" };

type Props = {
  // Заметки папки действий, undefined пока хранилище не прочитано.
  notes: { path: string; text: string }[] | undefined;
  // Кладёт файл действия в папку и отвечает его путём. Занятое имя
  // отвечает кодом name_taken.
  create: (name: string, text: string) => Promise<string>;
  // Открывает файл действия в редакторе.
  open: (path: string) => void;
};

function Row({ action, onOpen }: { action: Action; onOpen: () => void }) {
  const { t } = useTranslation();
  const parts: string[] = [];

  if (action.hotkey !== null) {
    parts.push(hotkeyLabel(action.hotkey));
  } else if (action.hotkeyText !== "") {
    parts.push(action.hotkeyText);
  }

  if (action.schedule !== null) {
    parts.push(t("agent.actions.scheduled", { when: action.scheduleText }));
  }

  parts.push(...action.integrations.map((integration) => NAMES[integration]));
  parts.push(...action.problems.map((problem) => t(`agent.actions.problems.${problem}`)));

  return (
    <SettingsRow title={action.name} description={parts.join(" · ") || t("agent.actions.plain")}>
      <Button onClick={onOpen}>{t("agent.actions.open")}</Button>
    </SettingsRow>
  );
}

// Раздел «Действия»: новое действие формой и список созданных. Действие
// это файл в папке хранилища, поэтому править его можно и в редакторе:
// «Открыть» ведёт туда.
export function ActionSettings({ notes, create, open }: Props) {
  const { t } = useTranslation();
  const actions = useMemo(() => actionsOf(notes ?? []), [notes]);
  const digest = actions.find((action) => action.name === DIGEST_ACTION.name);
  const [name, setName] = useState("");
  const [task, setTask] = useState("");
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [hotkey, setHotkey] = useState<string | null>(null);
  const [taken, setTaken] = useState<ActionNameProblem | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const taskId = useId();

  // Имя проверяется, когда его уже ввели: пустое поле не ругается заранее.
  let problem = taken;

  if (name !== "") {
    problem = nameProblem(name, actions) ?? taken;
  }

  let keyProblem: "reservedHotkey" | "takenHotkey" | null = null;

  if (hotkey !== null) {
    keyProblem = hotkeyProblem(hotkey, actions);
  }

  const ready = notes !== undefined && !saving && problem === null && name.trim() !== "" && task.trim() !== "";

  function save() {
    if (!ready || keyProblem !== null) {
      return;
    }

    setSaving(true);
    setFailed(false);
    create(name.trim(), actionText(task, integrations, hotkey))
      .then(() => {
        setName("");
        setTask("");
        setIntegrations([]);
        setHotkey(null);
      })
      .catch((error: unknown) => {
        setTaken(nameProblemOf(error));
        setFailed(nameProblemOf(error) === null);
      })
      .finally(() => setSaving(false));
  }

  // Готовое действие добавляется файлом и сразу открывается: эпик
  // вписывается в его шапку.
  function addDigest() {
    setSaving(true);
    setFailed(false);
    create(DIGEST_ACTION.name, DIGEST_ACTION.text)
      .then(open)
      .catch(() => setFailed(true))
      .finally(() => setSaving(false));
  }

  let keyHint: string = t("agent.actions.hotkeyHint");

  if (keyProblem !== null) {
    keyHint = t(`agent.actions.problems.${keyProblem}`);
  }

  return (
    <SettingsSection title={t("agent.actions.title")} description={t("agent.actions.description")}>
      <SettingsGroup title={t("agent.actions.new")} description={t("agent.actions.newHint", { folder: ACTIONS_FOLDER })}>
        <SettingsRow
          title={t("agent.actions.name")}
          description={problem === null ? t("agent.actions.nameHint") : t(`agent.actions.${problem}`)}
        >
          <input
            aria-label={t("agent.actions.name")}
            aria-invalid={problem !== null}
            placeholder={t("agent.actions.namePlaceholder")}
            value={name}
            className={FIELD}
            onChange={(event) => {
              setName(event.target.value);
              setTaken(null);
            }}
          />
        </SettingsRow>
        <div className="flex flex-col gap-2 px-4 py-3.5">
          <label htmlFor={taskId} className="text-sm font-medium">
            {t("agent.actions.task")}
          </label>
          <textarea
            id={taskId}
            placeholder={t("agent.actions.taskPlaceholder")}
            value={task}
            rows={4}
            className="w-full resize-y rounded-md border border-stroke bg-transparent px-2 py-1.5 text-[13px] outline-none focus:border-accent"
            onChange={(event) => setTask(event.target.value)}
          />
        </div>
        <SettingsRow title={t("agent.actions.integrations")} description={t("agent.actions.integrationsHint")}>
          <div className="flex gap-4">
            {INTEGRATIONS.map((integration) => (
              <label key={integration} className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={integrations.includes(integration)}
                  onChange={(event) =>
                    setIntegrations((list) =>
                      event.target.checked ? [...list, integration] : list.filter((item) => item !== integration),
                    )
                  }
                />
                {NAMES[integration]}
              </label>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow title={t("agent.actions.hotkey")} description={keyHint}>
          {/* Поле записывает нажатое сочетание, а не текст. Tab уходит
              дальше, Backspace и Delete без модификаторов стирают. */}
          <input
            readOnly
            aria-label={t("agent.actions.hotkey")}
            aria-invalid={keyProblem !== null}
            placeholder={t("agent.actions.hotkeyPlaceholder")}
            value={hotkey === null ? "" : hotkeyLabel(hotkey)}
            className={FIELD}
            onKeyDown={(event) => {
              if (event.key === "Tab") {
                return;
              }

              event.preventDefault();

              if (event.key === "Backspace" || event.key === "Delete") {
                setHotkey(null);
              }

              const pressed = hotkeyOf(event.nativeEvent);

              if (pressed !== null) {
                setHotkey(pressed);
              }
            }}
          />
        </SettingsRow>
        <div className="flex items-center justify-end gap-3 px-4 py-3">
          {failed && <p className="flex-1 text-[13px] text-diff-del-fg">{t("agent.actions.failed")}</p>}
          <Button disabled={!ready || keyProblem !== null} onClick={save}>
            {t("agent.actions.create")}
          </Button>
        </div>
      </SettingsGroup>
      <SettingsGroup title={t("agent.actions.ready")}>
        <SettingsRow title={DIGEST_ACTION.name} description={t("agent.actions.digest")}>
          {digest === undefined && (
            <Button disabled={notes === undefined || saving} onClick={addDigest}>
              {t("agent.actions.add")}
            </Button>
          )}
          {digest !== undefined && <Button onClick={() => open(digest.path)}>{t("agent.actions.open")}</Button>}
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title={t("agent.actions.list")}>
        {notes !== undefined && actions.length === 0 && (
          <p className="px-4 py-3.5 text-[13px] text-content/50">{t("agent.actions.empty")}</p>
        )}
        {notes === undefined && <div className="h-[52px]" />}
        {actions.map((action) => (
          <Row key={action.path} action={action} onOpen={() => open(action.path)} />
        ))}
      </SettingsGroup>
    </SettingsSection>
  );
}
