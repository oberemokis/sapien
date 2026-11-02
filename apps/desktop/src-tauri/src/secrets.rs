//! Секреты: токены GitHub и GitLab. Живут в системном хранилище паролей,
//! а где его нет, только в памяти до закрытия приложения, и никогда
//! в файлах. Окну ни одна команда секрет не отдаёт: запрос с секретом
//! делает Rust и сам его подставляет.

use crate::error::AppError;
use std::collections::HashMap;
use std::sync::Mutex;

/// Под этим именем приложение кладёт записи в системное хранилище:
/// идентификатор из tauri.conf.json.
const SERVICE: &str = "is.oberemok.sapien";

/// Какие секреты бывают. Записать в системное хранилище что-то другое
/// приложение не может.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SecretName {
    GithubToken,
    GitlabToken,
}

impl SecretName {
    fn key(self) -> &'static str {
        match self {
            Self::GithubToken => "github_token",
            Self::GitlabToken => "gitlab_token",
        }
    }
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
    /// Secret Service токен живёт здесь до закрытия приложения: открытым
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

    /// Задаёт или заменяет секрет. Пробелы по краям это след копирования,
    /// а не часть токена.
    pub fn set(&self, name: SecretName, value: &str) -> Result<(), AppError> {
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

        Ok(())
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

    const TOKEN: &str = "ghp_секрет-WXYZ";

    #[test]
    fn токен_переживает_перезапуск_в_системном_хранилище() {
        let keychain = Fake::default();
        let secrets = Secrets::new(keychain.clone());

        secrets
            .set(SecretName::GithubToken, &format!("  {TOKEN}\n"))
            .unwrap();

        assert_eq!(secrets.get(SecretName::GithubToken).as_deref(), Some(TOKEN));
        assert_eq!(secrets.get(SecretName::GitlabToken), None);
        // Перезапуск: секрет берётся из системного хранилища.
        assert_eq!(
            Secrets::new(keychain)
                .get(SecretName::GithubToken)
                .as_deref(),
            Some(TOKEN)
        );
    }

    #[test]
    fn пустой_секрет_не_задаётся_а_новый_заменяет_прежний() {
        let secrets = Secrets::new(Fake::default());

        assert_eq!(
            secrets.set(SecretName::GithubToken, "  \n"),
            Err(AppError::invalid("secret_empty"))
        );

        secrets
            .set(SecretName::GithubToken, "старый-токен")
            .unwrap();
        secrets.set(SecretName::GithubToken, TOKEN).unwrap();
        assert_eq!(secrets.get(SecretName::GithubToken).as_deref(), Some(TOKEN));
    }

    #[test]
    fn удалённый_секрет_не_переживает_перезапуск() {
        let keychain = Fake::default();
        let secrets = Secrets::new(keychain.clone());
        secrets.set(SecretName::GitlabToken, TOKEN).unwrap();

        secrets.delete(SecretName::GitlabToken).unwrap();

        assert!(keychain.stored.lock().unwrap().is_empty());
        assert_eq!(secrets.get(SecretName::GitlabToken), None);
        assert_eq!(Secrets::new(keychain).get(SecretName::GitlabToken), None);
    }

    #[test]
    fn без_системного_хранилища_секрет_живёт_только_в_памяти() {
        let keychain = Fake {
            missing: true,
            ..Fake::default()
        };
        let secrets = Secrets::new(keychain.clone());

        secrets.set(SecretName::GithubToken, TOKEN).unwrap();

        assert_eq!(secrets.get(SecretName::GithubToken).as_deref(), Some(TOKEN));
        assert!(keychain.stored.lock().unwrap().is_empty());
        // После перезапуска секрета нет: на диск он не попал.
        assert_eq!(Secrets::new(keychain).get(SecretName::GithubToken), None);

        secrets.delete(SecretName::GithubToken).unwrap();
        assert_eq!(secrets.get(SecretName::GithubToken), None);
    }
}
