//! Секреты: ключи API и токены. Живут в системном хранилище паролей,
//! а где его нет, только в памяти до закрытия приложения, и никогда
//! в файлах. Окну ни одна команда секрет не отдаёт: только задан ли он
//! и чем заканчивается. Запрос с секретом делает Rust и сам его подставляет.

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;

/// Под этим именем приложение кладёт записи в системное хранилище:
/// идентификатор из tauri.conf.json.
const SERVICE: &str = "is.oberemok.sapien";

/// Какие секреты бывают. Окно называет секрет только этими именами
/// и не может записать в системное хранилище ничего другого.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SecretName {
    /// Ключ API провайдера модели для агента.
    ModelKey,
    /// Постоянный токен YouTrack.
    YoutrackToken,
}

impl SecretName {
    fn key(self) -> &'static str {
        match self {
            Self::ModelKey => "model_key",
            Self::YoutrackToken => "youtrack_token",
        }
    }
}

/// Что окно знает о секрете.
#[derive(Debug, PartialEq, Serialize)]
pub struct SecretStatus {
    /// Последние четыре знака заданного секрета: по ним человек узнаёт
    /// свой ключ, не видя его.
    pub ending: Option<String>,
    /// Секрет переживёт перезапуск: системное хранилище паролей есть.
    pub kept: bool,
}

/// Системное хранилище не ответило: его нет или оно отказало.
#[derive(Debug)]
pub struct Unavailable;

/// Системное хранилище паролей. В тестах его подменяет память.
pub trait Keychain: Send + Sync {
    fn read(&self, key: &str) -> Result<Option<String>, Unavailable>;
    fn write(&self, key: &str, value: &str) -> Result<(), Unavailable>;
    /// Стирает запись. Записи нет, и хранилища нет вовсе: стирать нечего.
    fn erase(&self, key: &str) -> Result<(), Unavailable>;
}

/// Связка ключей на macOS, диспетчер учётных данных на Windows,
/// Secret Service на Linux.
pub struct SystemKeychain;

impl Keychain for SystemKeychain {
    fn read(&self, key: &str) -> Result<Option<String>, Unavailable> {
        match keyring::Entry::new(SERVICE, key).and_then(|entry| entry.get_password()) {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(Unavailable),
        }
    }

    fn write(&self, key: &str, value: &str) -> Result<(), Unavailable> {
        keyring::Entry::new(SERVICE, key)
            .and_then(|entry| entry.set_password(value))
            .map_err(|_| Unavailable)
    }

    fn erase(&self, key: &str) -> Result<(), Unavailable> {
        match keyring::Entry::new(SERVICE, key).and_then(|entry| entry.delete_credential()) {
            Ok(()) | Err(keyring::Error::NoEntry | keyring::Error::NoDefaultStore) => Ok(()),
            Err(_) => Err(Unavailable),
        }
    }
}

pub struct Secrets {
    keychain: Box<dyn Keychain>,
    /// Секреты, которые системное хранилище не приняло. На Linux без
    /// Secret Service ключ живёт здесь до закрытия приложения: открытым
    /// текстом на диск он не ложится ни при каких условиях.
    memory: Mutex<HashMap<&'static str, String>>,
}

impl Default for Secrets {
    fn default() -> Self {
        Self::new(SystemKeychain)
    }
}

impl Secrets {
    pub fn new(keychain: impl Keychain + 'static) -> Self {
        Self {
            keychain: Box::new(keychain),
            memory: Mutex::new(HashMap::new()),
        }
    }

    fn remembered(&self, name: SecretName) -> Option<String> {
        self.memory.lock().ok()?.get(name.key()).cloned()
    }

    /// Секреты только в памяти, как без системного хранилища: для тестов
    /// модулей, которым нужен секрет.
    #[cfg(test)]
    pub fn in_memory() -> Self {
        struct Missing;

        impl Keychain for Missing {
            fn read(&self, _key: &str) -> Result<Option<String>, Unavailable> {
                Err(Unavailable)
            }

            fn write(&self, _key: &str, _value: &str) -> Result<(), Unavailable> {
                Err(Unavailable)
            }

            fn erase(&self, _key: &str) -> Result<(), Unavailable> {
                Ok(())
            }
        }

        Self::new(Missing)
    }

    /// Секрет для запроса. Только для Rust: в окно он не уходит.
    pub fn get(&self, name: SecretName) -> Option<String> {
        self.remembered(name)
            .or_else(|| self.keychain.read(name.key()).ok().flatten())
    }

    pub fn status(&self, name: SecretName) -> SecretStatus {
        if let Some(value) = self.remembered(name) {
            return SecretStatus {
                ending: Some(ending(&value)),
                kept: false,
            };
        }

        match self.keychain.read(name.key()) {
            Ok(value) => SecretStatus {
                ending: value.as_deref().map(ending),
                kept: true,
            },
            Err(Unavailable) => SecretStatus {
                ending: None,
                kept: false,
            },
        }
    }

    /// Задаёт или заменяет секрет. Пробелы по краям это след копирования,
    /// а не часть ключа.
    pub fn set(&self, name: SecretName, value: &str) -> Result<SecretStatus, AppError> {
        let value = value.trim();

        if value.is_empty() {
            return Err(AppError::invalid("secret_empty"));
        }

        let kept = self.keychain.write(name.key(), value).is_ok();
        let mut memory = self
            .memory
            .lock()
            .map_err(|_| AppError::unavailable("secret_unsaved"))?;

        if kept {
            memory.remove(name.key());
        } else {
            memory.insert(name.key(), value.to_owned());
        }

        Ok(SecretStatus {
            ending: Some(ending(value)),
            kept,
        })
    }

