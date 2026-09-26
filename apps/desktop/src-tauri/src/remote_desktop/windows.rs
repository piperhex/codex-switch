use super::{Button, DesktopError, DesktopInput, Key, Result};
use image::codecs::jpeg::JpegEncoder;
use std::{mem::size_of, ptr};
use windows_sys::Win32::{
    Graphics::Gdi::*,
    UI::{Input::KeyboardAndMouse::*, WindowsAndMessaging::*},
};

const JPEG_QUALITY: u8 = 85;
const MAX_PIXELS: usize = 16_777_216;

struct Capture {
    screen: HDC,
    memory: HDC,
    bitmap: HBITMAP,
    previous: HGDIOBJ,
    pixels: *mut u8,
    width: i32,
    height: i32,
}
impl Drop for Capture {
    fn drop(&mut self) {
        // SAFETY: These GDI resources are owned by this capture and restored before deletion.
        unsafe {
            if !self.previous.is_null() {
                SelectObject(self.memory, self.previous);
            }
            if !self.bitmap.is_null() {
                DeleteObject(self.bitmap);
            }
            if !self.memory.is_null() {
                DeleteDC(self.memory);
            }
            if !self.screen.is_null() {
                ReleaseDC(ptr::null_mut(), self.screen);
            }
        }
    }
}

impl Capture {
    fn new(width: u32) -> Result<Self> {
        // SAFETY: GetSystemMetrics has no pointer arguments and returns the current primary display dimensions.
        let (source_width, source_height) =
            unsafe { (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN)) };
        if source_width <= 0 || source_height <= 0 {
            return Err(DesktopError::Platform);
        }
        let width = (width as i32).min(source_width);
        let height =
            ((i64::from(source_height) * i64::from(width)) / i64::from(source_width)) as i32;
        if height <= 0 || width as usize * height as usize > MAX_PIXELS {
            return Err(DesktopError::Platform);
        }
        let mut capture = Self {
            screen: ptr::null_mut(),
            memory: ptr::null_mut(),
            bitmap: ptr::null_mut(),
            previous: ptr::null_mut(),
            pixels: ptr::null_mut(),
            width,
            height,
        };
        capture.allocate()?;
        capture.copy(source_width, source_height)?;
        Ok(capture)
    }

    fn allocate(&mut self) -> Result<()> {
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: self.width,
                biHeight: -self.height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                ..Default::default()
            },
            ..Default::default()
        };
        // SAFETY: info and output pointer remain valid during allocation; Drop owns every acquired handle.
        unsafe {
            self.screen = GetDC(ptr::null_mut());
            if self.screen.is_null() {
                return Err(DesktopError::Platform);
            }
            self.memory = CreateCompatibleDC(self.screen);
            if self.memory.is_null() {
                return Err(DesktopError::Platform);
            }
            let mut pixels = ptr::null_mut();
            self.bitmap = CreateDIBSection(
                self.screen,
                &info,
                DIB_RGB_COLORS,
                &mut pixels,
                ptr::null_mut(),
                0,
            );
            if self.bitmap.is_null() || pixels.is_null() {
                return Err(DesktopError::Platform);
            }
            self.pixels = pixels.cast();
            self.previous = SelectObject(self.memory, self.bitmap);
        }
        Ok(())
    }

    fn copy(&self, width: i32, height: i32) -> Result<()> {
        // SAFETY: both DCs and the selected DIB are live; source and destination dimensions are validated.
        unsafe {
            SetStretchBltMode(self.memory, HALFTONE);
            if StretchBlt(
                self.memory,
                0,
                0,
                self.width,
                self.height,
                self.screen,
                0,
                0,
                width,
                height,
                SRCCOPY | CAPTUREBLT,
            ) == 0
            {
                return Err(DesktopError::Platform);
            }
            let mut cursor = CURSORINFO {
                cbSize: size_of::<CURSORINFO>() as u32,
                ..Default::default()
            };
            if GetCursorInfo(&mut cursor) != 0 && cursor.flags == CURSOR_SHOWING {
                DrawIconEx(
                    self.memory,
                    cursor.ptScreenPos.x * self.width / width,
                    cursor.ptScreenPos.y * self.height / height,
                    cursor.hCursor,
                    24 * self.width / width,
                    24 * self.height / height,
                    0,
                    ptr::null_mut(),
                    DI_NORMAL,
                );
            }
            GdiFlush();
        }
        Ok(())
    }
}

