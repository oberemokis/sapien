import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { openLink } from "@/core/links/open-link";
import { withFrontmatterList, withFrontmatterMap, withFrontmatterValue } from "@/core/markdown/frontmatter";
import { useOnline } from "@/core/network/online";
import { Button } from "@/core/ui/button";
import { useYoutrack } from "../interactions/connection";
import { useCheck, useIssueState, usePublish, useSimilar } from "../interactions/draft";
import { breakdownTask } from "../model/breakdown";
import { duplicateFindings, localFindings, remoteFindings, type Finding } from "../model/check";
import {
  CUSTOM_KEY,
  DRAFT_FIELDS,
  DRAFT_LINKS,
  draftRequest,
  ISSUE_KEY,
  NOT_DUPLICATES_KEY,
  noteTitle,
  parseDraft,
  resolveLinks,
  withIssueText,
  type LinkedNote,
  type TaskDraft,
} from "../model/draft";
import {
  youtrackProblemOf,
  type Checked,
  type Published,
  type Similar,
  type YoutrackProblem,
} from "../model/youtrack";
import { Alert, AlertAction } from "./alert";
import { PublishAll } from "./publish-all";

const FIELD =
  "h-7 min-w-0 flex-1 rounded-md border border-stroke bg-transparent px-2 outline-none focus:border-accent aria-invalid:border-diff-del read-only:opacity-60";

type Props = {
  path: string;
  text: string;
  readOnly: boolean;
  onChange: (text: string) => void;
  // Заметки хранилища: связь на черновик встаёт номером его задачи.
  notes: LinkedNote[];
  // Открывает связанный черновик.
  onOpen: (path: string) => void;
  // Отдаёт агенту задание разбить черновик на задачи. Без него кнопки нет.
  onBreakdown?: (task: string) => void;
  // Пишет текст другой заметки: номера задач после «Опубликовать всё».
  // from это текст, от которого пошла правка. Ответ, легла ли запись.
  // Без него кнопки нет.
  onWrite?: (path: string, text: string, from: string) => Promise<boolean>;
};

type FieldProps = {
  // По нему находка проверки переводит курсор в поле.
  id: string;
  label: string;
  value: string;
  invalid?: boolean;
  readOnly: boolean;
  hint?: string;
  onCommit: (value: string) => void;
};

// Поле шапки. В заметку пишется, когда человек закончил: по Enter или уходя
// из поля. Иначе каждая буква меняла бы текст, а пробел в конце набранного
// слова пропадал бы сразу.
function HeaderField({ id, label, value, invalid = false, readOnly, hint, onCommit }: FieldProps) {
  const [shown, setShown] = useState(value);
  const [typed, setTyped] = useState(value);

  // Шапку поправили в тексте: поле показывает новое значение.
  if (shown !== value) {
    setShown(value);
    setTyped(value);
  }

  function commit() {
    if (typed !== value) {
      onCommit(typed);
    }

    // Запись могла ничего не поменять, например пустой проект: поле
    // возвращается к тому, что в шапке.
    setTyped(value);
  }

  return (
    <label className="flex items-center gap-2">
      <span className="w-24 shrink-0 truncate text-content/60">{label}</span>
      <input
        id={id}
        value={typed}
        aria-invalid={invalid || undefined}
        readOnly={readOnly}
        title={hint}
        autoComplete="off"
        spellCheck={false}
        className={FIELD}
        onChange={(event) => setTyped(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit();
          }
        }}
      />
    </label>
  );
}

type FindingProps = {
  finding: Finding;
  path: string;
  onField: (field: string) => void;
  onOpen: (path: string) => void;
  onNotDuplicate: (id: string) => void;
};

// Находка проверки. Текст ведёт к полю, о котором она, а черновики,
// которые она называет, открываются рядом.
function FindingItem({ finding, path, onField, onOpen, onNotDuplicate }: FindingProps) {
  const { t } = useTranslation();
  const text = t(`youtrack.check.findings.${finding.code}`, {
    subject: "",
    project: "",
    summary: "",
    words: "",
    ...finding.values,
  });
  const { field } = finding;

  return (
    <li className="flex items-start gap-2">
      <span className={finding.blocking ? "w-28 shrink-0 text-diff-del" : "w-28 shrink-0 text-content/60"}>
        {finding.blocking ? t("youtrack.check.error") : t("youtrack.check.warning")}
      </span>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
        {field === null ? (
          <span>{text}</span>
        ) : (
          <button type="button" className="text-left hover:underline" onClick={() => onField(field)}>
            {text}
          </button>
        )}
        <div className="flex flex-wrap gap-x-3 empty:hidden">
          {finding.drafts
            .filter((draft) => draft !== path)
            .map((draft) => (
              <AlertAction key={draft} onClick={() => onOpen(draft)}>
                {t("youtrack.check.open", { title: noteTitle(draft) })}
              </AlertAction>
            ))}
          {finding.code === "duplicate" && (
            <AlertAction onClick={() => onNotDuplicate(finding.values.subject ?? "")}>
              {t("youtrack.check.notDuplicate")}
            </AlertAction>
          )}
        </div>
      </div>
    </li>
  );
}

