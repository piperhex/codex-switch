use tauri::{Manager, Runtime, WebviewWindow};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    UI::{
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::{WA_INACTIVE, WM_ACTIVATE, WM_NCDESTROY},
    },
};

const SUBCLASS_ID: usize = 0x43535702;
const LOW_WORD_MASK: usize = 0xffff;

#[derive(Debug, thiserror::Error)]
pub(in super::super) enum InstallError {
    #[error(transparent)]
    Window(#[from] tauri::Error),
    #[error(transparent)]
    Native(#[from] std::io::Error),
    #[error("menu window closed before dismissal handler was installed")]
    Cancelled,
}

struct DismissalHandler {
    on_deactivate: Box<dyn Fn() + Send + Sync>,
}

/// Native activation covers clicks into other applications even when WebView2 retains focus.
pub(in super::super) async fn install<R: Runtime>(
    window: &WebviewWindow<R>,
) -> Result<(), InstallError> {
    let hwnd = window.hwnd()?.0 as usize;
    let app = window.app_handle().clone();
    let handler = DismissalHandler {
        on_deactivate: Box::new(move || super::super::dismissal::request(&app)),
    };
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window.run_on_main_thread(move || {
        // The native window owns the installed handler even if the async caller is cancelled.
        let result = install_native(hwnd as HWND, handler);
        if sender.send(result).is_err() {
            eprintln!("quick menu dismissal installation caller was cancelled");
        }
    })?;
    receiver.await.map_err(|_| InstallError::Cancelled)??;
    Ok(())
}

fn install_native(hwnd: HWND, handler: DismissalHandler) -> std::io::Result<()> {
    let handler = Box::into_raw(Box::new(handler));
    // SAFETY: Runs on the HWND's UI thread. The allocation lives until WM_NCDESTROY,
    // where the subclass removes itself and releases exactly this allocation.
    if unsafe { SetWindowSubclass(hwnd, Some(subclass), SUBCLASS_ID, handler as usize) } == 0 {
        let error = std::io::Error::last_os_error();
        // SAFETY: Installation failed, so Windows never took ownership of this allocation.
        drop(unsafe { Box::from_raw(handler) });
        return Err(error);
    }
    Ok(())
}

unsafe extern "system" fn subclass(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _subclass_id: usize,
    reference_data: usize,
) -> LRESULT {
    if message == WM_ACTIVATE && wparam & LOW_WORD_MASK == WA_INACTIVE as usize {
        // SAFETY: install_native installed this allocation for the lifetime of this subclass.
        let handler = unsafe { &*(reference_data as *const DismissalHandler) };
        (handler.on_deactivate)();
    } else if message == WM_NCDESTROY {
        // SAFETY: Called once on the owning UI thread; remove before releasing callback data.
        unsafe {
            RemoveWindowSubclass(hwnd, Some(subclass), SUBCLASS_ID);
            drop(Box::from_raw(reference_data as *mut DismissalHandler));
        }
    }
    // SAFETY: Preserve normal activation, input delivery and the remaining subclass chain.
    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    use windows_sys::{
        w,
        Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, SendMessageW, WA_ACTIVE, WA_CLICKACTIVE, WM_KILLFOCUS,
            WM_SETFOCUS,
        },
    };

    fn hidden_window() -> HWND {
        // SAFETY: STATIC is a built-in window class; this hidden test window is created,
        // messaged and destroyed on the same thread with no borrowed OS pointers.
        let hwnd = unsafe {
            CreateWindowExW(
                0,
                w!("STATIC"),
                w!("menu dismissal test"),
                0,
                0,
                0,
                100,
                100,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null(),
            )
        };
        assert!(!hwnd.is_null());
        hwnd
    }

    #[test]
    fn native_deactivation_fires_without_webview_blur_and_releases_handler() {
        let hwnd = hidden_window();
        let calls = Arc::new(AtomicUsize::new(0));
        let handler_calls = Arc::clone(&calls);
        install_native(
            hwnd,
            DismissalHandler {
                on_deactivate: Box::new(move || {
                    handler_calls.fetch_add(1, Ordering::SeqCst);
                }),
            },
        )
        .unwrap();
        // SAFETY: These messages carry scalar values to the live window on its owning thread.
        unsafe {
            SendMessageW(hwnd, WM_ACTIVATE, WA_ACTIVE as usize, 0);
            SendMessageW(hwnd, WM_ACTIVATE, WA_CLICKACTIVE as usize, 0);
            SendMessageW(hwnd, WM_SETFOCUS, 0, 0);
            SendMessageW(hwnd, WM_KILLFOCUS, 0, 0);
        }
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        // SAFETY: Simulate external activation, including the minimized flag in the high word.
        unsafe {
            SendMessageW(hwnd, WM_ACTIVATE, WA_INACTIVE as usize, 0);
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        // SAFETY: Same live test window, with the minimized flag set in the scalar activation value.
        unsafe {
            SendMessageW(hwnd, WM_ACTIVATE, 1 << 16, 0);
        }
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        // SAFETY: The test owns this window; WM_NCDESTROY releases the subclass allocation.
        assert_ne!(unsafe { DestroyWindow(hwnd) }, 0);
        assert_eq!(Arc::strong_count(&calls), 1);
    }
}
