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
        DesktopInput::Wheel { delta, .. } if !(-1200..=1200).contains(delta) => {
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
    fn accepts_both_wheel_axes_and_defaults_old_messages_to_vertical() {
        for (json, expected) in [
            (r#"{"kind":"wheel","delta":120}"#, false),
            (r#"{"kind":"wheel","delta":-120,"horizontal":true}"#, true),
        ] {
            let decoded: DesktopInput = serde_json::from_str(json).unwrap();
            assert!(input(&decoded).is_ok());
            assert!(
                matches!(decoded, DesktopInput::Wheel { horizontal, .. } if horizontal == expected)
            );
        }
        assert!(serde_json::from_str::<DesktopInput>(
            r#"{"kind":"wheel","delta":120,"horizontal":"yes"}"#
        )
        .is_err());
    }
    #[test]
    fn rejects_invalid_coordinates_and_oversized_input() {
        assert!(input(&DesktopInput::Move {
            x: f64::NAN,
            y: 0.0
        })
        .is_err());
        assert!(input(&DesktopInput::Move { x: 1.1, y: 0.0 }).is_err());
        assert!(input(&DesktopInput::Move { x: 0.5, y: 0.5 }).is_ok());
        assert!(input(&DesktopInput::Wheel {
            delta: i32::MIN,
            horizontal: true
        })
        .is_err());
        assert!(input(&DesktopInput::Text {
            text: "a".repeat(4097)
        })
        .is_err());
        assert!(width(u32::MAX).is_err());
    }
}