function DraftForm({
  draft,
  path,
  text,
  readOnly,
  onChange,
  notes,
  onOpen,
  onBreakdown,
  onWrite,
}: Props & { draft: TaskDraft }) {
  const { t } = useTranslation();
  const online = useOnline();
  const youtrack = useYoutrack();
  const publishing = usePublish();
  const issue = useIssueState(draft.id, online);
  const checking = useCheck();
  const searching = useSimilar();
  const [result, setResult] = useState<Published | null>(null);
  const [problem, setProblem] = useState<YoutrackProblem | null>(null);
  // Ответ YouTrack на последнюю проверку и найденные кандидаты в дубли.
  // Находки по ним считаются заново с каждой правкой: поправленное уходит
  // из списка без новой проверки.
  const [checked, setChecked] = useState<Checked | null>(null);
  const [similar, setSimilar] = useState<Similar[] | null>(null);
  // Текст заметки на сейчас: ответ YouTrack приходит позже, а человек
  // за это время мог поправить заметку.
  const latest = useRef(text);
  const formId = useId();
  const connected = youtrack.status?.kind === "connected";
  const { unpublished } = resolveLinks(draft, notes);
  const required = new Set([...(result?.kind === "missing" ? result.fields : []), ...(checked?.missing ?? [])]);
  const findings = [
    ...localFindings(path, draft, notes),
    ...(checked === null ? [] : remoteFindings(path, draft, notes, checked)),
    ...(similar === null ? [] : duplicateFindings(draft, similar)),
  ].toSorted((a, b) => Number(b.blocking) - Number(a.blocking));
  const blocked = findings.some((finding) => finding.blocking);
  const errors = findings.filter((finding) => finding.blocking).length;

  useEffect(() => {
    latest.current = text;
  }, [text]);

  function write(next: string) {
    latest.current = next;
    onChange(next);
  }

  function fieldId(field: string) {
    return `${formId}-${field}`;
  }

  function current() {
    return parseDraft(latest.current, noteTitle(path));
  }

  // Проверка у YouTrack. Находки по её ответу или null, если спросить
  // не вышло: тогда причина видна над формой.
  async function check(draftNow: TaskDraft) {
    setProblem(null);

    try {
      const answer = await checking.mutateAsync(draftRequest(draftNow));

      setChecked(answer);

      return remoteFindings(path, draftNow, notes, answer);
    } catch (error) {
      setProblem(youtrackProblemOf(error));

      return null;
    }
  }

  function findDuplicates() {
    setProblem(null);
    searching.mutate(
      { project: draft.project, summary: draft.summary },
      { onSuccess: setSimilar, onError: (error) => setProblem(youtrackProblemOf(error)) },
    );
  }

  function notDuplicate(id: string) {
    write(withFrontmatterList(latest.current, NOT_DUPLICATES_KEY, [...(current()?.notDuplicates ?? []), id]));
  }

  // Перед обычной публикацией черновик проверяется у YouTrack: с находкой,
  // которая держит публикацию, задача не уходит. Ответ на расхождение
  // (force) уже решение человека, его проверка не держит.
  async function publish(force: boolean) {
    const draftNow = current();

    if (draftNow === null) {
      return;
    }

    const resolved = resolveLinks(draftNow, notes);

    if (resolved.unpublished.length > 0) {
      return;
    }

    if (!force) {
      const remote = await check(draftNow);

      if (remote === null || [...localFindings(path, draftNow, notes), ...remote].some((item) => item.blocking)) {
        return;
      }
    }

    setResult(null);
    setProblem(null);
    publishing.mutate(
      { path, text: latest.current, draft: draftRequest(resolved.draft), id: draftNow.id, force },
      {
        onSuccess: (published) => {
          // Номер встаёт в шапку сразу: повторное нажатие обновит задачу,
          // а не создаст вторую.
          if (published.kind === "done" && draftNow.id === null) {
            write(withFrontmatterValue(latest.current, ISSUE_KEY, published.id));
          }

          setResult(published);
        },
        onError: (error) => setProblem(youtrackProblemOf(error)),
      },
    );
  }

  // Текст из YouTrack встаёт в заметку и сразу уходит обратно вместе
  // с полями: так прошлая отправка снова совпадает с задачей.
  function takeTheirs(summary: string, description: string) {
    write(withIssueText(latest.current, summary, description));
    void publish(true);
  }

  function setCustom(name: string, value: string) {
    const custom = current()?.custom ?? [];
    let entries = [...custom, { name, value }];

    if (custom.some((entry) => entry.name === name)) {
      entries = custom.map((entry) => (entry.name === name ? { name, value } : entry));
    }

    write(withFrontmatterMap(latest.current, CUSTOM_KEY, entries));
  }

  // Обязательные поля проекта, которых нет в шапке, форма показывает
  // пустыми строками: их видно и есть куда вписать значение.
  const known = new Set<string>([...DRAFT_FIELDS.map((field) => field.name), ...draft.custom.map((entry) => entry.name)]);
  const custom = [
    ...draft.custom,
    ...[...required].filter((name) => !known.has(name)).map((name) => ({ name, value: "" })),
  ];
  let action: string = t("youtrack.draft.publish");

  if (draft.id !== null) {
    action = t("youtrack.draft.update");
  }

  if (publishing.isPending || checking.isPending) {
    action = t("youtrack.draft.publishing");
  }

  const remoteReady = online && connected && draft.project !== "";

  let hint = null;

  if (!online) {
    hint = t("youtrack.draft.offline");
  } else if (youtrack.status !== undefined && !connected) {
    hint = t("youtrack.draft.notConnected");
  }

  return (
    <section
      aria-label={t("youtrack.draft.title")}
      className="mx-4 mb-2 flex shrink-0 flex-col gap-2 rounded-md border border-stroke px-3 py-2 text-[13px]"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-medium">{draft.id ?? t("youtrack.draft.draft")}</h2>
        {issue.data !== undefined && (
          <>
            {issue.data.state !== null && (
              <span className="rounded bg-selection px-1.5 py-0.5" title={t("youtrack.draft.state")}>
                {issue.data.state}
              </span>
            )}
            <span className="text-content/60">{issue.data.assignee ?? t("youtrack.draft.noAssignee")}</span>
          </>
        )}
        {issue.isError && (
          <span className="text-content/60">{t(`youtrack.problems.${youtrackProblemOf(issue.error)}`)}</span>
        )}
        <div className="ml-auto flex gap-2">
          {issue.data !== undefined && (
            <Button onClick={() => openLink(issue.data.url)}>{t("youtrack.draft.open")}</Button>
          )}
          {onBreakdown !== undefined && (
            // Разбивает агент, а ему нужна сеть.
            <Button disabled={readOnly || !online} onClick={() => onBreakdown(breakdownTask(path, draft.id))}>
              {t("youtrack.breakdown.run")}
            </Button>
          )}
          <Button
            disabled={
              readOnly || !remoteReady || publishing.isPending || checking.isPending || unpublished.length > 0 || blocked
            }
            onClick={() => void publish(false)}
          >
            {action}
          </Button>
        </div>
      </div>
      {hint !== null && <p className="text-content/60">{hint}</p>}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        <HeaderField
          id={fieldId("project")}
          label={t("youtrack.draft.project")}
          value={draft.project}
          // Пустой проект бывает у задачи из шаблона, когда проект
          // по умолчанию не задан: без него публиковать некуда.
          invalid={draft.project === ""}
          readOnly={readOnly}
          onCommit={(value) => {
            // Ключ без значения форма не пишет: стёртый проект вернулся бы
            // пустым, а убирают черновик, удаляя ключ в самой шапке.
            if (value.trim() !== "") {
              write(withFrontmatterValue(latest.current, "project", value));
            }
          }}
        />
        {DRAFT_FIELDS.map(({ key, name }) => (
          <HeaderField
            key={key}
            id={fieldId(key)}
            label={t(`youtrack.draft.fields.${key}`)}
            value={draft.values[key]}
            invalid={required.has(name) && draft.values[key] === ""}
            readOnly={readOnly}
            onCommit={(value) => write(withFrontmatterValue(latest.current, key, value))}
          />
        ))}
        {custom.map(({ name, value }) => (
          <HeaderField
            key={name}
            id={fieldId(`${CUSTOM_KEY}.${name}`)}
            label={name}
            value={value}
            invalid={required.has(name) && value === ""}
            readOnly={readOnly}
            onCommit={(next) => setCustom(name, next)}
          />
        ))}
        {DRAFT_LINKS.map(({ key }) => (
          <HeaderField
            key={key}
            id={fieldId(key)}
            label={t(`youtrack.draft.links.${key}`)}
            value={draft.links[key].join(", ")}
            invalid={findings.some((finding) => finding.blocking && finding.field === key)}
            readOnly={readOnly}
            hint={t("youtrack.draft.linksHint")}
            onCommit={(value) => write(withFrontmatterList(latest.current, key, value.split(",")))}
          />
        ))}
      </div>
      <section aria-label={t("youtrack.check.title")} className="flex flex-col gap-1.5 border-t border-hairline pt-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium">{t("youtrack.check.title")}</h3>
          <span className="text-content/60">
            {findings.length === 0
              ? t("youtrack.check.clean")
              : t("youtrack.check.count", { errors, warnings: findings.length - errors })}
          </span>
          <div className="ml-auto flex gap-2">
            <Button disabled={!remoteReady || searching.isPending} onClick={findDuplicates}>
              {searching.isPending ? t("youtrack.check.searching") : t("youtrack.check.duplicates")}
            </Button>
            <Button
              disabled={!remoteReady || checking.isPending}
              onClick={() => {
                const draftNow = current();

                if (draftNow !== null) {
                  void check(draftNow);
                }
              }}
            >
              {checking.isPending ? t("youtrack.check.running") : t("youtrack.check.run")}
            </Button>
          </div>
        </div>
        {!online && <p className="text-content/60">{t("youtrack.check.offline")}</p>}
        {findings.length > 0 && (
          <ul className="flex flex-col gap-1">
            {findings.map((finding) => (
              <FindingItem
                key={`${finding.code}:${finding.field ?? ""}:${finding.values.subject ?? ""}`}
                finding={finding}
                path={path}
                onField={(field) => document.getElementById(fieldId(field))?.focus()}
                onOpen={onOpen}
                onNotDuplicate={notDuplicate}
              />
            ))}
          </ul>
        )}
      </section>
      {unpublished.length > 0 && (
        <Alert>
          <p>{t("youtrack.draft.unpublished")}</p>
          <ul className="mt-1">
            {unpublished.map((target) => (
              <li key={target} className="flex items-center gap-2">
                <span className="truncate">{target}</span>
                <AlertAction onClick={() => onOpen(target)}>{t("youtrack.draft.openDraft")}</AlertAction>
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {problem !== null && <Alert>{t(`youtrack.problems.${problem}`)}</Alert>}
      {result?.kind === "missing" && (
        <Alert>{t("youtrack.draft.missing", { fields: result.fields.join(", ") })}</Alert>
      )}
      {result?.kind === "done" && result.failed.length > 0 && (
        <Alert>{t("youtrack.draft.failed", { id: result.id, commands: result.failed.join("; ") })}</Alert>
      )}
      {result?.kind === "done" && result.failed.length === 0 && (
        <output className="text-content/60">{t("youtrack.draft.published", { id: result.id })}</output>
      )}
      {result?.kind === "diverged" && (
        <Alert
          action={
            <div className="flex flex-col items-end gap-1">
              <AlertAction onClick={() => void publish(true)}>{t("youtrack.draft.sendMine")}</AlertAction>
              <AlertAction onClick={() => takeTheirs(result.summary, result.description)}>
                {t("youtrack.draft.takeTheirs")}
              </AlertAction>
            </div>
          }
        >
          <p>{t("youtrack.draft.diverged")}</p>
          <section
            aria-label={t("youtrack.draft.theirs")}
            className="mt-2 max-h-40 overflow-auto rounded-md border border-stroke px-2 py-1"
          >
            <p className="font-medium">{result.summary}</p>
            <pre className="font-mono text-[12px] whitespace-pre-wrap">{result.description}</pre>
          </section>
        </Alert>
      )}
      {onWrite !== undefined && (
        <PublishAll
          path={path}
          draft={draft}
          text={text}
          notes={notes}
          ready={remoteReady && !readOnly}
          onWrite={onWrite}
          onOpen={onOpen}
        />
      )}
    </section>
  );
}

// Форма черновика задачи над текстом заметки. Заметка без проекта в шапке
// не черновик, и формы у неё нет. Форма правит шапку того же текста,
// что и редактор, поэтому шапка в тексте и поля формы всегда совпадают.
export function TaskDraftForm(props: Props) {
  const draft = parseDraft(props.text, noteTitle(props.path));

  if (draft === null) {
    return null;
  }

  return <DraftForm {...props} draft={draft} />;
}
