import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/ui/button";
import { FIELD as INPUT, SettingsGroup, SettingsRow, SettingsSection } from "@/core/ui/settings";
import { useActionFiles, useCreateAction, useDeleteAction, useWriteAction } from "../interactions/actions";
import {
  actionsOf,
  actionText,
  hotkeyLabel,
  hotkeyOf,
  hotkeyProblem,
  nameProblem,
  nameProblemOf,
  parseHotkey,
  parseSchedule,
  type Action,
  type ActionNameProblem,
} from "../model/actions";

const FIELD = `${INPUT} w-56`;

// Подстановки задания видны в подсказках как есть: i18next иначе принял
// бы их за свои.
const PLACEHOLDERS = { since: "{{since}}", today: "{{today}}" };

type FormProps = {
  // Правленое действие. undefined: новое.
  action: Action | undefined;
  actions: Action[];
  onDone: () => void;
};

// Форма действия: имя (только у нового), задание, клавиша и расписание.
// Имя это имя файла, поэтому у готового действия оно не меняется.
function ActionForm({ action, actions, onDone }: FormProps) {
  const { t } = useTranslation();
  const create = useCreateAction();
  const write = useWriteAction();
  const [name, setName] = useState("");
  const [task, setTask] = useState(action?.task ?? "");
  const [hotkey, setHotkey] = useState<string | null>(action === undefined ? null : parseHotkey(action.hotkeyText));
  const [schedule, setSchedule] = useState(action?.scheduleText ?? "");
  const [taken, setTaken] = useState<ActionNameProblem | null>(null);
  const [failed, setFailed] = useState(false);
  const taskId = useId();
  const saving = create.isPending || write.isPending;

  // Имя проверяется, когда его уже ввели: пустое поле не ругается заранее.
  let problem = taken;

  if (action === undefined && name !== "") {
    problem = nameProblem(name, actions) ?? taken;
  }

  let keyProblem: "reservedHotkey" | "takenHotkey" | null = null;

  if (hotkey !== null) {
    keyProblem = hotkeyProblem(hotkey, actions, action?.path ?? null);
  }

  const badSchedule = schedule.trim() !== "" && parseSchedule(schedule) === null;
  const named = action !== undefined || (problem === null && name.trim() !== "");
  const ready = !saving && named && task.trim() !== "" && keyProblem === null && !badSchedule;

  function save() {
    if (!ready) {
      return;
    }

    const text = actionText(task, hotkey, schedule);

    setFailed(false);

    if (action !== undefined) {
      write.mutate({ path: action.path, text }, { onSuccess: onDone, onError: () => setFailed(true) });
      return;
    }

    create.mutate(
      { name: name.trim(), text },
      {
        onSuccess: onDone,
        onError: (error) => {
          setTaken(nameProblemOf(error));
          setFailed(nameProblemOf(error) === null);
        },
      },
    );
  }

  let keyHint: string = t("agent.actions.hotkeyHint");

  if (keyProblem !== null) {
    keyHint = t(`agent.actions.problems.${keyProblem}`);
  }

  return (
    <SettingsGroup
      title={action === undefined ? t("agent.actions.new") : t("agent.actions.editing", { name: action.name })}
      description={t("agent.actions.newHint", PLACEHOLDERS)}
    >
      {action === undefined && (
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
      )}
      <div className="flex flex-col gap-2 py-5">
        <label htmlFor={taskId} className="text-[13px]/4 font-medium">
          {t("agent.actions.task")}
        </label>
        <textarea
          id={taskId}
          placeholder={t("agent.actions.taskPlaceholder", PLACEHOLDERS)}
          value={task}
          rows={5}
          className={`${INPUT} h-auto w-full resize-y py-1.5 leading-5`}
          onChange={(event) => setTask(event.target.value)}
        />
      </div>
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
      <SettingsRow
        title={t("agent.actions.schedule")}
        description={badSchedule ? t("agent.actions.problems.badSchedule") : t("agent.actions.scheduleHint")}
      >
        <input
          aria-label={t("agent.actions.schedule")}
          aria-invalid={badSchedule}
          placeholder={t("agent.actions.schedulePlaceholder")}
          value={schedule}
          className={FIELD}
          onChange={(event) => setSchedule(event.target.value)}
        />
      </SettingsRow>
      <div className="flex items-center justify-end gap-3 py-3">
        {failed && <p className="flex-1 text-[13px] text-state-fg-danger">{t("agent.actions.failed")}</p>}
        {action !== undefined && <Button onClick={onDone}>{t("agent.actions.cancel")}</Button>}
        <Button variant="submit" disabled={!ready} onClick={save}>
          {action === undefined ? t("agent.actions.create") : t("agent.actions.save")}
        </Button>
      </div>
    </SettingsGroup>
  );
}

type RowProps = {
  action: Action;
  onEdit: () => void;
};

function Row({ action, onEdit }: RowProps) {
  const { t } = useTranslation();
  const remove = useDeleteAction();
  const [removing, setRemoving] = useState(false);
  const parts: string[] = [];

  if (action.hotkey !== null) {
    parts.push(hotkeyLabel(action.hotkey));
  } else if (action.hotkeyText !== "") {
    parts.push(action.hotkeyText);
  }

  if (action.schedule !== null) {
    parts.push(t("agent.actions.scheduled", { when: action.scheduleText }));
  }

  parts.push(...action.problems.map((problem) => t(`agent.actions.problems.${problem}`)));

  if (remove.isError) {
    parts.push(t("agent.actions.deleteFailed"));
  }

  if (removing) {
    return (
      <SettingsRow title={action.name} description={t("agent.actions.deleteAsk")}>
        <Button disabled={remove.isPending} onClick={() => remove.mutate(action.path, { onSettled: () => setRemoving(false) })}>
          {t("agent.actions.deleteYes")}
        </Button>
        <Button onClick={() => setRemoving(false)}>{t("agent.actions.cancel")}</Button>
      </SettingsRow>
    );
  }

  return (
    <SettingsRow title={action.name} description={parts.join(" · ") || t("agent.actions.plain")}>
      <Button onClick={onEdit}>{t("agent.actions.edit")}</Button>
      <Button onClick={() => setRemoving(true)}>{t("agent.actions.delete")}</Button>
    </SettingsRow>
  );
}

// Экран «Действия»: новое действие формой и список созданных. Действия
// общие для всех проектов.
export function ActionsView() {
  const { t } = useTranslation();
  const files = useActionFiles();
  const actions = useMemo(() => actionsOf(files.data ?? []), [files.data]);
  const [editing, setEditing] = useState<string | null>(null);
  // Каждая сохранённая форма сменяется новой, пустой: у формы нового
  // действия свой номер.
  const [round, setRound] = useState(0);
  const edited = actions.find((action) => action.path === editing);

  function done() {
    setEditing(null);
    setRound((value) => value + 1);
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <SettingsSection title={t("agent.actions.title")} description={t("agent.actions.description")}>
        <ActionForm key={edited?.path ?? `new-${round}`} action={edited} actions={actions} onDone={done} />
        <SettingsGroup title={t("agent.actions.list")}>
          {files.data !== undefined && actions.length === 0 && (
            <p className="py-5 text-[13px] text-text-muted">{t("agent.actions.empty")}</p>
          )}
          {files.isError && <p className="py-5 text-[13px] text-state-fg-danger">{t("agent.actions.loadFailed")}</p>}
          {files.isPending && <div className="h-[52px]" />}
          {actions.map((action) => (
            <Row key={action.path} action={action} onEdit={() => setEditing(action.path)} />
          ))}
        </SettingsGroup>
      </SettingsSection>
    </div>
  );
}
