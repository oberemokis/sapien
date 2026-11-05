//! Интеграции агентов: хук или расширение в настройках агента, которое
//! сообщает sapien разговор панели. Ставит и снимает их человек
//! в настройках приложения. Свои настройки агента человек не теряет: хук
//! дописывается рядом с остальными, а снимается только свой.

use super::domain::{Integration, IntegrationState};
use sapien_kernel::{AppError, durable};
use serde_json::{Value, json};
use std::ffi::OsString;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

/// Куда агент смотрит за интеграцией.
enum Kind {
    /// Хук в JSON настроек агента. `flat`: запись хука это сама команда,
    /// как у Cursor, а не список команд под условием, как у Claude Code.
    Hook {
        file: &'static str,
        event: &'static str,
        flat: bool,
    },
    /// Свой файл в папке, которую агент читает сам.
    File {
        path: &'static str,
        content: &'static str,
    },
}

/// Агент и папка его настроек: переменная окружения агента или папка
/// в домашней.
struct Target {
    agent: &'static str,
    env: &'static str,
    dir: &'static str,
    kind: Kind,
}

const TARGETS: [Target; 5] = [
    Target {
        agent: "claude",
        env: "CLAUDE_CONFIG_DIR",
        dir: ".claude",
        kind: Kind::Hook {
            file: "settings.json",
            event: "SessionStart",
            flat: false,
        },
    },
    Target {
        agent: "codex",
        env: "CODEX_HOME",
        dir: ".codex",
        kind: Kind::Hook {
            file: "hooks.json",
            event: "SessionStart",
            flat: false,
        },
    },
    Target {
        agent: "cursor",
        env: "CURSOR_CONFIG_DIR",
        dir: ".cursor",
        kind: Kind::Hook {
            file: "hooks.json",
            event: "sessionStart",
            flat: true,
        },
    },
    Target {
        agent: "pi",
        env: "PI_CODING_AGENT_DIR",
        dir: ".pi/agent",
        kind: Kind::File {
            path: "extensions/sapien.ts",
            content: include_str!("integrations/pi.ts"),
        },
    },
    Target {
        agent: "opencode",
        env: "OPENCODE_CONFIG_DIR",
        dir: ".config/opencode",
        kind: Kind::File {
            path: "plugins/sapien.js",
            content: include_str!("integrations/opencode.js"),
        },
    },
];

/// Команда хука. Вне sapien `SAPIEN_BIN` в окружении нет, и хук молча
/// ничего не делает.
fn command(agent: &str) -> String {
    format!(r#"[ -z "$SAPIEN_BIN" ] || "$SAPIEN_BIN" hook {agent}"#)
}

fn unwritable<T>(_: T) -> AppError {
    AppError::unavailable("integration_unwritable")
}

/// Интеграции агентов в папке `home`. `env`: переменные окружения, где
/// агент может держать папку настроек не в домашней.
pub struct Integrations {
    home: PathBuf,
    env: fn(&str) -> Option<OsString>,
}

impl Integrations {
    pub fn new(home: &Path) -> Self {
        Self {
            home: home.to_owned(),
            env: |name| std::env::var_os(name),
        }
    }

    fn dir(&self, target: &Target) -> PathBuf {
        (self.env)(target.env)
            .filter(|dir| !dir.is_empty())
            .map_or_else(|| self.home.join(target.dir), PathBuf::from)
    }

    fn target(agent: &str) -> Result<&'static Target, AppError> {
        TARGETS
            .iter()
            .find(|target| target.agent == agent)
            .ok_or(AppError::invalid("integration_unknown"))
    }

    fn state(&self, target: &Target) -> IntegrationState {
        let dir = self.dir(target);

        if !dir.is_dir() {
            return IntegrationState::Missing;
        }

        let on = match target.kind {
            Kind::Hook { file, event, flat } => read(&dir.join(file))
                .is_ok_and(|config| has_hook(&config, event, flat, &command(target.agent))),
            Kind::File { path, .. } => dir.join(path).is_file(),
        };

        if on {
            IntegrationState::On
        } else {
            IntegrationState::Off
        }
    }

    pub fn list(&self) -> Vec<Integration> {
        TARGETS
            .iter()
            .map(|target| Integration {
                agent: target.agent,
                state: self.state(target),
            })
            .collect()
    }

    /// Ставит интеграцию агента `agent`. Агента нет, значит,
    /// `integration_agent_missing`: папку его настроек sapien не заводит.
    /// Поставленная уже интеграция ставится заново поверх.
    pub fn install(&self, agent: &str) -> Result<(), AppError> {
        let target = Self::target(agent)?;
        let dir = self.dir(target);

        if !dir.is_dir() {
            return Err(AppError::not_found("integration_agent_missing"));
        }

        match target.kind {
            Kind::Hook { file, event, flat } => {
                let file = dir.join(file);
                let config = with_hook(read(&file)?, event, flat, &command(agent))?;

                write(&file, &config)
            }
            Kind::File { path, content } => {
                let file = dir.join(path);

                fs::create_dir_all(file.parent().unwrap_or(&dir)).map_err(unwritable)?;
                durable::write(&file, content.as_bytes()).map_err(unwritable)
            }
        }
    }

    /// Снимает интеграцию агента `agent`. Снимать нечего: готово.
    pub fn remove(&self, agent: &str) -> Result<(), AppError> {
        let target = Self::target(agent)?;
        let dir = self.dir(target);

        match target.kind {
            Kind::Hook { file, event, flat } => {
                let file = dir.join(file);

                if !file.is_file() {
                    return Ok(());
                }

                let config = read(&file)?;

                if has_hook(&config, event, flat, &command(agent)) {
                    write(&file, &without_hook(config, event, flat, &command(agent)))?;
                }

                Ok(())
            }
            Kind::File { path, .. } => match fs::remove_file(dir.join(path)) {
                Err(error) if error.kind() != ErrorKind::NotFound => Err(unwritable(error)),
                _ => Ok(()),
            },
        }
    }
}

