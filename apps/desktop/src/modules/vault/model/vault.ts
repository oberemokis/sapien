// Ответы команд Rust из src-tauri/src/modules/vault. Формы держатся руками:
// поменял там, поменяй здесь.
export type VaultStatus =
  | { kind: "none" }
  | { kind: "missing"; path: string }
  | { kind: "ready"; path: string };

export type VaultEntry =
  | { kind: "folder"; name: string; path: string; children: VaultEntry[] }
  | { kind: "note"; name: string; path: string };

// Заметка в дереве показывается без расширения, как в Obsidian.
export function noteTitle(name: string) {
  return name.replace(/\.md$/i, "");
}
