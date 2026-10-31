//! Собственные файлы приложения в папке данных шифруются ключом из
//! системного хранилища паролей: копия папки на другом компьютере не
//! читается. Заметки сюда не входят, они остаются файлами `.md` для
//! Obsidian, и их закрывает шифрование диска системы.
//!
//! Файл сам говорит, зашифрован ли он: шифр начинается с метки. Файл без
//! метки читается как есть, это файл прежних версий или запуска без
//! хранилища паролей. При запуске с ключом такие файлы шифруются на месте.

use crate::durable;
use crate::secrets::{Keychain, Unavailable};
use chacha20poly1305::aead::{Aead, Generate, Key, KeyInit};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use serde::Serialize;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{PoisonError, RwLock};

/// Начало зашифрованного файла. За ним случайный номер шифра и сам шифр
/// с меткой подлинности.
const MAGIC: &[u8] = b"sapien-sealed-1\n";
const NONCE_LEN: usize = 24;

/// Под этим именем ключ лежит в системном хранилище, рядом с секретами
/// из secrets.rs. Окну его не отдаёт ни одна команда.
const KEY_NAME: &str = "data_key";

/// Что шифруется: всё, что приложение пишет о заметках и задачах. Настройки
/// (путь хранилища, адрес YouTrack) не шифруются: потеря ключа не должна
/// заставлять заново выбирать папку.
pub const PLACES: [&str; 5] = [
    "chats",
    "journal",
    "history",
    "youtrack-sent.json",
    "window-store.json",
];

type DataKey = Key<XChaCha20Poly1305>;

/// Что с ключом данных на этом запуске.
#[derive(Clone)]
pub enum Mode {
    /// Ключ есть: файлы пишутся шифром.
    Sealed(DataKey),
    /// Хранилища паролей нет, и зашифрованных файлов тоже: файлы пишутся
    /// как есть, как секреты без хранилища из secrets.rs.
    Plain,
    /// Хранилище ответило, что ключа нет, а шифр на диске есть: ключ
    /// стёрли. Данные приложения не прочесть, их можно только начать заново.
    Lost,
    /// Хранилище паролей не ответило, а шифр на диске есть.
    Locked,
}

/// Состояние для окна, без ключа.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum State {
    Sealed,
    Plain,
    Lost,
    Locked,
}

impl Mode {
    pub fn state(&self) -> State {
        match self {
            Self::Sealed(_) => State::Sealed,
            Self::Plain => State::Plain,
            Self::Lost => State::Lost,
            Self::Locked => State::Locked,
        }
    }
}

// Режим один на приложение и выбирается при запуске до окна. Тесты его
// не трогают: они зовут функции с явным ключом.
static MODE: RwLock<Mode> = RwLock::new(Mode::Plain);

pub fn mode() -> Mode {
    MODE.read().unwrap_or_else(PoisonError::into_inner).clone()
}

fn install(mode: Mode) {
    *MODE.write().unwrap_or_else(PoisonError::into_inner) = mode;
}

fn locked() -> io::Error {
    io::Error::other("data_locked")
}

pub fn seal(key: &DataKey, bytes: &[u8]) -> Vec<u8> {
    let nonce = XNonce::generate();
    // Шифрование в память не отказывает: ошибка у него только на тексте
    // длиннее 256 ГиБ.
    let sealed = XChaCha20Poly1305::new(key)
        .encrypt(&nonce, bytes)
        .expect("шифр в памяти");

    [MAGIC, nonce.as_slice(), &sealed].concat()
}

/// Файл без метки отдаётся как есть. С меткой расшифровывается, а чужой
/// ключ или испорченный шифр дают ошибку, а не мусор.
pub fn open(key: Option<&DataKey>, bytes: Vec<u8>) -> io::Result<Vec<u8>> {
    let Some(rest) = bytes.strip_prefix(MAGIC) else {
        return Ok(bytes);
    };
    let key = key.ok_or_else(locked)?;

    if rest.len() < NONCE_LEN {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "data_damaged"));
    }

    let (nonce, sealed) = rest.split_at(NONCE_LEN);
    let nonce = XNonce::try_from(nonce)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "data_damaged"))?;

    XChaCha20Poly1305::new(key)
        .decrypt(&nonce, sealed)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "data_damaged"))
}

