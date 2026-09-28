use windows::{
    core::HSTRING,
    Data::Xml::Dom::XmlDocument,
    Win32::{
        Foundation::RPC_E_CHANGED_MODE,
        System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
    },
    UI::Notifications::{ToastNotification, ToastNotificationManager},
};

use crate::codex_gui::notification_navigation;

const COMPLETION_BODY: &str = "本轮回复已完成，点击查看。";

struct RuntimeGuard(bool);

impl RuntimeGuard {
    fn initialize() -> windows::core::Result<Self> {
        // SAFETY: Initialize COM on this worker and balance only our successful initialization.
        match unsafe { RoInitialize(RO_INIT_MULTITHREADED) } {
            Ok(()) => Ok(Self(true)),
            Err(error) if error.code() == RPC_E_CHANGED_MODE => Ok(Self(false)),
            Err(error) => Err(error),
        }
    }
}

impl Drop for RuntimeGuard {
    fn drop(&mut self) {
        if self.0 {
            // SAFETY: This guard remains on the thread whose successful RoInitialize it owns.
            unsafe { RoUninitialize() };
        }
    }
}

pub(super) fn show(
    app: &tauri::AppHandle,
    thread_id: &str,
    title: &str,
) -> windows::core::Result<()> {
    let _runtime = RuntimeGuard::initialize()?;
    let document = toast_document(thread_id, title)?;
    let toast = ToastNotification::CreateToastNotification(&document)?;
    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(
        &app.config().identifier,
    ))?;
    notifier.Show(&toast)
}

fn toast_document(thread_id: &str, title: &str) -> windows::core::Result<XmlDocument> {
    let document = XmlDocument::new()?;
    document.LoadXml(&HSTRING::from(
        "<toast activationType=\"protocol\"><visual><binding template=\"ToastGeneric\">\
         <text/><text/></binding></visual></toast>",
    ))?;
    document.DocumentElement()?.SetAttribute(
        &HSTRING::from("launch"),
        &HSTRING::from(notification_navigation::thread_url(thread_id)),
    )?;
    let text = document.GetElementsByTagName(&HSTRING::from("text"))?;
    // DOM text nodes preserve Unicode titles and escape XML metacharacters.
    text.Item(0)?
        .AppendChild(&document.CreateTextNode(&HSTRING::from(title))?)?;
    text.Item(1)?
        .AppendChild(&document.CreateTextNode(&HSTRING::from(COMPLETION_BODY))?)?;
    Ok(document)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toast_body_launches_the_exact_conversation_and_preserves_title_text() {
        let _runtime = RuntimeGuard::initialize().unwrap();
        let id = "01a0e75e-3c32-7f23-9131-e54d7c49e7f8";
        let title = "修复 <通知> & \"跳转\"";
        let document = toast_document(id, title).unwrap();
        let root = document.DocumentElement().unwrap();
        assert_eq!(
            root.GetAttribute(&HSTRING::from("activationType")).unwrap(),
            "protocol"
        );
        assert_eq!(
            root.GetAttribute(&HSTRING::from("launch")).unwrap(),
            notification_navigation::thread_url(id)
        );
        assert_eq!(
            document
                .GetElementsByTagName(&HSTRING::from("text"))
                .unwrap()
                .Item(0)
                .unwrap()
                .InnerText()
                .unwrap(),
            title
        );
    }
}
