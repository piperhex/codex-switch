use std::{mem::size_of, sync::mpsc};

use tauri::{
    menu::{ContextMenu, Menu},
    tray::TrayIcon,
    AppHandle, Manager, Runtime, WebviewWindow,
};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    UI::{
        Controls::{DRAWITEMSTRUCT, MEASUREITEMSTRUCT, ODT_MENU},
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::{
            GetMenuInfo, GetMenuItemInfoW, SetMenuInfo, SetMenuItemInfoW, HMENU, MENUINFO,
            MENUITEMINFOW, MFT_OWNERDRAW, MIIM_DATA, MIIM_FTYPE, MIIM_STRING, MIM_MENUDATA,
            WM_DRAWITEM, WM_MEASUREITEM, WM_NCDESTROY,
        },
    },
};

use super::account_label::AccountMenuLabel;

mod drawing;

const SUBCLASS_ID: usize = 0x43535701;
const MENU_MARKER: usize = 0xc5000000;
const MENU_MARKER_MASK: usize = 0xff000000;
const MAX_LABEL_UNITS: usize = 4096;

/// Adds colored account rendering while leaving native menu selection and commands intact.
pub(crate) fn install_for_tray<R: Runtime>(tray: &TrayIcon<R>) -> Result<(), String> {
    tray.with_inner_tray_icon(|inner| install_owner(inner.window_handle() as isize))
        .map_err(|error| error.to_string())?
}

pub(crate) fn install_for_window<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as usize;
    on_main_thread(window.app_handle(), move || install_owner(hwnd as isize))
}

/// Stores only the containing menu handle and color values in native item data.
/// Windows retains the menu throughout its measure and draw callbacks, so no Rust pointers escape.
pub(crate) fn style_accounts<R: Runtime>(
    menu: &Menu<R>,
    positions: Vec<u32>,
    good_color: [u8; 3],
) -> Result<(), String> {
    let handle = menu.hpopupmenu().map_err(|error| error.to_string())?;
    let keep_alive = menu.clone();
    on_main_thread(menu.app_handle(), move || {
        let result = style_native_menu(handle, &positions, good_color);
        drop(keep_alive);
        result
    })
}

fn on_main_thread<R: Runtime>(
    app: &AppHandle<R>,
    action: impl FnOnce() -> Result<(), String> + Send + 'static,
) -> Result<(), String> {
    let (sender, receiver) = mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        // A disconnected receiver means the caller has already stopped waiting.
        let _ = sender.send(action());
    })
    .map_err(|error| error.to_string())?;
    receiver.recv().map_err(|error| error.to_string())?
}

pub(super) fn install_owner(hwnd: isize) -> Result<(), String> {
    // SAFETY: Tauri supplies a live HWND; this function runs on its owning UI thread.
    if unsafe { SetWindowSubclass(hwnd as HWND, Some(menu_subclass), SUBCLASS_ID, 0) } == 0 {
        return Err("无法设置菜单颜色".to_string());
    }
    Ok(())
}

pub(super) fn style_native_menu(
    handle: isize,
    positions: &[u32],
    good_color: [u8; 3],
) -> Result<(), String> {
    let menu = handle as HMENU;
    let info = MENUINFO {
        cbSize: size_of::<MENUINFO>() as u32,
        fMask: MIM_MENUDATA,
        dwMenuData: MENU_MARKER | drawing::rgb(good_color) as usize,
        ..Default::default()
    };
    // SAFETY: The Tauri Menu clone keeps this native HMENU alive on the UI thread.
    if unsafe { SetMenuInfo(menu, &info) } == 0 {
        return Err("无法设置菜单颜色".to_string());
    }
    for &position in positions {
        mark_account_item(menu, position)?;
    }
    Ok(())
}

