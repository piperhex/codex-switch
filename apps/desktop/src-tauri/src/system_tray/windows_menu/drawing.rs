use std::mem::size_of;

use windows_sys::Win32::{
    Foundation::{COLORREF, HWND, RECT, SIZE},
    Graphics::Gdi::{
        CreateFontIndirectW, DeleteObject, DrawFrameControl, DrawTextW, FillRect, GetDC,
        GetStockObject, GetSysColor, GetSysColorBrush, GetTextExtentPoint32W, ReleaseDC, RestoreDC,
        SaveDC, SelectObject, SetBkMode, SetTextColor, COLOR_GRAYTEXT, COLOR_HIGHLIGHT,
        COLOR_HIGHLIGHTTEXT, COLOR_MENU, COLOR_MENUTEXT, DEFAULT_GUI_FONT, DFCS_MENUCHECK,
        DFC_MENU, DT_NOPREFIX, DT_SINGLELINE, DT_VCENTER, HDC, HFONT, TRANSPARENT,
    },
    UI::{
        Controls::{
            CloseThemeData, DrawThemeBackground, OpenThemeData, DRAWITEMSTRUCT, HTHEME, MCB_NORMAL,
            MC_CHECKMARKNORMAL, MEASUREITEMSTRUCT, MENU_POPUPCHECK, MENU_POPUPCHECKBACKGROUND,
            MENU_POPUPITEM, MPI_HOT, ODS_CHECKED, ODS_DISABLED, ODS_SELECTED,
        },
        HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi, SystemParametersInfoForDpi},
        WindowsAndMessaging::{
            NONCLIENTMETRICSW, SM_CXMENUCHECK, SM_CYMENU, SPI_GETNONCLIENTMETRICS,
        },
    },
};

use super::super::account_label::AccountMenuLabel;

const DEFAULT_DPI: u32 = 96;
const TEXT_PADDING: i32 = 8;
const CHECK_PADDING: i32 = 6;
const VERTICAL_PADDING: i32 = 4;
const MENU_THEME: [u16; 5] = [b'M' as u16, b'e' as u16, b'n' as u16, b'u' as u16, 0];

pub(super) fn rgb([red, green, blue]: [u8; 3]) -> COLORREF {
    u32::from(red) | u32::from(green) << 8 | u32::from(blue) << 16
}

pub(super) fn measure(hwnd: HWND, item: &mut MEASUREITEMSTRUCT, label: &AccountMenuLabel) {
    // SAFETY: Windows provides a live owner HWND for this menu callback.
    let hdc = unsafe { GetDC(hwnd) };
    if hdc.is_null() {
        return;
    }
    if let Some(context) = DrawingContext::new(hwnd, hdc) {
        let extent = context.label_extent(label);
        item.itemWidth = (context.text_offset() + extent.cx + context.scale(TEXT_PADDING)) as u32;
        item.itemHeight = context.row_height(extent.cy) as u32;
    }
    // SAFETY: The drawing context restored the acquired HDC before release.
    unsafe { ReleaseDC(hwnd, hdc) };
}

pub(super) fn draw(hwnd: HWND, item: &DRAWITEMSTRUCT, label: &AccountMenuLabel) {
    let Some(context) = DrawingContext::new(hwnd, item.hDC) else {
        return;
    };
    let theme = MenuTheme::new(hwnd);
    let selected = item.itemState & ODS_SELECTED != 0;
    let themed_selection = draw_background(item, &theme, selected);
    if item.itemState & ODS_CHECKED != 0 {
        draw_check(item, &context, &theme);
    }
    let default_color = normal_text_color(item, selected && !themed_selection);
    let mut text_rect = item.rcItem;
    text_rect.left += context.text_offset();
    for segment in &label.segments {
        let text = segment
            .text
            .replace("&&", "&")
            .encode_utf16()
            .collect::<Vec<_>>();
        let color = if item.itemState & ODS_DISABLED != 0 {
            default_color
        } else {
            segment.color.map(rgb).unwrap_or(default_color)
        };
        context.draw_text(&text, &mut text_rect, color);
    }
}

