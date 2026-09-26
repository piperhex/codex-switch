use super::{DesktopError, DesktopInput, Result};

pub(super) fn width(value: u32) -> Result<()> {
    if !(320..=2560).contains(&value) {
        return Err(DesktopError::Invalid);
    }
    Ok(())
}
pub(super) fn input(input: &DesktopInput) -> Result<()> {
    match input {
        DesktopInput::Move { x, y } if !(0.0..=1.0).contains(x) || !(0.0..=1.0).contains(y) => {
            Err(DesktopError::Invalid)
        }
        DesktopInput::Wheel { delta } if !(-1200..=1200).contains(delta) => {
            Err(DesktopError::Invalid)
        }
        DesktopInput::Text { text } if text.len() > 4096 || text.contains('\0') => {
            Err(DesktopError::Invalid)
        }
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_coordinates_and_oversized_input() {
        assert!(input(&DesktopInput::Move {
            x: f64::NAN,
            y: 0.0
        })
        .is_err());
        assert!(input(&DesktopInput::Move { x: 1.1, y: 0.0 }).is_err());
        assert!(input(&DesktopInput::Move { x: 0.5, y: 0.5 }).is_ok());
        assert!(input(&DesktopInput::Wheel { delta: i32::MIN }).is_err());
        assert!(input(&DesktopInput::Text {
            text: "a".repeat(4097)
        })
        .is_err());
        assert!(width(u32::MAX).is_err());
    }
}
