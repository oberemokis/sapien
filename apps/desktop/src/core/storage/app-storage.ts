import { invoke } from "@tauri-apps/api/core";

// Кеши с текстом задач YouTrack. В localStorage они лежали бы открытым
// текстом в папке WebView, поэтому их держит Rust зашифрованными
// (src-tauri/src/window_store.rs). Окно читает их один раз до первой
// отрисовки, дальше работает с памятью, а изменения уходят в Rust пачкой.
const MOVED = ["sapien.youtrack.inbox", "sapien.youtrack.known", "sapien.youtrack.graphs"];

// Изменения копятся полсекунды: статусы задач приходят по одному, и на
// каждый переписывать файл незачем.
const FLUSH_DELAY = 500;

const items = new Map<string, string>();
const pending = new Map<string, string | null>();
let timer: ReturnType<typeof setTimeout> | undefined;

function flush() {
  timer = undefined;
  const changes = Object.fromEntries(pending);

  pending.clear();
  // Это кеш: без записи он только не переживёт перезапуск.
  void Promise.resolve()
    .then(() => invoke("window_store_write", { changes }))
    .catch(() => undefined);
}

function change(key: string, value: string | null) {
  pending.set(key, value);
  timer ??= setTimeout(flush, FLUSH_DELAY);
}

// Тот же вид, что у localStorage, чтобы хранилища устройства менялись
// одной строкой.
export const appStorage = {
  getItem(key: string) {
    return items.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    items.set(key, value);
    change(key, value);
  },
  removeItem(key: string) {
    items.delete(key);
    change(key, null);
  },
};

// Без ключа данных или без Rust кеш пуст, а окно всё равно открывается.
// Кеши прежних версий переезжают из localStorage сюда и там стираются.
export async function loadAppStorage() {
  try {
    const stored = await invoke<Record<string, string>>("window_store_read");

    for (const [key, value] of Object.entries(stored)) {
      items.set(key, value);
    }
  } catch {
    // Кеш начнётся заново.
  }

  for (const key of MOVED) {
    try {
      const old = localStorage.getItem(key);

      if (old !== null && !items.has(key)) {
        appStorage.setItem(key, old);
      }

      localStorage.removeItem(key);
    } catch {
      // Хранилище окна закрыто политикой: переносить нечего.
    }
  }
}

// Для тестов: память окна не переходит из теста в тест.
export function resetAppStorage() {
  clearTimeout(timer);
  timer = undefined;
  items.clear();
  pending.clear();
}
