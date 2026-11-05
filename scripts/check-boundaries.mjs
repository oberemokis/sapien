#!/usr/bin/env node
// Проверяет направление зависимостей, описанное в docs/architecture.md.
// Граф пакетов и слои внутри приложений компилятор не проверяет: TypeScript
// одинаково пропускает и импорт вниз, и импорт наверх. Без этой проверки
// правило живёт только в документе.

import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

// Путь считается от src того приложения, в котором лежит файл.
function appOf(file) {
  return file.split("/").slice(0, 2).join("/");
}

function srcOf(file) {
  return resolve(appOf(file), "src");
}

function modulesRootFor(file) {
  return resolve(srcOf(file), "modules");
}

function isSpec(file) {
  return /\.spec\.tsx?$/.test(file);
}

// Пакет и любой его подпуть: «react» закрывает и «react/jsx-runtime».
function isPackage(spec, names) {
  return names.some((name) => spec === name || spec.startsWith(`${name}/`));
}

// Мост в Rust: invoke, события, окна и плагины Tauri.
function isTauri(spec) {
  return (
    isPackage(spec, ["@tauri-apps/api"]) ||
    spec.startsWith("@tauri-apps/plugin-")
  );
}

// Куда ведёт импорт внутри src интерфейса:
// «@/modules/auth/infrastructure/auth.api» и «../infrastructure/auth.api» из
// компонента auth это один и тот же файл, поэтому оба сводятся к пути от src.
// Пакеты дают null.
function clientTargetOf(spec, file) {
  if (spec.startsWith("@/")) {
    return spec.slice(2);
  }

  if (!spec.startsWith(".")) {
    return null;
  }

  return relative(srcOf(file), resolve(dirname(file), spec))
    .split(sep)
    .join("/");
}

// Куда ведёт импорт: «@/modules/social/model» и «../../social/model» означают
// одно и то же, поэтому псевдоним и относительный путь сводятся к одной паре
// «модуль плюс остаток».
function targetOf(spec, file) {
  const alias = /^@\/modules\/(.+)$/.exec(spec);

  if (alias !== null) {
    const [targetModule, ...rest] = alias[1].split("/");

    return { targetModule, rest: rest.join("/") };
  }

  if (!spec.startsWith(".")) {
    return null;
  }

  const root = modulesRootFor(file);
  const targetRel = relative(root, resolve(dirname(file), spec));

  if (targetRel.startsWith("..")) {
    return null;
  }

  const [targetModule, ...rest] = targetRel.split(sep);

  return { targetModule, rest: rest.join("/") };
}

// Внутренности чужого модуля закрыты: снаружи модуль это его index.ts. Тест
// исключён намеренно, он подменяет границу процесса и обязан знать, какой файл
// её держит.
function reachesIntoNeighbour(spec, file) {
  const target = targetOf(spec, file);

  if (target === null || isSpec(file)) {
    return false;
  }

  const [ownModule] = relative(modulesRootFor(file), resolve(file)).split(sep);

  if (target.targetModule === ownModule) {
    return false;
  }

  return target.rest.length > 0 && target.rest !== "index";
}

// Свой же модуль по псевдониму адресовать можно, но слой это не отменяет:
// interactions экран закрыт, как бы они его ни назвали.
function reachesIntoLayer(spec, layers) {
  const inside = new RegExp(`(^|/)(${layers})(/|$)`);
  const own = new RegExp(`^@/modules/[^/]+/(${layers})(/|$)`);

  if (own.test(spec)) {
    return true;
  }

  return spec.startsWith("..") && inside.test(spec);
}