fn mark_account_item(menu: HMENU, position: u32) -> Result<(), String> {
    let mut info = MENUITEMINFOW {
        cbSize: size_of::<MENUITEMINFOW>() as u32,
        fMask: MIIM_FTYPE | MIIM_DATA,
        ..Default::default()
    };
    // SAFETY: The live menu and initialized MENUITEMINFOW remain valid during both calls.
    unsafe {
        if GetMenuItemInfoW(menu, position, 1, &mut info) == 0 {
            return Err("无法读取菜单项目".to_string());
        }
        info.fType |= MFT_OWNERDRAW;
        info.dwItemData = menu as usize;
        if SetMenuItemInfoW(menu, position, 1, &info) == 0 {
            return Err("无法设置菜单项目颜色".to_string());
        }
    }
    Ok(())
}

unsafe extern "system" fn menu_subclass(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _subclass_id: usize,
    _reference_data: usize,
) -> LRESULT {
    match message {
        WM_MEASUREITEM if lparam != 0 => {
            // SAFETY: Windows supplies a writable MEASUREITEMSTRUCT for this message.
            let item = unsafe { &mut *(lparam as *mut MEASUREITEMSTRUCT) };
            if item.CtlType == ODT_MENU {
                if let Some(label) = read_label(item.itemData as HMENU, item.itemID) {
                    drawing::measure(hwnd, item, &label);
                    return 1;
                }
            }
        }
        WM_DRAWITEM if lparam != 0 => {
            // SAFETY: Windows supplies a valid DRAWITEMSTRUCT for the duration of this callback.
            let item = unsafe { &*(lparam as *const DRAWITEMSTRUCT) };
            if item.CtlType == ODT_MENU && item.itemData == item.hwndItem as usize {
                if let Some(label) = read_label(item.hwndItem as HMENU, item.itemID) {
                    drawing::draw(hwnd, item, &label);
                    return 1;
                }
            }
        }
        WM_NCDESTROY => {
            // SAFETY: Remove our stateless subclass before this owner window is destroyed.
            unsafe { RemoveWindowSubclass(hwnd, Some(menu_subclass), SUBCLASS_ID) };
        }
        _ => {}
    }
    // SAFETY: Unhandled messages continue through the native Tauri/muda subclass chain.
    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
}

fn read_label(menu: HMENU, item_id: u32) -> Option<AccountMenuLabel> {
    let mut menu_info = MENUINFO {
        cbSize: size_of::<MENUINFO>() as u32,
        fMask: MIM_MENUDATA,
        ..Default::default()
    };
    // SAFETY: GetMenuInfo validates the OS handle; no application pointers are dereferenced.
    if unsafe { GetMenuInfo(menu, &mut menu_info) } == 0
        || menu_info.dwMenuData & MENU_MARKER_MASK != MENU_MARKER
    {
        return None;
    }
    let color = menu_info.dwMenuData as u32;
    let good_color = [color as u8, (color >> 8) as u8, (color >> 16) as u8];
    AccountMenuLabel::from_text(&read_menu_text(menu, item_id)?, good_color)
}

fn read_menu_text(menu: HMENU, item_id: u32) -> Option<String> {
    let mut info = MENUITEMINFOW {
        cbSize: size_of::<MENUITEMINFOW>() as u32,
        fMask: MIIM_STRING,
        ..Default::default()
    };
    // SAFETY: The first call obtains the required UTF-16 length for a live menu item.
    if unsafe { GetMenuItemInfoW(menu, item_id, 0, &mut info) } == 0 {
        return None;
    }
    let length = info.cch as usize;
    if length == 0 || length > MAX_LABEL_UNITS {
        return None;
    }
    let mut text = vec![0u16; length + 1];
    info.cch = text.len() as u32;
    info.dwTypeData = text.as_mut_ptr();
    // SAFETY: The buffer contains cch writable UTF-16 units, including the terminator.
    if unsafe { GetMenuItemInfoW(menu, item_id, 0, &mut info) } == 0 {
        return None;
    }
    String::from_utf16(&text[..info.cch as usize]).ok()
}
