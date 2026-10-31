import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/ui/button";
import { breakdownNotes, parseBreakdown } from "../model/breakdown";
import { noteTitle, parseDraft, type LinkedNote } from "../model/draft";
import { Alert } from "./alert";

type Props = {
  text: string;
  notes: LinkedNote[];
  readOnly: boolean;
  // Кладёт заметки в папку. Ответ это их пути.
  onCreate: (folder: string, notes: { name: string; text: string }[]) => Promise<string[]>;
  onOpen: (path: string) => void;
};

// Над заметкой-разбивкой: что из неё выйдет и «Создать черновики». Правится
// сама разбивка текстом заметки, руками или агентом в чате. Пока в ней есть
// строки, которые не разобрались, черновики не создаются: связи по номерам
// ушли бы не туда.
export function BreakdownForm({ text, notes, readOnly, onCreate, onOpen }: Props) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const { epic, tasks, problems } = parseBreakdown(text);

  if (epic === null) {
    return null;
  }

  const epicNote = notes.find((note) => note.path === epic);
  let epicDraft = null;

  if (epicNote !== undefined) {
    epicDraft = parseDraft(epicNote.text, noteTitle(epic));
  }

  const plan = epicDraft === null ? null : breakdownNotes(epic, epicDraft, tasks, notes);
  const count = plan?.create.length ?? 0;

  async function create() {
    if (plan === null) {
      return;
    }

    setCreating(true);
    setFailed(false);
    setCreated(null);

    try {
      setCreated((await onCreate(plan.folder, plan.create)).length);
    } catch {
      setFailed(true);
    }

    setCreating(false);
  }

  return (
    <section
      aria-label={t("youtrack.breakdown.title", { title: noteTitle(epic) })}
      className="mx-4 mb-2 flex shrink-0 flex-col gap-2 rounded-md border border-stroke px-3 py-2 text-[13px]"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-medium">{t("youtrack.breakdown.title", { title: noteTitle(epic) })}</h2>
        <span className="text-content/60">
          {t("youtrack.breakdown.count", { tasks: tasks.length, existing: plan?.existing ?? 0 })}
        </span>
        <div className="ml-auto flex gap-2">
          <Button disabled={epicNote === undefined} onClick={() => onOpen(epic)}>
            {t("youtrack.check.open", { title: noteTitle(epic) })}
          </Button>
          <Button disabled={readOnly || plan === null || problems.length > 0 || count === 0 || creating} onClick={() => void create()}>
            {t("youtrack.breakdown.create", { number: count })}
          </Button>
        </div>
      </div>
      <p className="text-content/60">{t("youtrack.breakdown.hint")}</p>
      {plan === null && <Alert>{t("youtrack.breakdown.noEpic", { epic })}</Alert>}
      {problems.length > 0 && (
        <Alert>
          <ul className="flex flex-col gap-0.5">
            {problems.map(({ code, line }) => (
              <li key={`${code}:${line}`}>
                «{line.trim()}»: {t(`youtrack.breakdown.problems.${code}`)}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {failed && <Alert>{t("youtrack.breakdown.failed")}</Alert>}
      {created !== null && (
        <output className="text-content/60">
          {t("youtrack.breakdown.created", { number: created, title: noteTitle(epic) })}
        </output>
      )}
    </section>
  );
}