    /// Стирает секрет отовсюду. После перезапуска его нет.
    pub fn delete(&self, name: SecretName) -> Result<(), AppError> {
        if let Ok(mut memory) = self.memory.lock() {
            memory.remove(name.key());
        }

        self.keychain
            .erase(name.key())
            .map_err(|Unavailable| AppError::unavailable("secret_unerased"))
    }
}

fn ending(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();

    chars[chars.len().saturating_sub(4)..].iter().collect()
}

#[tauri::command]
pub fn secret_status(secrets: State<'_, Secrets>, name: SecretName) -> SecretStatus {
    secrets.status(name)
}

/// Секрет приходит из окна один раз и обратно не возвращается.
#[tauri::command]
pub fn secret_set(
    secrets: State<'_, Secrets>,
    name: SecretName,
    value: String,
) -> Result<SecretStatus, AppError> {
    secrets.set(name, &value)
}

#[tauri::command]
pub fn secret_delete(secrets: State<'_, Secrets>, name: SecretName) -> Result<(), AppError> {
    secrets.delete(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    /// Системное хранилище в памяти теста. Без хранилища пишет и читает
    /// с отказом, как Linux без Secret Service.
    #[derive(Clone, Default)]
    struct Fake {
        stored: Arc<Mutex<HashMap<String, String>>>,
        missing: bool,
    }

    impl Keychain for Fake {
        fn read(&self, key: &str) -> Result<Option<String>, Unavailable> {
            if self.missing {
                return Err(Unavailable);
            }

            Ok(self.stored.lock().unwrap().get(key).cloned())
        }

        fn write(&self, key: &str, value: &str) -> Result<(), Unavailable> {
            if self.missing {
                return Err(Unavailable);
            }

            self.stored.lock().unwrap().insert(key.into(), value.into());
            Ok(())
        }

        fn erase(&self, key: &str) -> Result<(), Unavailable> {
            self.stored.lock().unwrap().remove(key);
            Ok(())
        }
    }

    const KEY: &str = "sk-ant-api03-секрет-WXYZ";

    #[test]
    fn окну_виден_только_конец_секрета() {
        let keychain = Fake::default();
        let secrets = Secrets::new(keychain.clone());

        assert_eq!(
            secrets.status(SecretName::ModelKey),
            SecretStatus {
                ending: None,
                kept: true
            }
        );

        let status = secrets
            .set(SecretName::ModelKey, &format!("  {KEY}\n"))
            .unwrap();

        assert_eq!(
            status,
            SecretStatus {
                ending: Some("WXYZ".into()),
                kept: true
            }
        );
        assert_eq!(secrets.status(SecretName::ModelKey), status);
        assert_eq!(secrets.get(SecretName::ModelKey).as_deref(), Some(KEY));
        // Перезапуск: секрет берётся из системного хранилища.
        assert_eq!(
            Secrets::new(keychain).get(SecretName::ModelKey).as_deref(),
            Some(KEY)
        );
    }

    #[test]
    fn пустой_секрет_не_задаётся_а_новый_заменяет_прежний() {
        let secrets = Secrets::new(Fake::default());

        assert_eq!(
            secrets.set(SecretName::ModelKey, "  \n"),
            Err(AppError::invalid("secret_empty"))
        );

        secrets.set(SecretName::ModelKey, "старый-ключ").unwrap();
        secrets.set(SecretName::ModelKey, KEY).unwrap();
        assert_eq!(secrets.get(SecretName::ModelKey).as_deref(), Some(KEY));
    }

    #[test]
    fn удалённый_секрет_не_переживает_перезапуск() {
        let keychain = Fake::default();
        let secrets = Secrets::new(keychain.clone());
        secrets.set(SecretName::ModelKey, KEY).unwrap();

        secrets.delete(SecretName::ModelKey).unwrap();

        assert!(keychain.stored.lock().unwrap().is_empty());
        assert_eq!(secrets.status(SecretName::ModelKey).ending, None);
        assert_eq!(Secrets::new(keychain).get(SecretName::ModelKey), None);
    }

    #[test]
    fn без_системного_хранилища_секрет_живёт_только_в_памяти() {
        let keychain = Fake {
            missing: true,
            ..Fake::default()
        };
        let secrets = Secrets::new(keychain.clone());

        assert!(!secrets.status(SecretName::ModelKey).kept);

        let status = secrets.set(SecretName::ModelKey, KEY).unwrap();

        assert_eq!(
            status,
            SecretStatus {
                ending: Some("WXYZ".into()),
                kept: false
            }
        );
        assert_eq!(secrets.get(SecretName::ModelKey).as_deref(), Some(KEY));
        assert!(keychain.stored.lock().unwrap().is_empty());
        // После перезапуска секрета нет: на диск он не попал.
        assert_eq!(Secrets::new(keychain).get(SecretName::ModelKey), None);

        secrets.delete(SecretName::ModelKey).unwrap();
        assert_eq!(secrets.get(SecretName::ModelKey), None);
    }
}
