/// Сколько вывода помнится для нового окна и следующего запуска.
const SCREEN: usize = 256 * 1024;

/// Конец прежнего экрана: выйти из второго экрана полноэкранной программы,
/// вернуть курсор, выключить мышь, вести о фокусе и вставку скобками,
/// сбросить цвет. Новая оболочка начинается с чистой строки. Второй экран
/// закрывает 1047, а не 1049: тот ставит курсор туда, где его никто не
/// сохранял, и новая оболочка писала бы поверх прежнего экрана.
const RESET: &[u8] = b"\x1b[?1047l\x1b[?25h\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1004l\x1b[?2004l\x1b[0m\r\n";

/// Вывод терминала, который помнится: последние 256 КБ, с целой строки.
#[derive(Debug, Default)]
pub struct Screen(Vec<u8>);

impl Screen {
    /// Экран новой оболочки панели над прежним экраном `previous`, каким
    /// его оставила прошлая оболочка.
    pub fn resumed(mut previous: Vec<u8>) -> Self {
        if !previous.is_empty() {
            previous.extend_from_slice(RESET);
        }

        Self(previous)
    }

    pub fn push(&mut self, bytes: &[u8]) {
        self.0.extend_from_slice(bytes);

        if self.0.len() > 2 * SCREEN {
            self.0.drain(..self.0.len() - SCREEN);

            // Срез мог прийтись на середину буквы или последовательности:
            // экран начинается со следующей строки.
            let line = self
                .0
                .iter()
                .position(|&byte| byte == b'\n')
                .map_or(0, |at| at + 1);

            self.0.drain(..line);
        }
    }

    pub fn bytes(&self) -> &[u8] {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn экран_помнит_последний_вывод_с_целой_строки() {
        let mut screen = Screen::resumed(vec![]);

        assert!(screen.bytes().is_empty());

        // Строки по 1000 байт: срез приходится на середину строки.
        let line = [b"x".repeat(999), b"\n".to_vec()].concat();

        for _ in 0..(2 * SCREEN / line.len() + 1) {
            screen.push(&line);
        }

        assert!(screen.bytes().len() <= SCREEN);
        assert!(screen.bytes().len() > SCREEN - line.len());
        assert_eq!(screen.bytes().len() % line.len(), 0);
    }

    #[test]
    fn прежний_экран_кончается_сбросом_а_пустой_остаётся_пустым() {
        let screen = Screen::resumed(b"$ make\r\n".to_vec());

        assert!(screen.bytes().starts_with(b"$ make\r\n"));
        assert!(screen.bytes().ends_with(RESET));
        assert!(Screen::resumed(vec![]).bytes().is_empty());
    }
}