fn normal_text_color(item: &DRAWITEMSTRUCT, classic_selection: bool) -> COLORREF {
    let color = if item.itemState & ODS_DISABLED != 0 {
        COLOR_GRAYTEXT
    } else if classic_selection {
        COLOR_HIGHLIGHTTEXT
    } else {
        COLOR_MENUTEXT
    };
    // SAFETY: GetSysColor reads a predefined system color and owns no resources.
    unsafe { GetSysColor(color) }
}

fn draw_background(item: &DRAWITEMSTRUCT, theme: &MenuTheme, selected: bool) -> bool {
    // SAFETY: The HDC and rectangle are valid throughout this WM_DRAWITEM callback.
    unsafe { FillRect(item.hDC, &item.rcItem, GetSysColorBrush(COLOR_MENU)) };
    if !selected {
        return false;
    }
    if theme.draw(item.hDC, MENU_POPUPITEM, MPI_HOT, &item.rcItem) {
        return true;
    }
    // SAFETY: GetSysColorBrush returns a shared system brush that must not be deleted.
    unsafe { FillRect(item.hDC, &item.rcItem, GetSysColorBrush(COLOR_HIGHLIGHT)) };
    false
}

fn draw_check(item: &DRAWITEMSTRUCT, context: &DrawingContext, theme: &MenuTheme) {
    let size = context.check_width();
    let left = item.rcItem.left + context.scale(CHECK_PADDING);
    let top = item.rcItem.top + (item.rcItem.bottom - item.rcItem.top - size) / 2;
    let mut check_rect = RECT {
        left,
        top,
        right: left + size,
        bottom: top + size,
    };
    let padding = context.scale(2);
    let background = RECT {
        left: check_rect.left - padding,
        top: check_rect.top - padding,
        right: check_rect.right + padding,
        bottom: check_rect.bottom + padding,
    };
    theme.draw(item.hDC, MENU_POPUPCHECKBACKGROUND, MCB_NORMAL, &background);
    if theme.draw(item.hDC, MENU_POPUPCHECK, MC_CHECKMARKNORMAL, &check_rect) {
        return;
    }
    // SAFETY: The menu callback owns this drawing surface and initialized check rectangle.
    unsafe { DrawFrameControl(item.hDC, &mut check_rect, DFC_MENU, DFCS_MENUCHECK) };
}

struct DrawingContext {
    hdc: HDC,
    saved: i32,
    font: HFONT,
    dpi: u32,
}

impl DrawingContext {
    fn new(hwnd: HWND, hdc: HDC) -> Option<Self> {
        // SAFETY: Saving state precedes all mutations; failure leaves the HDC untouched.
        let saved = unsafe { SaveDC(hdc) };
        if saved == 0 {
            return None;
        }
        // SAFETY: The caller supplies the owner window and its live drawing context.
        let dpi = unsafe { GetDpiForWindow(hwnd) }.max(DEFAULT_DPI);
        let font = menu_font(dpi);
        // SAFETY: SaveDC keeps all caller GDI state intact; selected font stays alive until Drop.
        unsafe {
            let selected_font = if font.is_null() {
                GetStockObject(DEFAULT_GUI_FONT)
            } else {
                font
            };
            SelectObject(hdc, selected_font);
            SetBkMode(hdc, TRANSPARENT as i32);
        };
        Some(Self {
            hdc,
            saved,
            font,
            dpi,
        })
    }

    fn scale(&self, logical: i32) -> i32 {
        (logical * self.dpi as i32 + DEFAULT_DPI as i32 / 2) / DEFAULT_DPI as i32
    }

