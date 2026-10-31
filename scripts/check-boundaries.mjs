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

// Пакет и любой его подпуть: «hono» закрывает и «hono/client».
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

// Домену открыты zod и соседние файлы его же domain. Сосед считается по месту
// файла, а не по виду пути: «../domain/x» из domain/sub остаётся внутри,
// «../ports» уже нет.
function isDomainImport(spec, file) {
  if (isPackage(spec, ["zod"])) {
    return true;
  }

  if (!spec.startsWith(".")) {
    return false;
  }

  const marker = `${sep}domain${sep}`;
  const domain = resolve(file.slice(0, file.indexOf(marker) + marker.length));
  const target = resolve(dirname(file), spec);

  return target === domain || target.startsWith(`${domain}${sep}`);
}

// Куда ведёт импорт: «@/modules/social/ports» и «../../social/ports» означают
// одно и то же, поэтому псевдоним и относительный путь сводятся к одной паре
// «модуль плюс остаток». Псевдонимов два: desktop и mobile резолвят через
// tsconfig и пишут «@/modules», api через imports пакета и пишет «#modules»,
// потому что Node запрещает внутренние подпути вида «#/».
function targetOf(spec, file) {
  const alias = /^(?:@\/|#)modules\/(.+)$/.exec(spec);

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
// сценарию адаптеры закрыты, как бы он их ни назвал.
function reachesIntoLayer(spec, layers) {
  const inside = new RegExp(`(^|/)(${layers})(/|$)`);
  const own = new RegExp(`^(?:@/|#)modules/[^/]+/(${layers})(/|$)`);

  if (own.test(spec)) {
    return true;
  }

  return spec.startsWith("..") && inside.test(spec);
}

// Импорт и реэкспорт: дверь модуля отдаёт наружу через `export … from`, и
// реэкспорт чужих внутренностей открывает их так же, как импорт.
const IMPORT =
  /(?:^|\n)\s*(?:import\s+(type\s+)?[^;]*?|export\s+(type\s+)?(?:\*|\{)[^;]*?)from\s+["']([^"']+)["']/g;

// Приложения с интерфейсом: окно Tauri и телефон. Слои у них общие.
const UI = "apps/{desktop,mobile}";

const rules = [
  {
    name: "интерфейс видит api только по типу",
    files: `${UI}/src/**/*.{ts,tsx}`,
    forbidden: (spec, isType) => spec === "@sapien/api" && !isType,
    hint: "значимый импорт тащит сервер в бандл приложения",
  },
  {
    // Псевдонимов у api два вида: «#modules/x» и «#app/x», у интерфейса
    // «@/modules/x» и «@/app/x». Решётка ловится наравне с косой чертой.
    name: "core не знает модулей и сборки приложения",
    files: "apps/*/src/core/**/*.{ts,tsx}",
    forbidden: (spec) => /(^|\/|#)(modules|app)\//.test(spec),
    hint: "инфраструктура не должна знать домен",
  },
  {
    name: "сосед берётся через index модуля",
    files: "apps/*/src/**/*.{ts,tsx}",
    forbidden: (spec, _isType, file) => reachesIntoNeighbour(spec, file),
    hint: "внутренности чужого модуля закрыты, наружу смотрит только index.ts",
  },
  {
    // Тест домена исключён: ему нужен vitest.
    name: "домен знает только zod и свой domain",
    files: "apps/api/src/modules/*/domain/**/*.ts",
    forbidden: (spec, _isType, file) =>
      !isSpec(file) && !isDomainImport(spec, file),
    hint: "домен лежит на дне модуля и проверяется без сети и ядра",
  },
  {
    name: "сценарий не знает адаптеров и транспорта",
    files: "apps/api/src/modules/*/use-case/**/*.ts",
    forbidden: (spec) => reachesIntoLayer(spec, "infrastructure|transport"),
    hint: "сценарий работает с портом, а не с реализацией",
  },
  {
    name: "сценарий не знает протокола",
    files: "apps/api/src/modules/*/use-case/**/*.ts",
    forbidden: (spec) => isPackage(spec, ["hono", "@hono"]),
    hint: "запрос и ответ остаются в транспорте, сценарию приходит вход",
  },
  {
    // Список сценариев собирает service.ts: транспорт, позвавший сценарий
    // напрямую, получает его без портов, которые service уже связал.
    name: "транспорт зовёт сценарии через service",
    files: "apps/api/src/modules/*/transport/**/*.ts",
    forbidden: (spec) => reachesIntoLayer(spec, "use-case"),
    hint: "транспорт берёт готовый сервис, а не отдельный сценарий",
  },
  {
    name: "адаптер не знает сценариев и транспорта",
    files: "apps/api/src/modules/*/infrastructure/**/*.ts",
    forbidden: (spec) => reachesIntoLayer(spec, "use-case|transport"),
    hint: "адаптер выполняет порт, а кто его зовёт, он знать не должен",
  },
  {
    // Сборка модуля живёт в index.ts, и только ему позволено видеть адаптеры:
    // порты и список сценариев обязаны обходиться портами, иначе подменить
    // границу в тесте нечем.
    name: "порты и сервис не знают адаптеров",
    files: "apps/api/src/modules/*/*.ts",
    forbidden: (spec, _isType, file) =>
      !file.endsWith("/index.ts") &&
      (/\.\/(infrastructure|transport)(\/|$)/.test(spec) ||
        reachesIntoLayer(spec, "infrastructure|transport")),
    hint: "адаптеры собирает index.ts, он и есть дверь модуля",
  },
  {
    // Словари и расчёты не должны знать ни про сеть, ни про Rust, ни про
    // экран: их проверяют без окна, а компонент подставляет им уже готовые
    // данные. Тип из react модели не мешает: в сборку он не попадает и
    // хуков с разметкой в модель не приносит.
    name: "модель не знает ни запросов, ни разметки",
    files: `${UI}/src/modules/*/model/**/*.ts`,
    forbidden: (spec, isType) =>
      spec.startsWith("@/core/api/") ||
      /\.\.\/(interactions|infrastructure|flows|components|ui)(\/|$)/.test(spec) ||
      (!isType &&
        (isTauri(spec) ||
          /^expo(-|\/|$)/.test(spec) ||
          isPackage(spec, [
            "react",
            "react-dom",
            "react-native",
            "@tanstack",
            "hono",
          ]))),
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
    name: "api и Tauri живут в infrastructure",
    files: `${UI}/src/**/*.{ts,tsx}`,
    forbidden: (spec, isType, file) =>
      !isType &&
      !isSpec(file) &&
      !/^apps\/[^/]+\/src\/(core|modules\/[^/]+\/infrastructure)\//.test(
        file,
      ) &&
      (isTauri(spec) ||
        isPackage(spec, ["hono"]) ||
        clientTargetOf(spec, file) === "core/api/client"),
    hint: "выше infrastructure ходят за данными модуля, а не за маршрутом или командой",
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
