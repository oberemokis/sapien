import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { ACTIONS_FOLDER, AgentChat, useActions, useAsk, useMeetingTasks } from "@/modules/agent";
import { MarkdownEditor } from "@/modules/editor";
import { showPanel, Workspace } from "@/modules/layout";
import { SettingsButton } from "@/modules/settings";
import {
  FileSearch,
  NoteTabs,
  NoteView,
  openNote,
  setTemplateValues,
  TagList,
  useActiveNote,
  useCreateNote,
  useFolderNotes,
  useNewFromTemplateSet,
  useNoteShown,
  useNoteTexts,
  useWriteNote,
  VaultGate,
  VaultTree,
} from "@/modules/vault";
import {
  BreakdownForm,
  Inbox,
  InboxLink,
  MEETING_FOLDER,
  MeetingDrafts,
  TASK_TEMPLATES,
  TaskDraftForm,
  useDefaultProject,
  useInbox,
  useIssueMentions,
  useYoutrackCheck,
} from "@/modules/youtrack";

export const Route = createFileRoute("/")({ component: Home });

const NO_NOTES: { text: string }[] = [];

// Поле имени нового файла и выбор файла живут в дереве: спрятанное дерево
// показывается.
function showFiles() {
  showPanel("files");
}

// Ход действия виден в чате: спрятанный чат показывается.
function showChat() {
  showPanel("chat");
}

function openDraft(path: string) {
  openNote(path, { focus: true });
}

// Редактор заметки, в котором номера задач YouTrack показывают статус.
function NoteEditor(props: ComponentProps<typeof MarkdownEditor>) {
  return <MarkdownEditor {...props} issues={useIssueMentions(props.value)} />;
}

// Над текстом заметки форма черновика задачи или разбивки. Связь на другой
// черновик встаёт номером его задачи, поэтому формам нужны тексты заметок
// хранилища. Разбивку пишет агент в чате, а черновики из неё и номера
// задач после «Опубликовать всё» кладёт хранилище.
function DraftAbove(props: { path: string; text: string; readOnly: boolean; onChange: (text: string) => void }) {
  const notes = useNoteTexts() ?? [];
  const ask = useAsk();
  const write = useWriteNote();
  const create = useCreateNote();

  function breakdown(task: string) {
    showChat();
    ask(task, { path: props.path, selection: "" });
  }

  async function createDrafts(folder: string, drafts: { name: string; text: string }[]) {
    const paths: string[] = [];

    for (const draft of drafts) {
      // oxlint-disable-next-line no-await-in-loop -- папку создаёт первый черновик
      paths.push(await create.mutateAsync({ folder, ...draft }));
    }

    return paths;
  }

  return (
    <>
      <TaskDraftForm {...props} notes={notes} onOpen={openDraft} onBreakdown={breakdown} onWrite={write} />
      <BreakdownForm
        text={props.text}
        readOnly={props.readOnly}
        notes={notes}
        onCreate={createDrafts}
        onOpen={openDraft}
      />
    </>
  );
}

type MeetingProps = Pick<ComponentProps<typeof MeetingDrafts>, "tasks" | "problem" | "onClose"> & { path: string };

// Черновики из встречи: предлагает агент, кладёт хранилище. Имя нового
// черновика сверяется с заметками, поэтому их тексты читаются, только
// пока окно открыто. После создания открывается первый черновик.
function MeetingWindow({ path, tasks, problem, onClose }: MeetingProps) {
  const notes = useNoteTexts();
  const create = useCreateNote();

  async function createDrafts(drafts: { name: string; text: string }[]) {
    const paths: string[] = [];

    for (const draft of drafts) {
      // oxlint-disable-next-line no-await-in-loop -- папку задач создаёт первый черновик
      paths.push(await create.mutateAsync({ folder: MEETING_FOLDER, ...draft }));
    }

    onClose();

    if (paths[0] !== undefined) {
      openDraft(paths[0]);
    }
  }

  return (
    <MeetingDrafts
      source={path}
      tasks={tasks}
      problem={problem}
      paths={(notes ?? []).map((note) => note.path)}
      onCreate={createDrafts}
      onClose={onClose}
    />
  );
}

