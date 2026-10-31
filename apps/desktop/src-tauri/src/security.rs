//! Раздел «Безопасность»: зашифрованы ли данные приложения (sealed.rs)
//! и включено ли шифрование диска системы, которое закрывает заметки.

use crate::error::AppError;
use crate::sealed::{self, State};
use crate::secrets::SystemKeychain;
use serde::Serialize;
use std::process::Command;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum System {
    Macos,
    Windows,
    Linux,
}

const SYSTEM: System = if cfg!(target_os = "macos") {
    System::Macos
} else if cfg!(target_os = "windows") {
    System::Windows
} else {
    System::Linux
};

#[derive(Debug, Serialize)]
pub struct SecurityStatus {
    pub data: State,
    pub system: System,
    /// Зашифрован ли системный диск. `None`, когда система не ответила.
    pub disk: Option<bool>,
}

/// `fdesetup isactive` отвечает `true` или `false` и прав администратора
/// не просит.
#[cfg(any(target_os = "macos", test))]
fn filevault(stdout: &str) -> Option<bool> {
    match stdout.trim() {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    }
}

/// Свойство тома `System.Volume.BitLockerProtection` из оболочки Windows:
/// его видно без прав администратора, в отличие от `manage-bde`. 1 включено,
/// 3 шифруется, 6 включено и заблокировано. 2 выключено, 4 расшифровывается,
/// 5 приостановлено (ключ лежит открытым), 8 ждёт включения.
#[cfg(any(target_os = "windows", test))]
fn bitlocker(stdout: &str) -> Option<bool> {
    match stdout.trim() {
        "1" | "3" | "6" => Some(true),
        "2" | "4" | "5" | "8" => Some(false),
        _ => None,
    }
}

/// `lsblk -nso TYPE` перечисляет устройство корня и всё, на чём оно стоит:
/// `crypt` среди них значит LUKS.
#[cfg(any(target_os = "linux", test))]
fn luks(stdout: &str) -> Option<bool> {
    let types: Vec<&str> = stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();

    if types.is_empty() {
        return None;
    }

    Some(types.contains(&"crypt"))
}

fn stdout(command: &mut Command) -> Option<String> {
    let output = command.output().ok()?;

    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(target_os = "macos")]
fn disk_encrypted() -> Option<bool> {
    filevault(&stdout(Command::new("/usr/bin/fdesetup").arg("isactive"))?)
}

#[cfg(target_os = "windows")]
fn disk_encrypted() -> Option<bool> {
    use std::os::windows::process::CommandExt;

    // Без окна консоли, которое иначе мелькнёт поверх приложения.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    // Буква системного диска идёт в текст команды, поэтому только как буква.
    let drive = std::env::var("SystemDrive")
        .ok()
        .filter(|drive| {
            drive.len() == 2 && drive.ends_with(':') && drive.as_bytes()[0].is_ascii_alphabetic()
        })
        .unwrap_or_else(|| "C:".to_owned());
    let script = format!(
        "(New-Object -ComObject Shell.Application).NameSpace('{drive}').Self.ExtendedProperty('System.Volume.BitLockerProtection')"
    );

    bitlocker(&stdout(
        Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .creation_flags(CREATE_NO_WINDOW),
    )?)
}

#[cfg(target_os = "linux")]
fn disk_encrypted() -> Option<bool> {
    // У btrfs источник с подтомом: `/dev/mapper/root[/@]`.
    let source = stdout(Command::new("findmnt").args(["-no", "SOURCE", "/"]))?;
    let device = source.trim().split('[').next()?.trim().to_owned();

    if !device.starts_with("/dev/") {
        return None;
    }

    luks(&stdout(
        Command::new("lsblk").args(["-nso", "TYPE", &device]),
    )?)
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn disk_encrypted() -> Option<bool> {
    None
}

/// Опрос диска запускает команду системы, поэтому идёт не в главном потоке.
#[tauri::command(async)]
pub fn security_status() -> SecurityStatus {
    SecurityStatus {
        data: sealed::mode().state(),
        system: SYSTEM,
        disk: disk_encrypted(),
    }
}

/// Начать с чистыми данными приложения, когда ключ пропал. Заметки на месте.
/// Читаемые данные так не стираются: это не кнопка «очистить историю».
#[tauri::command]
pub fn security_reset(app: AppHandle) -> Result<State, AppError> {
    if matches!(sealed::mode().state(), State::Sealed | State::Plain) {
        return Err(AppError::conflict("data_readable"));
    }

    let data = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::unavailable("data_dir_unavailable"))?;

    sealed::reset(&SystemKeychain, &data).map_err(|_| AppError::unavailable("data_unresettable"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ответы_систем_о_шифровании_диска() {
        assert_eq!(filevault("true\n"), Some(true));
        assert_eq!(filevault("false\n"), Some(false));
        assert_eq!(filevault(""), None);

        assert_eq!(bitlocker("1\r\n"), Some(true));
        assert_eq!(bitlocker("5\r\n"), Some(false));
        assert_eq!(bitlocker("2"), Some(false));
        assert_eq!(bitlocker(""), None);

        assert_eq!(luks("part\n"), Some(false));
        assert_eq!(luks("crypt\npart\ndisk\n"), Some(true));
        assert_eq!(luks(""), None);
    }

    // На машине разработчика: команда отвечает без прав администратора.
    #[cfg(target_os = "macos")]
    #[test]
    fn filevault_отвечает_без_прав_администратора() {
        assert!(disk_encrypted().is_some());
    }
}