/// Настройки агента. Нет файла или он пустой, значит, настроек ещё нет.
/// Файл, который не разобрать, sapien не трогает: `integration_config_invalid`.
fn read(file: &Path) -> Result<Value, AppError> {
    let text = match fs::read_to_string(file) {
        Ok(text) => text,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(json!({})),
        Err(_) => return Err(AppError::unavailable("integration_unreadable")),
    };

    if text.trim().is_empty() {
        return Ok(json!({}));
    }

    serde_json::from_str::<Value>(&text)
        .ok()
        .filter(Value::is_object)
        .ok_or(AppError::invalid("integration_config_invalid"))
}

/// Записи хуков события `event`, если они есть.
fn entries<'a>(config: &'a Value, event: &str) -> &'a [Value] {
    config["hooks"][event].as_array().map_or(&[], Vec::as_slice)
}

fn ours(entry: &Value, flat: bool, command: &str) -> bool {
    if flat {
        return entry["command"] == command;
    }

    entry["hooks"]
        .as_array()
        .is_some_and(|hooks| hooks.iter().any(|hook| hook["command"] == command))
}

fn has_hook(config: &Value, event: &str, flat: bool, command: &str) -> bool {
    entries(config, event)
        .iter()
        .any(|entry| ours(entry, flat, command))
}

/// Настройки с хуком `command` на событие `event`. Хуки и события человека
/// остаются как были. `hooks` или его событие не того вида значат, что
/// настройки sapien не понимает: `integration_config_invalid`.
fn with_hook(mut config: Value, event: &str, flat: bool, command: &str) -> Result<Value, AppError> {
    let invalid = || AppError::invalid("integration_config_invalid");

    if has_hook(&config, event, flat, command) {
        return Ok(config);
    }

    let object = config.as_object_mut().ok_or_else(invalid)?;

    // Cursor читает только файл хуков с версией.
    if flat {
        object.entry("version").or_insert(json!(1));
    }

    let entry = if flat {
        json!({ "command": command })
    } else {
        json!({ "hooks": [{ "type": "command", "command": command, "timeout": 10 }] })
    };

    object
        .entry("hooks")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(invalid)?
        .entry(event)
        .or_insert_with(|| json!([]))
        .as_array_mut()
        .ok_or_else(invalid)?
        .push(entry);

    Ok(config)
}

/// Настройки без хука `command`. Запись, в которой кроме него ничего
/// не было, уходит, а с ней и опустевшие событие и `hooks`.
fn without_hook(mut config: Value, event: &str, flat: bool, command: &str) -> Value {
    let Some(hooks) = config["hooks"].as_object_mut() else {
        return config;
    };

    if let Some(entries) = hooks.get_mut(event).and_then(Value::as_array_mut) {
        if flat {
            entries.retain(|entry| entry["command"] != command);
        } else {
            for entry in entries.iter_mut() {
                if let Some(list) = entry["hooks"].as_array_mut() {
                    list.retain(|hook| hook["command"] != command);
                }
            }

            entries.retain(|entry| {
                entry["hooks"]
                    .as_array()
                    .is_none_or(|list| !list.is_empty())
            });
        }

        if entries.is_empty() {
            hooks.remove(event);
        }
    }

    if hooks.is_empty()
        && let Some(object) = config.as_object_mut()
    {
        object.remove("hooks");
    }

    config
}

