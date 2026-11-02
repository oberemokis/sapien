import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/ui/button";
import { IconButton } from "@/core/ui/icon-button";
import { FIELD as INPUT } from "@/core/ui/settings";
import { useAssignees } from "../interactions/meeting";
import { useDefaultProject } from "../interactions/project";
import { draftNames, noteTitle } from "../model/draft";
import { MEETING_FOLDER, meetingDraftOf, meetingDraftText, type MeetingDraft, type MeetingTask } from "../model/meeting";
import type { Person } from "../model/youtrack";

const FIELD = `${INPUT} min-w-0 aria-invalid:outline-state-border-danger`;

export type NewNote = { name: string; text: string };

type Props = {
  // Заметка со встречи.
  source: string;
  // Что предложил агент. null, пока он читает.
  tasks: MeetingTask[] | null;
  // Почему агент не ответил, текстом для человека.
  problem: string | null;
  // Пути заметок хранилища: имя нового черновика не должно быть занято.
  paths: string[];
  // Кладёт заметки в папку MEETING_FOLDER.
  onCreate: (notes: NewNote[]) => Promise<void>;
  onClose: () => void;
};

// named это исполнитель, как его назвали на встрече.
type Row = MeetingDraft & { checked: boolean; named: string };

type RowProps = {
  row: Row;
  // Исполнителей не с чем сверить: нет проекта по умолчанию или YouTrack
  // не ответил.
  unchecked: boolean;
  onChange: (row: Row) => void;
};

function DraftRow({ row, unchecked, onChange }: RowProps) {
  const { t } = useTranslation();
  const hintId = useId();
  // Исполнителя назвали, а в YouTrack он не нашёлся: поле пустое, пока
  // человек не впишет логин сам.
  const unknown = row.named.trim() !== "" && row.assignee.trim() === "";
  const hint = unchecked ? "youtrack.meeting.assigneeUnchecked" : "youtrack.meeting.assigneeUnknown";

  return (
    <li className="flex flex-col gap-2 border-t border-border-muted py-3">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          className="accent-bg-accent"
          checked={row.checked}
          aria-label={t("youtrack.meeting.take", { title: row.summary })}
          onChange={(event) => onChange({ ...row, checked: event.target.checked })}
        />
        <input
          value={row.summary}
          aria-label={t("youtrack.meeting.summary")}
          aria-invalid={row.summary.trim() === "" || undefined}
          autoComplete="off"
          className={`${FIELD} flex-1 font-medium`}
          onChange={(event) => onChange({ ...row, summary: event.target.value })}
        />
      </div>
      <div className="ml-6 flex flex-wrap gap-x-4 gap-y-1.5">
        <label className="flex items-center gap-2">
          <span className="text-[12px] text-text-muted">{t("youtrack.meeting.assignee")}</span>
          <input
            value={row.assignee}
            aria-invalid={unknown || undefined}
            aria-describedby={unknown ? hintId : undefined}
            autoComplete="off"
            spellCheck={false}
            className={`${FIELD} w-36`}
            onChange={(event) => onChange({ ...row, assignee: event.target.value })}
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-[12px] text-text-muted">{t("youtrack.meeting.due")}</span>
          <input
            type="date"
            value={row.due}
            className={`${FIELD} w-36`}
            onChange={(event) => onChange({ ...row, due: event.target.value })}
          />
        </label>
        <label className="flex min-w-48 flex-1 items-center gap-2">
          <span className="text-[12px] text-text-muted">{t("youtrack.meeting.links")}</span>
          <input
            value={row.links}
            autoComplete="off"
            spellCheck={false}
            className={`${FIELD} flex-1`}
            onChange={(event) => onChange({ ...row, links: event.target.value })}
          />
        </label>
      </div>
      {unknown && (
        <p id={hintId} className="ml-6 text-[12px] text-state-fg-danger">
          {t(hint, { name: row.named })}
        </p>
      )}
      <textarea
        value={row.description}
        rows={2}
        aria-label={t("youtrack.meeting.description")}
        className={`${INPUT} ml-6 h-auto resize-y py-1.5 leading-5`}
        onChange={(event) => onChange({ ...row, description: event.target.value })}
      />
      {row.quote !== "" && (
        <blockquote className="ml-6 border-l-2 border-border-base pl-2 text-text-muted">{row.quote}</blockquote>
      )}
    </li>
  );
}