    fn check_width(&self) -> i32 {
        // SAFETY: The metric index and DPI originate from system menu settings.
        unsafe { GetSystemMetricsForDpi(SM_CXMENUCHECK, self.dpi) }
    }

    fn text_offset(&self) -> i32 {
        self.check_width() + self.scale(CHECK_PADDING + TEXT_PADDING)
    }

    fn row_height(&self, text_height: i32) -> i32 {
        // SAFETY: Reading this metric does not mutate native state.
        let system_height = unsafe { GetSystemMetricsForDpi(SM_CYMENU, self.dpi) };
        system_height.max(text_height + self.scale(VERTICAL_PADDING))
    }

    fn label_extent(&self, label: &AccountMenuLabel) -> SIZE {
        label
            .segments
            .iter()
            .fold(SIZE::default(), |mut size, segment| {
                let text = segment
                    .text
                    .replace("&&", "&")
                    .encode_utf16()
                    .collect::<Vec<_>>();
                let extent = self.text_extent(&text);
                size.cx += extent.cx;
                size.cy = size.cy.max(extent.cy);
                size
            })
    }

    fn text_extent(&self, text: &[u16]) -> SIZE {
        let mut size = SIZE::default();
        // SAFETY: The slice contains the specified UTF-16 units and HDC has a selected live font.
        unsafe { GetTextExtentPoint32W(self.hdc, text.as_ptr(), text.len() as i32, &mut size) };
        size
    }

    fn draw_text(&self, text: &[u16], rect: &mut RECT, color: COLORREF) {
        // SAFETY: Text and rectangle remain valid during drawing; Drop restores the HDC state.
        unsafe {
            SetTextColor(self.hdc, color);
            DrawTextW(
                self.hdc,
                text.as_ptr(),
                text.len() as i32,
                rect,
                DT_SINGLELINE | DT_VCENTER | DT_NOPREFIX,
            );
        }
        rect.left += self.text_extent(text).cx;
    }
}

impl Drop for DrawingContext {
    fn drop(&mut self) {
        // SAFETY: RestoreDC deselects our font before deleting it; shared stock fonts are excluded.
        unsafe {
            if self.saved != 0 {
                RestoreDC(self.hdc, self.saved);
            }
            if !self.font.is_null() {
                DeleteObject(self.font);
            }
        }
    }
}

fn menu_font(dpi: u32) -> HFONT {
    let mut metrics = NONCLIENTMETRICSW {
        cbSize: size_of::<NONCLIENTMETRICSW>() as u32,
        ..Default::default()
    };
    // SAFETY: The system receives a correctly sized writable NONCLIENTMETRICSW structure.
    unsafe {
        if SystemParametersInfoForDpi(
            SPI_GETNONCLIENTMETRICS,
            metrics.cbSize,
            (&mut metrics as *mut NONCLIENTMETRICSW).cast(),
            0,
            dpi,
        ) == 0
        {
            return std::ptr::null_mut();
        }
        CreateFontIndirectW(&metrics.lfMenuFont)
    }
}

struct MenuTheme(HTHEME);

impl MenuTheme {
    fn new(hwnd: HWND) -> Self {
        // SAFETY: MENU_THEME is a terminated UTF-16 class string and hwnd is the live menu owner.
        Self(unsafe { OpenThemeData(hwnd, MENU_THEME.as_ptr()) })
    }

    fn draw(&self, hdc: HDC, part: i32, state: i32, rect: &RECT) -> bool {
        if self.0 == 0 {
            return false;
        }
        // SAFETY: The theme handle lives for this callback, and HDC/rectangle come from Windows.
        unsafe { DrawThemeBackground(self.0, hdc, part, state, rect, std::ptr::null()) >= 0 }
    }
}

impl Drop for MenuTheme {
    fn drop(&mut self) {
        if self.0 != 0 {
            // SAFETY: This handle was opened by this instance and is closed exactly once.
            unsafe { CloseThemeData(self.0) };
        }
    }
}