fn write(file: &Path, config: &Value) -> Result<(), AppError> {
    let mut text = serde_json::to_string_pretty(config).map_err(unwritable)?;

    text.push('\n');
    durable::write(file, text.as_bytes()).map_err(unwritable)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home() -> tempfile::TempDir {
        let home = tempfile::tempdir().unwrap();

        for dir in [".claude", ".codex", ".cursor", ".pi/agent"] {
            fs::create_dir_all(home.path().join(dir)).unwrap();
        }

        home
    }

    /// Без окружения процесса тестов: CLAUDE_CONFIG_DIR того, кто их
    /// запускает, увёл бы запись в его настоящие настройки.
    impl Integrations {
        fn isolated(home: &Path) -> Self {
            Self {
                home: home.to_owned(),
                env: |_| None,
            }
        }
    }

    fn state(integrations: &Integrations, agent: &str) -> IntegrationState {
        integrations
            .list()
            .into_iter()
            .find(|integration| integration.agent == agent)
            .unwrap()
            .state
    }

    #[test]
    fn хук_claude_code_встаёт_рядом_с_настройками_человека_и_снимается_один() {
        let home = home();
        let settings = home.path().join(".claude/settings.json");
        let theirs = r#"{
  "model": "opus",
  "hooks": {
    "SessionStart": [
      { "matcher": "startup", "hooks": [{ "type": "command", "command": "echo hi" }] }
    ],
    "Stop": [{ "hooks": [{ "type": "command", "command": "say done" }] }]
  },
  "alwaysThinkingEnabled": true
}"#;

        fs::write(&settings, theirs).unwrap();
        let integrations = Integrations::isolated(home.path());

        assert_eq!(state(&integrations, "claude"), IntegrationState::Off);
        integrations.install("claude").unwrap();
        // Второй раз хук не дублируется.
        integrations.install("claude").unwrap();
        assert_eq!(state(&integrations, "claude"), IntegrationState::On);

        let config = read(&settings).unwrap();
        let keys: Vec<&String> = config.as_object().unwrap().keys().collect();

        // Порядок ключей человека на месте.
        assert_eq!(keys, ["model", "hooks", "alwaysThinkingEnabled"]);
        assert_eq!(config["hooks"]["SessionStart"].as_array().unwrap().len(), 2);
        assert_eq!(
            config["hooks"]["SessionStart"][1]["hooks"][0]["command"],
            r#"[ -z "$SAPIEN_BIN" ] || "$SAPIEN_BIN" hook claude"#
        );

        integrations.remove("claude").unwrap();
        assert_eq!(state(&integrations, "claude"), IntegrationState::Off);
        assert_eq!(
            read(&settings).unwrap(),
            serde_json::from_str::<Value>(theirs).unwrap()
        );
    }

    #[test]
    fn хук_cursor_это_сама_команда_в_файле_с_версией() {
        let home = home();
        let integrations = Integrations::isolated(home.path());
        let file = home.path().join(".cursor/hooks.json");

        integrations.install("cursor").unwrap();
        assert_eq!(
            read(&file).unwrap(),
            json!({
                "version": 1,
                "hooks": { "sessionStart": [{ "command": command("cursor") }] }
            })
        );

        integrations.remove("cursor").unwrap();
        assert_eq!(read(&file).unwrap(), json!({ "version": 1 }));
    }

    #[test]
    fn расширение_pi_лежит_своим_файлом_а_без_агента_ставить_некуда() {
        let home = home();
        let integrations = Integrations::isolated(home.path());
        let extension = home.path().join(".pi/agent/extensions/sapien.ts");

        integrations.install("pi").unwrap();
        assert!(
            fs::read_to_string(&extension)
                .unwrap()
                .contains("SAPIEN_PANE")
        );
        assert_eq!(state(&integrations, "pi"), IntegrationState::On);
        integrations.remove("pi").unwrap();
        assert!(!extension.exists());

        assert_eq!(state(&integrations, "opencode"), IntegrationState::Missing);
        assert_eq!(
            integrations.install("opencode"),
            Err(AppError::not_found("integration_agent_missing"))
        );
        assert!(!home.path().join(".config/opencode").exists());
    }

    #[test]
    fn настройки_которые_не_разобрать_не_трогаются() {
        let home = home();
        let settings = home.path().join(".codex/hooks.json");

        fs::write(&settings, "{ сломано").unwrap();
        let integrations = Integrations::isolated(home.path());

        assert_eq!(
            integrations.install("codex"),
            Err(AppError::invalid("integration_config_invalid"))
        );
        assert_eq!(fs::read_to_string(&settings).unwrap(), "{ сломано");

        fs::write(&settings, r#"{ "hooks": [] }"#).unwrap();
        assert_eq!(
            integrations.install("codex"),
            Err(AppError::invalid("integration_config_invalid"))
        );
    }
}