type RowsProps = Pick<Props, "source" | "paths" | "onCreate"> & {
  tasks: MeetingTask[];
  people: Person[];
  project: string;
  unchecked: boolean;
};

// Предложения агента как черновики, которые человек отмечает и правит.
// Строки собираются один раз, когда известны и предложения, и исполнители.
function DraftRows({ source, paths, onCreate, tasks, people, project, unchecked }: RowsProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Row[]>(() =>
    tasks.map((task) => ({ ...meetingDraftOf(task, people), checked: true, named: task.assignee })),
  );
  const [creating, setCreating] = useState(false);
  const [failed, setFailed] = useState(false);
  const chosen = rows.filter((row) => row.checked && row.summary.trim() !== "");

  async function create() {
    const names = draftNames(
      chosen.map((row) => row.summary),
      paths,
      MEETING_FOLDER,
    );

    setCreating(true);
    setFailed(false);

    try {
      await onCreate(
        chosen.map((row, index) => ({ name: names[index] ?? "", text: meetingDraftText(row, project, source) })),
      );
    } catch {
      setFailed(true);
      setCreating(false);
    }
  }

  return (
    <>
      <ul className="min-h-0 flex-1 overflow-y-auto px-4">
        {rows.map((row, index) => (
          <DraftRow
            // Строки не переставляются и не удаляются: номер их держит.
            // oxlint-disable-next-line react/no-array-index-key
            key={index}
            row={row}
            unchecked={unchecked}
            onChange={(changed) => setRows(rows.map((old, at) => (at === index ? changed : old)))}
          />
        ))}
      </ul>
      <footer className="flex shrink-0 items-center gap-3 border-t border-border-muted p-4">
        <p className="flex-1 text-[12px] text-text-muted">{t("youtrack.meeting.folder", { folder: MEETING_FOLDER })}</p>
        {failed && (
          <p role="alert" className="text-[12px] text-state-fg-danger">
            {t("youtrack.meeting.failed")}
          </p>
        )}
        <Button variant="submit" disabled={chosen.length === 0 || creating} onClick={() => void create()}>
          {t("youtrack.meeting.create", { number: chosen.length })}
        </Button>
      </footer>
    </>
  );
}

// «Задачи из встречи»: что предложил агент, списком черновиков. Отмеченные
// ложатся заметками в папку задач, публикуются они потом каждая из своей.
export function MeetingDrafts({ source, tasks, problem, paths, onCreate, onClose }: Props) {
  const { t } = useTranslation();
  const project = useDefaultProject();
  const people = useAssignees(project);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnRef = useRef<Element | null>(null);
  const unchecked = project === "" || people.isError;
  const title = t("youtrack.meeting.title", { title: noteTitle(source) });

  useEffect(() => {
    returnRef.current = document.activeElement;
    dialogRef.current?.showModal();
  }, []);

  // Фокус возвращается туда, где был до окна.
  function close() {
    dialogRef.current?.close();

    if (returnRef.current instanceof HTMLElement) {
      returnRef.current.focus();
    }

    onClose();
  }

  let body: ReactNode;

  if (problem !== null) {
    body = (
      <p role="alert" className="px-4 pb-4 text-state-fg-danger">
        {problem}
      </p>
    );
  } else if (tasks === null) {
    body = <output className="px-4 pb-4 text-text-muted">{t("youtrack.meeting.reading")}</output>;
  } else if (tasks.length === 0) {
    body = <p className="px-4 pb-4">{t("youtrack.meeting.empty")}</p>;
  } else if (!unchecked && people.isPending) {
    body = <output className="px-4 pb-4 text-text-muted">{t("youtrack.meeting.people")}</output>;
  } else {
    body = (
      <DraftRows
        source={source}
        paths={paths}
        onCreate={onCreate}
        tasks={tasks}
        people={people.data ?? []}
        project={project}
        unchecked={unchecked}
      />
    );
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label={title}
      className="fixed inset-x-0 top-[10vh] mx-auto flex max-h-[80vh] w-[min(760px,calc(100vw-32px))] flex-col overflow-hidden rounded-md bg-bg-layer-01 p-0 text-[13px] text-text-base shadow-overlay backdrop:bg-overlay-scrim"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className="flex shrink-0 items-start gap-2 p-4 pr-3">
        <h2 className="min-w-0 flex-1 truncate text-[15px]/5 font-medium">{title}</h2>
        <IconButton icon={Cancel01Icon} label={t("youtrack.meeting.close")} onClick={close} />
      </header>
      {body}
    </dialog>
  );
}
