#!/usr/bin/env node
// Границы между доменами, которых не ловят сборка и Cargo
// (docs/architecture.md, «Границы между доменами»). Соседа без записи
// в package.json pnpm и так не находит. Здесь проверяется то, что идёт
// мимо: сама запись соседа, команды Rust из общего для всех @sapien/ipc
// и доменные крейты в крейте приложения, который зависит от всех сразу.

import { globSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));

// Команды без домена: их зовёт любой экран. Новая попадает сюда только
// с причиной.
const SHARED_COMMANDS = new Map([["openLink", "ссылку в браузер системы открывает Rust для любого экрана"]]);

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

const APP_RUST = "apps/desktop/src-tauri/src";

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function crateName(manifest) {
  return /^name\s*=\s*"([^"]+)"/m.exec(readFileSync(manifest, "utf8"))?.[1];
}

// Домен это папка в domains/: пакет по имени и папка, с которой
// сверяются команды.
const DOMAINS = globSync("domains/*/package.json").map((file) => ({
  folder: dirname(file).slice("domains/".length),
  name: readJson(file).name,
}));

const DOMAIN_PACKAGES = new Set(DOMAINS.map((domain) => domain.name));

// Доменный крейт это всё в crates/, кроме ядра.
const DOMAIN_CRATES = new Set(
  globSync("crates/*/Cargo.toml")
    .map(crateName)
    .filter((name) => name !== "sapien-kernel"),
);

const failures = [];

function fail(file, found, rule) {
  failures.push(`${file}: ${found}\n  ${rule}`);
}

// Пакеты @sapien из всех списков зависимостей.
function sapienDependencies(file) {
  const manifest = readJson(file);

  return DEPENDENCY_FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {})).filter((name) =>
    name.startsWith("@sapien/"),
  );
}

// Зависимости sapien-* из Cargo.toml: строкой `sapien-x.workspace = true`
// и таблицей `[dependencies.sapien-x]`.
function crateDependencies(file) {
  const text = readFileSync(file, "utf8");

  return [...text.matchAll(/^\s*(?:\[[\w.-]*dependencies\.)?(sapien-[\w-]+)/gm)].map(([, name]) => name);
}

// В bindings.gen.ts имя команды стоит в camelCase: forge_connect
// становится forgeConnect, папка domains/some-domain даёт someDomain.
function ownedBy(folder, name) {
  const prefix = folder.replace(/-(\w)/g, (_, letter) => letter.toUpperCase());

  return name === prefix || new RegExp(`^${prefix}[A-Z0-9]`).test(name);
}

for (const domain of DOMAINS) {
  const file = `domains/${domain.folder}/package.json`;

  for (const dependency of sapienDependencies(file)) {
    if (DOMAIN_PACKAGES.has(dependency) && dependency !== domain.name) {
      fail(file, dependency, "домен не знает соседа: связь двух доменов собирает страница окна, общее уходит в packages/");
    }
  }
}

for (const file of globSync("packages/*/package.json")) {
  for (const dependency of sapienDependencies(file)) {
    if (DOMAIN_PACKAGES.has(dependency)) {
      fail(file, dependency, "общий пакет не знает доменов: иначе через него домены узнали бы друг друга");
    }
  }
}

for (const file of globSync("crates/*/Cargo.toml")) {
  const own = crateName(file);

  for (const dependency of crateDependencies(file)) {
    if (DOMAIN_CRATES.has(dependency) && dependency !== own) {
      fail(file, dependency, "крейт не знает доменных крейтов: общее уходит в sapien-kernel");
    }
  }
}

// Что из Rust зовёт код домена: команды и события из @sapien/ipc,
// а в тестах ещё обработчики и отказы подделки fakeRust.
const RUST_CALLS = [
  { pattern: /\bcommands\.(\w+)/g, shared: SHARED_COMMANDS },
  { pattern: /\bevents\.(\w+)/g, shared: new Map() },
  { pattern: /\.calls\.(\w+)/g, shared: SHARED_COMMANDS },
  { pattern: /\.(?:refuse|handle)\(\s*["'](\w+)["']/g, shared: SHARED_COMMANDS },
];

for (const domain of DOMAINS) {
  for (const file of globSync(`domains/${domain.folder}/src/**/*.{ts,tsx}`)) {
    const source = readFileSync(file, "utf8");

    for (const { pattern, shared } of RUST_CALLS) {
      for (const [found, name] of source.matchAll(pattern)) {
        if (!ownedBy(domain.folder, name) && !shared.has(name)) {
          fail(
            file,
            found,
            `домен зовёт только свои команды и события Rust (${domain.folder}_*) и общие из SHARED_COMMANDS в scripts/check-boundaries.mjs`,
          );
        }
      }
    }
  }
}

// Крейт приложения зависит от всех доменных, поэтому Cargo пропускает
// чужой крейт в файле команд. Доменный крейт называют только корень
// композиции и файл команд своего домена.
for (const file of globSync(`${APP_RUST}/**/*.rs`)) {
  const path = file.slice(APP_RUST.length + 1);
  const commandsOf = /^commands\/(\w+)\.rs$/.exec(path)?.[1];
  const ownCrate = commandsOf && `sapien-${commandsOf.replaceAll("_", "-")}`;
  const source = readFileSync(file, "utf8");

  for (const [found] of source.matchAll(/\bsapien_\w+/g)) {
    const crate = found.replaceAll("_", "-");

    if (DOMAIN_CRATES.has(crate) && path !== "lib.rs" && crate !== ownCrate) {
      fail(file, found, "доменный крейт берут только lib.rs и commands/<домен>.rs своего домена");
    }
  }

  if (commandsOf === undefined || commandsOf === "mod") {
    continue;
  }

  for (const [found, module] of source.matchAll(/\bcrate::(\w+)/g)) {
    if (module !== "events") {
      fail(file, found, "файл команд берёт из крейта приложения только crate::events: остальное принадлежит окну или чужому домену");
    }
  }

  for (const [, name] of source.matchAll(/#\[tauri::command\][\s\S]*?\bfn\s+(\w+)/g)) {
    if (!name.startsWith(`${commandsOf}_`)) {
      fail(file, name, `команда начинается с имени своего домена: ${commandsOf}_*`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`\nнарушений границ доменов: ${failures.length}`);
  process.exit(1);
}

console.log("границы доменов в порядке");
