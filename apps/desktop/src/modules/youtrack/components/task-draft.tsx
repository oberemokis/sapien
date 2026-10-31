import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { openLink } from "@/core/links/open-link";
import { withFrontmatterList, withFrontmatterMap, withFrontmatterValue } from "@/core/markdown/frontmatter";
import { useOnline } from "@/core/network/online";
import { Button } from "@/core/ui/button";
import { useYoutrack } from "../interactions/connection";
import { useIssueState, usePublish } from "../interactions/draft";
import {
  CUSTOM_KEY,
  DRAFT_FIELDS,
  DRAFT_LINKS,
  draftRequest,
  ISSUE_KEY,
  parseDraft,
  resolveLinks,
  withIssueText,
  type LinkedNote,
  type TaskDraft,
} from "../model/draft";
import { youtrackProblemOf, type Published, type YoutrackProblem } from "../model/youtrack";

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
};

function titleOf(path: string) {
  return (path.split("/").pop() ?? path).replace(/\.md$/, "");
}

type FieldProps = {
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
function HeaderField({ label, value, invalid = false, readOnly, hint, onCommit }: FieldProps) {
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

function Alert({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-md bg-diff-del-bg px-3 py-2">
      <div className="flex-1">{children}</div>
      {action}
    </div>
  );
}

function AlertAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="shrink-0 underline underline-offset-2" onClick={onClick}>
      {children}
    </button>
  );
}

function DraftForm({ draft, path, text, readOnly, onChange, notes, onOpen }: Props & { draft: TaskDraft }) {
  const { t } = useTranslation();
  const online = useOnline();
  const youtrack = useYoutrack();
  const publishing = usePublish();
  const issue = useIssueState(draft.id, online);
  const [result, setResult] = useState<Published | null>(null);
  const [problem, setProblem] = useState<YoutrackProblem | null>(null);
  // Текст заметки на сейчас: ответ YouTrack приходит позже, а человек
  // за это время мог поправить заметку.
  const latest = useRef(text);
  const connected = youtrack.status?.kind === "connected";
  const { unpublished } = resolveLinks(draft, notes);
  const missing = result?.kind === "missing" ? result.fields : [];

  useEffect(() => {
    latest.current = text;
  }, [text]);

  function write(next: string) {
    latest.current = next;
    onChange(next);
  }

  function publish(force: boolean) {
    const current = parseDraft(latest.current, titleOf(path));

    if (current === null) {
      return;
    }

    const resolved = resolveLinks(current, notes);

    if (resolved.unpublished.length > 0) {
      return;
    }

    setResult(null);
    setProblem(null);
    publishing.mutate(
      { path, text: latest.current, draft: draftRequest(resolved.draft), id: current.id, force },
      {
        onSuccess: (published) => {
          // Номер встаёт в шапку сразу: повторное нажатие обновит задачу,
          // а не создаст вторую.
          if (published.kind === "done" && current.id === null) {
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
    publish(true);
  }

  function setCustom(name: string, value: string) {
    const custom = parseDraft(latest.current, titleOf(path))?.custom ?? [];
    let entries = [...custom, { name, value }];

    if (custom.some((entry) => entry.name === name)) {
      entries = custom.map((entry) => (entry.name === name ? { name, value } : entry));
    }

    write(withFrontmatterMap(latest.current, CUSTOM_KEY, entries));
  }

  // Обязательные поля проекта, которых нет в шапке, форма показывает
  // пустыми строками: их видно и есть куда вписать значение.
  const known = new Set<string>([...DRAFT_FIELDS.map((field) => field.name), ...draft.custom.map((entry) => entry.name)]);
  const custom = [...draft.custom, ...missing.filter((name) => !known.has(name)).map((name) => ({ name, value: "" }))];
  let action: string = t("youtrack.draft.publish");

  if (draft.id !== null) {
    action = t("youtrack.draft.update");
  }

  if (publishing.isPending) {
    action = t("youtrack.draft.publishing");
  }

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
          <Button
            disabled={
              readOnly ||
              !online ||
              !connected ||
              publishing.isPending ||
              unpublished.length > 0 ||
              draft.project === ""
            }
            onClick={() => publish(false)}
          >
            {action}
          </Button>
        </div>
      </div>
      {hint !== null && <p className="text-content/60">{hint}</p>}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        <HeaderField
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
            label={t(`youtrack.draft.fields.${key}`)}
            value={draft.values[key]}
            invalid={missing.includes(name) && draft.values[key] === ""}
            readOnly={readOnly}
            onCommit={(value) => write(withFrontmatterValue(latest.current, key, value))}
          />
        ))}
        {custom.map(({ name, value }) => (
          <HeaderField
            key={name}
            label={name}
            value={value}
            invalid={missing.includes(name) && value === ""}
            readOnly={readOnly}
            onCommit={(next) => setCustom(name, next)}
          />
        ))}
        {DRAFT_LINKS.map(({ key }) => (
          <HeaderField
            key={key}
            label={t(`youtrack.draft.links.${key}`)}
            value={draft.links[key].join(", ")}
            readOnly={readOnly}
            hint={t("youtrack.draft.linksHint")}
            onCommit={(value) => write(withFrontmatterList(latest.current, key, value.split(",")))}
          />
        ))}
      </div>
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
              <AlertAction onClick={() => publish(true)}>{t("youtrack.draft.sendMine")}</AlertAction>
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
    </section>
  );
}

// Форма черновика задачи над текстом заметки. Заметка без проекта в шапке
// не черновик, и формы у неё нет. Форма правит шапку того же текста,
// что и редактор, поэтому шапка в тексте и поля формы всегда совпадают.
export function TaskDraftForm(props: Props) {
  const draft = parseDraft(props.text, titleOf(props.path));

  if (draft === null) {
    return null;
  }

  return <DraftForm {...props} draft={draft} />;
}
