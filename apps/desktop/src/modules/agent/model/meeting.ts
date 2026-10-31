// Действие со встречи, которое предлагает агент, как MeetingTask
// в domain.rs. assignee это имя, как его назвали на встрече, due это дата
// ГГГГ-ММ-ДД или пусто, issues это номера задач YouTrack.
export type MeetingTask = {
  summary: string;
  description: string;
  assignee: string;
  due: string;
  issues: string[];
  quote: string;
};
