use serde::{Deserialize, Serialize};
use specta::Type;

sapien_kernel::error_codes! {
    /// Отказы сессий.
    pub enum SessionsCode {
        Missing = "session_missing",
        /// id сессии или панели не годится в имя файла.
        Invalid = "session_invalid",
        Unreadable = "session_unreadable",
        Unwritable = "session_unwritable",
        /// Имя от человека длиннее предела или с управляющим знаком.
        TitleInvalid = "title_invalid",
        /// Проекта сессии нет в списке или его папки нет на диске.
        ProjectMissing = "project_missing",
        /// В панелях сессии работает агент.
        AgentBusy = "agent_busy",
    }
}

/// Сессия sapien: терминал в папке проекта `project`, в котором человек
/// запускает агентов. Заголовок пустой, пока его не дал агент или человек.
/// Время в миллисекундах Unix.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub project: String,
    pub title: String,
    /// Заголовок дал человек: заголовки терминала его больше не меняют.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub named: bool,
    pub created: u64,
    pub updated: u64,
    /// Разговор Claude Code из версий, где сессия сама его запускала.
    /// Хранится, чтобы его можно было продолжить: `claude --resume <id>`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claude: Option<String>,
}

/// Сессия в списке окна. Список читает её прямо из файла сессии.
/// `agents`: агенты на переднем плане её панелей, `answering`: хоть один
/// из них работает. Этих двух в файле нет.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub project: String,
    pub title: String,
    /// Миллисекунды Unix укладываются в number окна без потерь.
    #[specta(type = u32)]
    pub updated: u64,
    #[serde(skip_deserializing)]
    pub answering: bool,
    #[serde(skip_deserializing)]
    pub agents: Vec<PaneAgent>,
}

/// Агент в панели `pane` сессии и работает ли он.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PaneAgent {
    pub pane: String,
    pub agent: String,
    pub answering: bool,
}

impl Session {
    /// Пустая сессия `id` в проекте `project`, заведённая в `now`.
    pub fn new(id: String, project: &str, now: u64) -> Self {
        Self {
            id,
            project: project.to_owned(),
            title: String::new(),
            named: false,
            created: now,
            updated: now,
            claude: None,
        }
    }

    pub fn info(&self) -> SessionInfo {
        SessionInfo {
            id: self.id.clone(),
            project: self.project.clone(),
            title: self.title.clone(),
            updated: self.updated,
            answering: false,
            agents: vec![],
        }
    }
}

/// Сколько знаков в имени сессии, которое дал человек.
const NAME_LIMIT: usize = 100;

/// Имя сессии, которое дал человек, без пробелов по краям. Длинное или
/// с управляющими знаками не годится: `None`. Пустое годится, оно отдаёт
/// имя обратно агенту.
pub fn session_name(raw: &str) -> Option<String> {
    let text = raw.trim();

    (text.chars().count() <= NAME_LIMIT && !text.chars().any(char::is_control))
        .then(|| text.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn имя_от_человека_без_пробелов_по_краям_и_управляющих_знаков() {
        assert_eq!(session_name("  Релиз 0.3  "), Some("Релиз 0.3".into()));
        assert_eq!(session_name("   "), Some(String::new()));
        assert_eq!(
            session_name(&"я".repeat(NAME_LIMIT)).map(|name| name.chars().count()),
            Some(NAME_LIMIT)
        );
        assert_eq!(session_name(&"я".repeat(NAME_LIMIT + 1)), None);
        assert_eq!(session_name("строка\nвторая"), None);
        assert_eq!(session_name("\x1b]0;чужой заголовок\x07"), None);
    }
}
