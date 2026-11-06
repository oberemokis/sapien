// Подделка Rust для pnpm dev:web. Режимы задаёт хеш адреса через запятую,
// смена хеша требует перезагрузки:
//
//   #down           GitHub и GitLab не отвечают
//   #unlock-failed  первая проверка при разблокировке не проходит
//   #latest         новой версии нет, карточка обновления не закрывает угол
import { fakeRust } from "./rust.ts";

const NOTES =
  "## What's Changed\n* feat: приложение для работы с агентами by @oberemokis in https://github.com/oberemokis/sapien/pull/113";

export function browserRust(hash: string) {
  const modes = new Set(hash.replace(/^#/, "").split(","));
  const rust = fakeRust({ delay: 20, state: { update: { version: "0.2.0", notes: NOTES } } });

  if (modes.has("latest")) {
    rust.state.update = null;
  }

  if (modes.has("down")) {
    rust.refuse("forgeConnect", { kind: "unavailable", code: "forge_unreachable" });
  }

  if (modes.has("unlock-failed")) {
    rust.refuse("appUnlock", { kind: "invalid", code: "unlock_failed" }, 1);
  }

  return rust;
}