function Home() {
  const { t } = useTranslation();
  // Агент видит, что открыто и выделено: хранилище это знает, чат спрашивает.
  // Заметку из папки, закрытой для агента, чат не видит вовсе.
  const active = useActiveNote();
  const note = active.closed ? { path: null, selection: "" } : active;
  // Действия это заметки хранилища, а нужна ли им интеграция, знает её модуль.
  const youtrack = useYoutrackCheck();
  const check = useMemo(() => ({ youtrack }), [youtrack]);
  const actions = useActions({ notes: useFolderNotes(ACTIONS_FOLDER), context: note, check, onRun: showChat });
  // «Новая задача» это новый файл из шаблонов задач, а {{project}} в них
  // это проект по умолчанию из настроек YouTrack.
  const newTask = useNewFromTemplateSet(TASK_TEMPLATES);
  const project = useDefaultProject();
  const meeting = useMeetingTasks();
  const [meetingPath, setMeetingPath] = useState<string | null>(null);
  // Лента по задачам из запроса и черновиков. «Входящие» открыты, пока
  // человек не откроет заметку: тогда дерево отдаёт новую открытую.
  const inbox = useInbox(useNoteTexts() ?? NO_NOTES);
  const shown = useNoteShown();
  const [inboxOver, setInboxOver] = useState<typeof shown | undefined>(undefined);
  const inboxOpen = inboxOver === shown;
  const ask = useAsk();

  function askAbout(prompt: string) {
    showChat();
    ask(prompt, { path: null, selection: "" });
  }

  useEffect(() => {
    setTemplateValues({ project });
  }, [project]);

  function createMenu(parent: string) {
    return [{ label: t("youtrack.newTask"), onSelect: () => void newTask(parent) }];
  }

  function closeMeeting() {
    setMeetingPath(null);
    meeting.reset();
  }

  // Действие из меню заметки в дереве работает с ней, а не с открытой.
  // Агенту нужна сеть, без неё пункты видны, но недоступны.
  function noteMenu(path: string) {
    const offline = actions.online ? undefined : t("agent.actions.offline");
    const fromMeeting = {
      label: t("youtrack.meeting.run"),
      disabled: !actions.online,
      hint: offline,
      onSelect: () => {
        setMeetingPath(path);
        meeting.run(path);
      },
    };

    return [
      fromMeeting,
      ...actions.actions.map((action) => ({
        label: action.name,
        disabled: !actions.online,
        hint: offline,
        onSelect: () => void actions.run(action, { path, selection: path === note.path ? note.selection : "" }),
      })),
    ];
  }

  let meetingProblem: string | null = null;

  if (meeting.problem !== null) {
    meetingProblem = t(`agent.problems.${meeting.problem}`);
  }

  return (
    <>
      <Workspace
        files={
          <>
            <VaultTree
              onCreateStart={showFiles}
              noteMenu={noteMenu}
              createMenu={createMenu}
              nav={
                inbox.connected && <InboxLink inbox={inbox} active={inboxOpen} onOpen={() => setInboxOver(shown)} />
              }
            />
            <TagList />
          </>
        }
        title={<NoteTabs onCreateStart={showFiles} />}
        main={
          <VaultGate>
            {inboxOpen ? (
              <Inbox inbox={inbox} onAsk={askAbout} />
            ) : (
              <NoteView editor={NoteEditor} showFiles={showFiles} above={DraftAbove} />
            )}
          </VaultGate>
        }
        chat={<AgentChat context={note} actions={actions} />}
        actions={<SettingsButton />}
      />
      <FileSearch />
      {meetingPath !== null && (
        <MeetingWindow path={meetingPath} tasks={meeting.tasks} problem={meetingProblem} onClose={closeMeeting} />
      )}
    </>
  );
}
