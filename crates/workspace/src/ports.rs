/// Перемены, о которых окно не просило: о них рабочее место сообщает само.
pub trait Events: Send + Sync + 'static {
    /// Сессии поменялись: окну их перечитать.
    fn sessions_changed(&self);
    /// Оболочка панели `pane` сессии `session` кончилась.
    fn terminal_exited(&self, session: &str, pane: &str);
}
