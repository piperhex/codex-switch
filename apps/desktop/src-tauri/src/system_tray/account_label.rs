use crate::models::UsageSummary;

use super::escape_menu_text;

const MENU_EMAIL_CHARS: usize = 15;
const SEPARATOR: &str = " · ";

pub(super) fn account_label(email: &str, usage: &UsageSummary, chinese: bool) -> String {
    let email = truncate_email(email);
    let (primary, secondary) = if chinese {
        ("主", "次")
    } else {
        ("Primary", "Secondary")
    };
    format!(
        "{}{SEPARATOR}{primary} {}{SEPARATOR}{secondary} {}",
        escape_menu_text(&email),
        remaining_label(
            usage
                .primary
                .as_ref()
                .map(|window| window.remaining_percent)
        ),
        remaining_label(
            usage
                .secondary
                .as_ref()
                .map(|window| window.remaining_percent)
        ),
    )
}

fn truncate_email(text: &str) -> String {
    let mut chars = text.chars();
    let truncated = chars.by_ref().take(MENU_EMAIL_CHARS).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else {
        truncated
    }
}

fn remaining_label(remaining: Option<f64>) -> String {
    remaining
        .filter(|value| value.is_finite())
        .map(|value| format!("{}%", value.round().clamp(0.0, 100.0)))
        .unwrap_or_else(|| "--".to_string())
}

#[cfg(any(windows, test))]
pub(super) struct MenuTextSegment {
    pub(super) text: String,
    pub(super) color: Option<[u8; 3]>,
}

/// Splits the native label into runs so only remaining percentages receive a color.
#[cfg(any(windows, test))]
pub(super) struct AccountMenuLabel {
    pub(super) segments: Vec<MenuTextSegment>,
}

#[cfg(any(windows, test))]
impl AccountMenuLabel {
    pub(super) fn from_text(text: &str, good_color: [u8; 3]) -> Option<Self> {
        let (prefix, secondary) = text.rsplit_once(SEPARATOR)?;
        let (email, primary) = prefix.rsplit_once(SEPARATOR)?;
        let (primary_marker, primary_value) = primary.split_once(' ')?;
        let (secondary_marker, secondary_value) = secondary.split_once(' ')?;
        if !matches!(
            (primary_marker, secondary_marker),
            ("主", "次") | ("Primary", "Secondary")
        ) {
            return None;
        }
        Some(Self {
            segments: vec![
                MenuTextSegment {
                    text: format!("{email}{SEPARATOR}{primary_marker} "),
                    color: None,
                },
                percentage_segment(primary_value, good_color)?,
                MenuTextSegment {
                    text: format!("{SEPARATOR}{secondary_marker} "),
                    color: None,
                },
                percentage_segment(secondary_value, good_color)?,
            ],
        })
    }
}

#[cfg(any(windows, test))]
fn percentage_segment(text: &str, good_color: [u8; 3]) -> Option<MenuTextSegment> {
    const DANGER_THRESHOLD: u8 = 15;
    const WARNING_THRESHOLD: u8 = 35;
    const DANGER_COLOR: [u8; 3] = [0xb9, 0x4b, 0x42];
    const WARNING_COLOR: [u8; 3] = [0xa8, 0x75, 0x15];
    let color = if text == "--" {
        None
    } else {
        let percent = text.strip_suffix('%')?.parse::<u8>().ok()?;
        // Keep these boundaries in sync with remainingTone in src/utils/format.ts.
        if percent > 100 {
            return None;
        }
        Some(if percent <= DANGER_THRESHOLD {
            DANGER_COLOR
        } else if percent <= WARNING_THRESHOLD {
            WARNING_COLOR
        } else {
            good_color
        })
    };
    Some(MenuTextSegment {
        text: text.to_string(),
        color,
    })
}

#[cfg(windows)]
pub(super) fn theme_color(value: Option<&str>) -> [u8; 3] {
    const DEFAULT_COLOR: [u8; 3] = [0x35, 0xad, 0xa7];
    let Some(hex) = value.and_then(|value| value.trim().strip_prefix('#')) else {
        return DEFAULT_COLOR;
    };
    if !hex.bytes().all(|character| character.is_ascii_hexdigit()) {
        return DEFAULT_COLOR;
    }
    let expanded = match hex.len() {
        3 => hex
            .chars()
            .flat_map(|character| [character, character])
            .collect::<String>(),
        6 => hex.to_string(),
        _ => return DEFAULT_COLOR,
    };
    let Ok(rgb) = u32::from_str_radix(&expanded, 16) else {
        return DEFAULT_COLOR;
    };
    [(rgb >> 16) as u8, (rgb >> 8) as u8, rgb as u8]
}

#[cfg(test)]
mod tests;