fn key_of(mode: &Mode) -> Option<&DataKey> {
    match mode {
        Mode::Sealed(key) => Some(key),
        _ => None,
    }
}

/// Запись как в durable.rs, шифром, если ключ есть. Без ключа при шифре
/// на диске запись отказывает: открытый текст рядом с шифром смешал бы
/// данные, которые потом не разобрать.
pub fn write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    match mode() {
        Mode::Sealed(key) => durable::write(path, &seal(&key, bytes)),
        Mode::Plain => durable::write(path, bytes),
        Mode::Lost | Mode::Locked => Err(locked()),
    }
}

pub fn read(path: &Path) -> io::Result<Vec<u8>> {
    let bytes = fs::read(path)?;

    open(key_of(&mode()), bytes)
}

pub fn read_to_string(path: &Path) -> io::Result<String> {
    String::from_utf8(read(path)?)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

fn encode(key: &DataKey) -> String {
    key.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn decode(text: &str) -> Option<DataKey> {
    let bytes: Vec<u8> = (0..text.len())
        .step_by(2)
        .map(|at| u8::from_str_radix(text.get(at..at + 2)?, 16).ok())
        .collect::<Option<_>>()?;

    DataKey::try_from(bytes.as_slice()).ok()
}

/// Файлы мест из `PLACES`, кроме временных из durable.rs.
fn files(places: &[PathBuf]) -> Vec<PathBuf> {
    fn walk(path: &Path, found: &mut Vec<PathBuf>) {
        if path.is_dir() {
            for item in fs::read_dir(path).into_iter().flatten().flatten() {
                walk(&item.path(), found);
            }
        } else if path.is_file()
            && !path
                .file_name()
                .is_some_and(|name| name.to_string_lossy().starts_with('.'))
        {
            found.push(path.to_path_buf());
        }
    }

    let mut found = Vec::new();

    for place in places {
        walk(place, &mut found);
    }

    found
}

fn is_sealed(path: &Path) -> bool {
    use std::io::Read;

    let mut head = [0; MAGIC.len()];

    fs::File::open(path)
        .and_then(|mut file| file.read_exact(&mut head))
        .is_ok_and(|()| head == MAGIC)
}

fn places_in(data_dir: &Path) -> Vec<PathBuf> {
    PLACES.iter().map(|place| data_dir.join(place)).collect()
}

/// Новый ключ в хранилище паролей. Хранилище его не приняло: работаем
/// без шифра.
fn fresh(keychain: &dyn Keychain) -> Mode {
    let key = DataKey::generate();

    match keychain.write(KEY_NAME, &encode(&key)) {
        Ok(()) => Mode::Sealed(key),
        Err(Unavailable) => Mode::Plain,
    }
}

/// Режим по хранилищу паролей и тому, что лежит на диске. С ключом
/// открытые файлы прежних версий шифруются на месте.
pub fn decide(keychain: &dyn Keychain, data_dir: &Path) -> Mode {
    let places = places_in(data_dir);
    let any_sealed = || files(&places).iter().any(|file| is_sealed(file));

    let mode = match keychain.read(KEY_NAME) {
        Ok(Some(text)) => decode(&text).map_or(Mode::Lost, Mode::Sealed),
        Ok(None) if any_sealed() => Mode::Lost,
        Ok(None) => fresh(keychain),
        Err(Unavailable) if any_sealed() => Mode::Locked,
        Err(Unavailable) => Mode::Plain,
    };

    if let Mode::Sealed(key) = &mode {
        for file in files(&places).into_iter().filter(|file| !is_sealed(file)) {
            // Не вышло сейчас, выйдет при следующем запуске: файл читается
            // и открытым. Время правки остаётся прежним: по нему журнал
            // считает, сколько лежит несохранённое.
            let Ok(bytes) = fs::read(&file) else {
                continue;
            };
            let modified = fs::metadata(&file).and_then(|meta| meta.modified());

            if durable::write(&file, &seal(key, &bytes)).is_ok()
                && let Ok(modified) = modified
            {
                let _ = fs::File::options()
                    .write(true)
                    .open(&file)
                    .and_then(|opened| opened.set_modified(modified));
            }
        }
    }

    mode
}

pub fn start(keychain: &dyn Keychain, data_dir: &Path) -> State {
    let mode = decide(keychain, data_dir);
    let state = mode.state();

    install(mode);
    state
}

/// Начать с чистыми данными приложения: файлы из `PLACES` стираются,
/// ключ создаётся новый. Заметок это не касается.
pub fn reset_in(keychain: &dyn Keychain, data_dir: &Path) -> io::Result<Mode> {
    for place in places_in(data_dir) {
        let removed = if place.is_dir() {
            fs::remove_dir_all(&place)
        } else {
            fs::remove_file(&place)
        };

        match removed {
            Err(error) if error.kind() != io::ErrorKind::NotFound => return Err(error),
            _ => {}
        }
    }

    // Битый ключ, из-за которого данные не читались, уходит вместе с ними.
    let _ = keychain.erase(KEY_NAME);

    Ok(fresh(keychain))
}

pub fn reset(keychain: &dyn Keychain, data_dir: &Path) -> io::Result<State> {
    let mode = reset_in(keychain, data_dir)?;
    let state = mode.state();

    install(mode);
    Ok(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;

    // Системное хранилище паролей в памяти. Без него вовсе: `missing`.
    #[derive(Default)]
    struct Memory {
        items: Mutex<HashMap<String, String>>,
        missing: bool,
    }

    impl Keychain for Memory {
        fn read(&self, key: &str) -> Result<Option<String>, Unavailable> {
            if self.missing {
                return Err(Unavailable);
            }

            Ok(self.items.lock().unwrap().get(key).cloned())
        }

        fn write(&self, key: &str, value: &str) -> Result<(), Unavailable> {
            if self.missing {
                return Err(Unavailable);
            }

            self.items
                .lock()
                .unwrap()
                .insert(key.to_owned(), value.to_owned());
            Ok(())
        }

        fn erase(&self, key: &str) -> Result<(), Unavailable> {
            self.items.lock().unwrap().remove(key);
            Ok(())
        }
    }

    fn missing() -> Memory {
        Memory {
            missing: true,
            ..Memory::default()
        }
    }

    fn chat(dir: &Path) -> PathBuf {
        dir.join("chats/хранилище.json")
    }

    fn put(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    fn key(mode: &Mode) -> &DataKey {
        key_of(mode).expect("ключ")
    }

    #[test]
    fn шифр_читается_только_своим_ключом() {
        let mine = DataKey::generate();
        let other = DataKey::generate();
        let sealed = seal(&mine, "переписка с агентом".as_bytes());

        assert!(sealed.starts_with(MAGIC));
        assert!(
            !String::from_utf8_lossy(&sealed).contains("переписка"),
            "открытого текста в шифре нет"
        );
        assert_eq!(
            open(Some(&mine), sealed.clone()).unwrap(),
            "переписка с агентом".as_bytes()
        );
        assert!(open(Some(&other), sealed.clone()).is_err());
        assert!(open(None, sealed).is_err());
        assert_eq!(open(None, b"{}".to_vec()).unwrap(), b"{}");
    }

    #[test]
    fn испорченный_шифр_это_ошибка_а_не_мусор() {
        let key = DataKey::generate();
        let mut sealed = seal(&key, b"text");
        let last = sealed.len() - 1;
        sealed[last] ^= 1;

        assert!(open(Some(&key), sealed).is_err());
        assert!(open(Some(&key), MAGIC.to_vec()).is_err());
    }

    #[test]
    fn первый_запуск_заводит_ключ_и_шифрует_прежние_файлы() {
        let dir = tempfile::tempdir().unwrap();
        let keychain = Memory::default();
        put(&chat(dir.path()), "переписка");
        put(&dir.path().join("history/a/b/1-edit.md"), "версия");
        put(&dir.path().join("vault.json"), "/Users/me/Заметки");
        put(
            &dir.path().join("history/a/b/.1-edit.md.sapien"),
            "временный",
        );
        let journal = dir.path().join("journal/a/b.json");
        put(&journal, "{}");
        let day_ago = std::time::SystemTime::now() - std::time::Duration::from_secs(86_400);
        fs::File::options()
            .write(true)
            .open(&journal)
            .unwrap()
            .set_modified(day_ago)
            .unwrap();

        let mode = decide(&keychain, dir.path());

        assert!(is_sealed(&journal));
        assert_eq!(
            fs::metadata(&journal).unwrap().modified().unwrap(),
            day_ago,
            "журнал помнит, когда правка не дошла"
        );
        assert!(keychain.items.lock().unwrap().contains_key(KEY_NAME));
        assert!(is_sealed(&chat(dir.path())));
        assert!(is_sealed(&dir.path().join("history/a/b/1-edit.md")));
        assert!(
            !is_sealed(&dir.path().join("vault.json")),
            "настройки открыты"
        );
        assert!(!is_sealed(
            &dir.path().join("history/a/b/.1-edit.md.sapien")
        ));
        assert_eq!(
            open(Some(key(&mode)), fs::read(chat(dir.path())).unwrap()).unwrap(),
            "переписка".as_bytes()
        );
    }

    #[test]
    fn следующий_запуск_берёт_тот_же_ключ() {
        let dir = tempfile::tempdir().unwrap();
        let keychain = Memory::default();
        put(&chat(dir.path()), "переписка");

        let first = decide(&keychain, dir.path());
        let second = decide(&keychain, dir.path());

        assert_eq!(key(&first), key(&second));
        assert_eq!(
            open(Some(key(&second)), fs::read(chat(dir.path())).unwrap()).unwrap(),
            "переписка".as_bytes()
        );
    }

    #[test]
    fn ключ_стёрли_из_хранилища_данные_не_читаются() {
        let dir = tempfile::tempdir().unwrap();
        let keychain = Memory::default();
        put(&chat(dir.path()), "переписка");
        decide(&keychain, dir.path());
        keychain.items.lock().unwrap().clear();

        assert_eq!(decide(&keychain, dir.path()).state(), State::Lost);
        assert!(
            keychain.items.lock().unwrap().is_empty(),
            "новый ключ не заводится сам"
        );
    }

    #[test]
    fn чистый_старт_стирает_данные_приложения_и_заводит_ключ() {
        let dir = tempfile::tempdir().unwrap();
        let keychain = Memory::default();
        put(&chat(dir.path()), "переписка");
        put(&dir.path().join("youtrack-sent.json"), "{}");
        put(&dir.path().join("vault.json"), "/Users/me/Заметки");
        decide(&keychain, dir.path());
        keychain.items.lock().unwrap().clear();

        let mode = reset_in(&keychain, dir.path()).unwrap();

        assert_eq!(mode.state(), State::Sealed);
        assert!(!dir.path().join("chats").exists());
        assert!(!dir.path().join("youtrack-sent.json").exists());
        assert!(dir.path().join("vault.json").exists(), "настройки на месте");
        assert_eq!(decide(&keychain, dir.path()).state(), State::Sealed);
    }

    #[test]
    fn без_хранилища_паролей_файлы_открыты_а_шифр_закрыт() {
        let dir = tempfile::tempdir().unwrap();
        put(&chat(dir.path()), "переписка");

        assert_eq!(decide(&missing(), dir.path()).state(), State::Plain);
        assert!(!is_sealed(&chat(dir.path())));

        decide(&Memory::default(), dir.path());

        assert_eq!(decide(&missing(), dir.path()).state(), State::Locked);
    }

    #[test]
    fn ключ_в_хранилище_переживает_кодирование() {
        let key = DataKey::generate();

        assert_eq!(decode(&encode(&key)), Some(key));
        assert_eq!(decode("не ключ"), None);
        assert_eq!(decode("abc"), None);
    }
}
