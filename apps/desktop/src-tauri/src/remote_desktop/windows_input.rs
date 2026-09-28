use super::{keyboard::KeyboardKey, Button, DesktopError, DesktopInput, Key, Result};
use std::{collections::BTreeSet, mem::size_of};
use windows_sys::Win32::UI::{Input::KeyboardAndMouse::*, WindowsAndMessaging::*};

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
#[derive(Default)]
pub(super) struct InputState {
    held: BTreeSet<KeyboardKey>,
}
impl InputState {
    pub(super) fn release(&mut self) -> Result<()> {
        let mut inputs = vec![
            mouse(MOUSEEVENTF_LEFTUP, 0),
            mouse(MOUSEEVENTF_RIGHTUP, 0),
            mouse(MOUSEEVENTF_MIDDLEUP, 0),
        ];
        inputs.extend(self.held.iter().map(|code| physical_key(*code, false)));
        send(&inputs)?;
        self.held.clear();
        Ok(())
    }
    pub(super) fn apply(
        &mut self,
        input: DesktopInput,
        display: &super::monitors::Monitor,
    ) -> Result<()> {
        if let DesktopInput::Keyboard { code, down } = input {
            send(&[physical_key(code, down)])?;
            if down {
                self.held.insert(code);
            } else {
                self.held.remove(&code);
            }
            return Ok(());
        }
        input_event(input, display)
    }
}

fn physical_key(code: KeyboardKey, down: bool) -> INPUT {
    let extended = if code.extended {
        KEYEVENTF_EXTENDEDKEY
    } else {
        0
    };
    key(code.code, extended | if down { 0 } else { KEYEVENTF_KEYUP })
}

fn input_event(input: DesktopInput, display: &super::monitors::Monitor) -> Result<()> {
    let _dpi = super::monitors::PhysicalPixels::enter()?;
    let bounds = display.refresh()?.bounds;
    match input {
        DesktopInput::Move { x, y } => {
            let (x, y) = bounds.point(x, y);
            // SAFETY: coordinates map validated normalized input to the selected live display.
            let moved = unsafe { SetCursorPos(x, y) };
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
                (Button::Middle, true) => MOUSEEVENTF_MIDDLEDOWN,
                (Button::Middle, false) => MOUSEEVENTF_MIDDLEUP,
            };
            send(&[mouse(flags, 0)])
        }
        DesktopInput::Wheel { delta } => send(&[mouse(MOUSEEVENTF_WHEEL, delta as u32)]),
        DesktopInput::Text { text } => text_input(&text),
        DesktopInput::Key { key: value } => shortcut(value),
        DesktopInput::Keyboard { .. } => Err(DesktopError::Invalid),
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

pub(super) fn clipboard_shortcut(code: u16) -> Result<()> {
    send(&[
        key(VK_CONTROL, 0),
        key(code, 0),
        key(code, KEYEVENTF_KEYUP),
        key(VK_CONTROL, KEYEVENTF_KEYUP),
    ])
}
