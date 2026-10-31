import type { AgentModel } from "../model/chat";

const STORAGE_KEY = "sapien.agent.model";

// Хранилище окна бывает закрыто политикой: тогда выбор живёт до закрытия
// окна, а приложение не падает.
export function readAgentModel(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeAgentModel(model: AgentModel) {
  try {
    localStorage.setItem(STORAGE_KEY, model);
  } catch {
    // Выбор уже действует, без записи он только не переживёт перезапуск.
  }
}

// Сеть пропала или вернулась.
export function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);

  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function isOnline() {
  return navigator.onLine;
}