pub(super) fn capture(width: u32) -> Result<Vec<u8>> {
    let capture = Capture::new(width)?;
    let length = capture.width as usize * capture.height as usize * 4;
    // SAFETY: CreateDIBSection allocated width * height BGRA pixels; the owner stays live for this slice.
    let pixels = unsafe { std::slice::from_raw_parts(capture.pixels, length) };
    let mut rgb = Vec::with_capacity(length / 4 * 3);
    for pixel in pixels.chunks_exact(4) {
        rgb.extend_from_slice(&[pixel[2], pixel[1], pixel[0]]);
    }
    let mut encoded = Vec::new();
    JpegEncoder::new_with_quality(&mut encoded, JPEG_QUALITY)
        .encode(
            &rgb,
            capture.width as u32,
            capture.height as u32,
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|_| DesktopError::Platform)?;
    Ok(encoded)
}

fn mouse(flags: u32, data: u32) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dwFlags: flags,
                mouseData: data,
                ..Default::default()
            },
        },
    }
}
fn key(code: u16, flags: u32) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: code,
                dwFlags: flags,
                ..Default::default()
            },
        },
    }
}
fn send(inputs: &[INPUT]) -> Result<()> {
    // SAFETY: the slice is fully initialized and its ABI size matches INPUT for this target.
    let count = unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_ptr(),
            size_of::<INPUT>() as i32,
        )
    };
    if count != inputs.len() as u32 {
        return Err(DesktopError::Platform);
    }
    Ok(())
}
pub(super) fn release_buttons() -> Result<()> {
    send(&[mouse(MOUSEEVENTF_LEFTUP, 0), mouse(MOUSEEVENTF_RIGHTUP, 0)])
}
pub(super) fn input(input: DesktopInput) -> Result<()> {
    match input {
        DesktopInput::Move { x, y } => {
            // SAFETY: system dimensions are read without pointers and coordinates were validated at the boundary.
            let moved = unsafe {
                SetCursorPos(
                    (x * f64::from(GetSystemMetrics(SM_CXSCREEN) - 1)).round() as i32,
                    (y * f64::from(GetSystemMetrics(SM_CYSCREEN) - 1)).round() as i32,
                )
            };
            if moved == 0 {
                return Err(DesktopError::Platform);
            }
            Ok(())
        }
        DesktopInput::Button { button, down } => {
            let flags = match (button, down) {
                (Button::Left, true) => MOUSEEVENTF_LEFTDOWN,
                (Button::Left, false) => MOUSEEVENTF_LEFTUP,
                (Button::Right, true) => MOUSEEVENTF_RIGHTDOWN,
                (Button::Right, false) => MOUSEEVENTF_RIGHTUP,
            };
            send(&[mouse(flags, 0)])
        }
        DesktopInput::Wheel { delta } => send(&[mouse(MOUSEEVENTF_WHEEL, delta as u32)]),
        DesktopInput::Text { text } => text_input(&text),
        DesktopInput::Key { key: value } => shortcut(value),
    }
}
fn text_input(text: &str) -> Result<()> {
    let mut inputs = Vec::new();
    for character in text.encode_utf16() {
        for flags in [KEYEVENTF_UNICODE, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP] {
            inputs.push(INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wScan: character,
                        dwFlags: flags,
                        ..Default::default()
                    },
                },
            });
        }
    }
    if inputs.is_empty() {
        return Ok(());
    }
    send(&inputs)
}
fn shortcut(value: Key) -> Result<()> {
    let code = match value {
        Key::Enter => VK_RETURN,
        Key::Backspace => VK_BACK,
        Key::Escape => VK_ESCAPE,
        Key::Tab => VK_TAB,
        Key::Desktop => 0x44,
        Key::Windows => VK_TAB,
    };
    if matches!(value, Key::Desktop | Key::Windows) {
        return send(&[
            key(VK_LWIN, 0),
            key(code, 0),
            key(code, KEYEVENTF_KEYUP),
            key(VK_LWIN, KEYEVENTF_KEYUP),
        ]);
    }
    send(&[key(code, 0), key(code, KEYEVENTF_KEYUP)])
}

#[cfg(test)]
mod tests {
    #[test]
    #[ignore = "requires an unlocked interactive Windows desktop"]
    fn captures_a_valid_primary_display_frame() {
        let encoded = super::capture(640).expect("capture primary display");
        let frame = image::load_from_memory(&encoded).expect("decode captured JPEG");
        assert!(frame.width() > 0 && frame.width() <= 640);
        assert!(frame.height() > 0);
    }
}