// Импорт и реэкспорт: дверь модуля отдаёт наружу через `export … from`, и
// реэкспорт чужих внутренностей открывает их так же, как импорт.
const IMPORT =
  /(?:^|\n)\s*(?:import\s+(type\s+)?[^;]*?|export\s+(type\s+)?(?:\*|\{)[^;]*?)from\s+["']([^"']+)["']/g;

// Приложение с интерфейсом: окно Tauri.
const UI = "apps/desktop";

const rules = [
  {
    name: "core не знает модулей и сборки приложения",
    files: `${UI}/src/core/**/*.{ts,tsx}`,
    forbidden: (spec) => /(^|\/)(modules|app)\//.test(spec),
    hint: "инфраструктура не должна знать домен",
  },
  {
    name: "сосед берётся через index модуля",
    files: `${UI}/src/**/*.{ts,tsx}`,
    forbidden: (spec, _isType, file) => reachesIntoNeighbour(spec, file),
    hint: "внутренности чужого модуля закрыты, наружу смотрит только index.ts",
  },
  {
    // Словари и расчёты не должны знать ни про сеть, ни про Rust, ни про
    // экран: их проверяют без окна, а компонент подставляет им уже готовые
    // данные. Тип из react модели не мешает: в сборку он не попадает и
    // хуков с разметкой в модель не приносит.
    name: "модель не знает ни запросов, ни разметки",
    files: `${UI}/src/modules/*/model/**/*.ts`,
    forbidden: (spec, isType) =>
      /\.\.\/(interactions|infrastructure|flows|components|ui)(\/|$)/.test(spec) ||
      (!isType &&
        (isTauri(spec) || isPackage(spec, ["react", "react-dom", "@tanstack"]))),
    hint: "модель это правила показа, данные ей приносят",
  },
  {
    name: "ui модуля не знает остальных слоёв",
    files: `${UI}/src/modules/*/ui/**/*.{ts,tsx}`,
    forbidden: (spec) =>
      reachesIntoLayer(
        spec,
        "model|interactions|flows|components|infrastructure",
      ),
    hint: "ui это вид без домена: данные и подписи ему приносят пропсами",
  },
  {
    name: "interactions не знают экрана",
    files: `${UI}/src/modules/*/interactions/**/*.ts`,
    forbidden: (spec) => reachesIntoLayer(spec, "flows|components|ui"),
    hint: "кеш и запросы лежат под экраном, а не над ним",
  },
  {
    // Тест исключён: он подменяет Rust через mockIPC и шлёт его события,
    // то есть сам стоит на границе процесса.
    name: "Tauri живёт в infrastructure",
    files: `${UI}/src/**/*.{ts,tsx}`,
    forbidden: (spec, isType, file) =>
      !isType &&
      !isSpec(file) &&
      !/^apps\/[^/]+\/src\/(core|modules\/[^/]+\/infrastructure)\//.test(
        file,
      ) &&
      isTauri(spec),
    hint: "выше infrastructure ходят за данными модуля, а не за командой",
  },
  {
    // Команды и события Rust зовут interactions: кеш запросов и подписки
    // живут там. Тип из пакета годится любому слою, в сборку он не попадает.
    name: "команды Rust зовут interactions",
    files: `${UI}/src/**/*.{ts,tsx}`,
    forbidden: (spec, isType, file) =>
      !isType &&
      !isSpec(file) &&
      !/^apps\/[^/]+\/src\/(core|modules\/[^/]+\/(interactions|infrastructure))\//.test(
        file,
      ) &&
      isPackage(spec, ["@sapien/ipc"]),
    hint: "экран и модель получают данные из interactions",
  },
  {
    // Подделку Rust ставят тесты и dev:web. Импорт в остальном коде унёс бы
    // её в сборку приложения.
    name: "подделка Rust только в тестах и dev:web",
    files: `${UI}/src/**/*.{ts,tsx}`,
    forbidden: (spec, _isType, file) =>
      !isSpec(file) &&
      !/\/src\/core\/rust\//.test(file) &&
      isPackage(spec, ["@sapien/ipc/fake"]),
    hint: "подделку ставит core/rust/browser.ts, остальному коду она не нужна",
  },
  {
    // Тест исключён по той же причине, что и у соседей: он подменяет границу
    // процесса и знает, какой файл её держит.
    name: "экран не ходит в infrastructure",
    files: `${UI}/src/{app,pages,modules/*/components}/**/*.{ts,tsx}`,
    forbidden: (spec, _isType, file) =>
      !isSpec(file) &&
      /^modules\/[^/]+\/infrastructure(\/|$)/.test(
        clientTargetOf(spec, file) ?? "",
      ),
    hint: "компонент берёт данные из interactions, сеть и Rust лежат под ними",
  },
];

let failed = 0;

for (const rule of rules) {
  const files = globSync(rule.files, { cwd: process.cwd() });

  for (const file of files) {
    const source = readFileSync(file, "utf8");

    for (const [, importType, exportType, spec] of source.matchAll(IMPORT)) {
      if (rule.forbidden(spec, Boolean(importType ?? exportType), file)) {
        console.error(`${file}: ${spec}\n  ${rule.name}: ${rule.hint}`);
        failed += 1;
      }
    }
  }
}

if (failed > 0) {
  console.error(`\nнарушений границ: ${failed}`);
  process.exit(1);
}

console.log("границы в порядке");
