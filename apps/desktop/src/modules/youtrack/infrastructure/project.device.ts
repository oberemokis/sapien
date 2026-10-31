const STORAGE_KEY = "sapien.youtrack.project";

// Хранилище окна бывает закрыто политикой: тогда проекта по умолчанию нет,
// а приложение не падает.
export function readDefaultProject() {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeDefaultProject(project: string) {
  try {
    localStorage.setItem(STORAGE_KEY, project);
  } catch {
    // Проект уже в окне, без записи он только не переживёт перезапуск.
  }
}
