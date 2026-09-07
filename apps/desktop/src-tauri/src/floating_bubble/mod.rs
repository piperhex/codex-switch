include!("window.rs");
include!("settings.rs");
include!("sizing.rs");
include!("menu.rs");
mod lifecycle;
mod position;
pub(crate) use lifecycle::{handle_window_event, shutdown, BubbleLifecycle};
