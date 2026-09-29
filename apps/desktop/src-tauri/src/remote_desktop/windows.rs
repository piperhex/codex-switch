use super::{DesktopError, Result};
use image::codecs::jpeg::JpegEncoder;
use std::{mem::size_of, ptr};
use windows_sys::Win32::Graphics::Gdi::*;

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
    fn new(width: u32, display: &super::monitors::Monitor) -> Result<Self> {
        let bounds = display.refresh()?.bounds;
        let (source_width, source_height) = (bounds.width as i32, bounds.height as i32);
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
        capture.copy(bounds)?;
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

    fn copy(&self, bounds: super::displays::Bounds) -> Result<()> {
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
                bounds.x,
                bounds.y,
                bounds.width as i32,
                bounds.height as i32,
                SRCCOPY | CAPTUREBLT,
            ) == 0
            {
                return Err(DesktopError::Platform);
            }
            // The viewer draws its own pointer; do not burn the host cursor into the frame.
            GdiFlush();
        }
        Ok(())
    }
}

pub(super) fn capture(width: u32, display: &super::monitors::Monitor) -> Result<Vec<u8>> {
    let _dpi = super::monitors::PhysicalPixels::enter()?;
    let capture = Capture::new(width, display)?;
    let length = capture.width as usize * capture.height as usize * 4;
    // SAFETY: CreateDIBSection allocated width * height BGRA pixels; the owner stays live for this slice.
    let pixels = unsafe { std::slice::from_raw_parts(capture.pixels, length) };
    let mut rgb = Vec::with_capacity(length / 4 * 3);
    for pixel in pixels.as_chunks::<4>().0 {
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

#[cfg(test)]
mod tests {
    #[test]
    #[ignore = "requires an unlocked interactive Windows desktop"]
    fn captures_a_valid_primary_display_frame() {
        let monitors = super::super::monitors::list().expect("enumerate displays");
        let display = super::super::monitors::select(&monitors, None).expect("primary display");
        let encoded = super::capture(640, &display).expect("capture primary display");
        let frame = image::load_from_memory(&encoded).expect("decode captured JPEG");
        assert!(frame.width() > 0 && frame.width() <= 640);
        assert!(frame.height() > 0);
    }

    #[test]
    #[ignore = "requires an unlocked interactive Windows desktop"]
    fn captures_each_connected_display_with_its_own_aspect_ratio() {
        let monitors = super::super::monitors::list().expect("enumerate displays");
        for display in monitors {
            let encoded = super::capture(640, &display).expect("capture selected display");
            let frame = image::load_from_memory(&encoded).expect("decode selected display");
            let expected_height = u64::from(display.bounds.height) * u64::from(frame.width())
                / u64::from(display.bounds.width);
            assert_eq!(u64::from(frame.height()), expected_height);
            println!(
                "{}: {:?} -> {}x{}",
                display.info.name,
                display.bounds,
                frame.width(),
                frame.height()
            );
        }
    }
}
