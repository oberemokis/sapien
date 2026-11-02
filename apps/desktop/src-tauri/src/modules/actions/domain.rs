use crate::error::AppError;
use serde::Serialize;

/// Действие: имя файла в папке действий, например «Сводка.md», и его текст.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionFile {
    pub path: String,
    pub text: String,
}

/// Знаки, которые запрещает в имени файла одна из систем, а `/` и `\`
/// ещё и увели бы файл из папки действий.
const FORBIDDEN: [char; 9] = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'];

fn forbidden(name: &str) -> bool {
    name.contains(FORBIDDEN) || name.chars().any(char::is_control)
}

/// Имя файла нового действия по имени, которое ввёл человек, без `.md`.
/// Имя с точки в начале система прячет, и действие пропало бы из списка.
pub fn file_name(name: &str) -> Result<String, AppError> {
    let name = name.trim();

    if name.is_empty() {
        Err(AppError::invalid("name_empty"))
    } else if forbidden(name) {
        Err(AppError::invalid("name_forbidden"))
    } else if name.starts_with('.') {
        Err(AppError::invalid("name_hidden"))
    } else {
        Ok(format!("{name}.md"))
    }
}

/// Файл действия, который назвало окно: только имя в папке действий.
/// `..`, разделители и скрытые файлы до диска не доходят.
pub fn parse_path(path: &str) -> Result<&str, AppError> {
    if path.is_empty() || forbidden(path) || path.starts_with('.') {
        return Err(AppError::invalid("name_forbidden"));
    }

    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn имя_действия_только_простое() {
        let code = |name: &str| file_name(name).map_err(|error| error.code);

        assert_eq!(
            code("  Сводка за неделю "),
            Ok("Сводка за неделю.md".into())
        );
        assert_eq!(code("  "), Err("name_empty"));

        for name in [
            "a/b", "a\\b", "a:b", "a*", "a?", "\"a\"", "<a>", "a|b", "a\nb",
        ] {
            assert_eq!(code(name), Err("name_forbidden"), "{name}");
        }

        assert_eq!(code(".скрытое"), Err("name_hidden"));
    }

    #[test]
    fn путь_из_окна_не_уводит_из_папки_действий() {
        assert_eq!(parse_path("Сводка.md"), Ok("Сводка.md"));

        for path in ["", "..", ".", "../x.md", "a/b.md", "a\\b.md", ".hidden.md"] {
            assert_eq!(
                parse_path(path),
                Err(AppError::invalid("name_forbidden")),
                "{path}"
            );
        }
    }
}
