// Команды, события и типы окна из Rust. Сами они в bindings.gen.ts, его
// пишет тест Rust. Отказ команды бросается значением AppError.
//
// У типов, которые Rust и читает, и пишет, генератор даёт две формы.
// Окно получает форму ответа Rust, она и идёт под обычным именем.
// Исключение Progress: его шлёт канал, а канал генератор описывает
// формой аргумента команды, где total может не прийти.
export { commands, events } from "./bindings.gen.ts";
// Канал, в который Rust шлёт поток: вывод терминала, ход загрузки.
export { Channel } from "@tauri-apps/api/core";
export type {
  AgentsCode,
  AppError_Serialize as AppError,
  Available_Serialize as Available,
  ClaudeState,
  ClaudeStatus_Serialize as ClaudeStatus,
  ErrorKind,
  Forge,
  ForgeCode,
  ForgeStatus,
  ForgeStatuses_Serialize as ForgeStatuses,
  Integration,
  IntegrationState,
  LanguageCode,
  LinkCode,
  PaneAgent,
  Progress_Deserialize as Progress,
  Project,
  ProjectsCode,
  SessionInfo_Serialize as SessionInfo,
  SessionsCode,
  TerminalCode,
  TerminalExited,
  UnlockCode,
  UpdateCode,
} from "./bindings.gen.ts";
