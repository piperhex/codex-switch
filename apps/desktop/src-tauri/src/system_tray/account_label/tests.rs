use super::*;
use crate::models::UsageWindow;

const GOOD_COLOR: [u8; 3] = [0x35, 0xad, 0xa7];

fn usage_window(remaining_percent: f64) -> UsageWindow {
    UsageWindow {
        remaining_percent,
        used_percent: 100.0 - remaining_percent,
        resets_at: None,
        window_minutes: None,
    }
}

#[test]
fn labels_use_primary_secondary_and_preserve_remaining_semantics() {
    let usage = UsageSummary {
        primary: Some(usage_window(46.6)),
        ..UsageSummary::default()
    };
    assert_eq!(
        account_label("a&b@test", &usage, true),
        "a&&b@test · 主 47% · 次 --"
    );
    assert_eq!(
        account_label("a@test", &usage, false),
        "a@test · Primary 47% · Secondary --"
    );
    assert_eq!(remaining_label(Some(-10.0)), "0%");
    assert_eq!(remaining_label(Some(150.0)), "100%");
    assert_eq!(remaining_label(Some(f64::NAN)), "--");
    assert_eq!(remaining_label(Some(f64::INFINITY)), "--");
}

#[test]
fn each_percentage_uses_the_existing_usage_thresholds() {
    for (percent, expected) in [
        (0, [0xb9, 0x4b, 0x42]),
        (15, [0xb9, 0x4b, 0x42]),
        (16, [0xa8, 0x75, 0x15]),
        (35, [0xa8, 0x75, 0x15]),
        (36, GOOD_COLOR),
        (100, GOOD_COLOR),
    ] {
        let text = format!("test · 主 {percent}% · 次 --");
        let label = AccountMenuLabel::from_text(&text, GOOD_COLOR).unwrap();
        assert_eq!(label.segments[1].color, Some(expected));
        assert_eq!(label.segments[3].color, None);
        assert_eq!(
            label
                .segments
                .iter()
                .map(|segment| segment.text.as_str())
                .collect::<String>(),
            text
        );
    }
}

#[test]
fn parsing_keeps_account_text_neutral_and_handles_independent_windows() {
    let label = AccountMenuLabel::from_text("a · b&c · 主 10% · 次 60%", GOOD_COLOR).unwrap();
    assert_eq!(label.segments[0].text, "a · b&c · 主 ");
    assert_eq!(label.segments[0].color, None);
    assert_eq!(label.segments[1].color, Some([0xb9, 0x4b, 0x42]));
    assert_eq!(label.segments[2].color, None);
    assert_eq!(label.segments[3].color, Some(GOOD_COLOR));
    assert!(AccountMenuLabel::from_text("a · Primary 35% · Secondary 100%", GOOD_COLOR).is_some());
    for text in [
        "Provider · model",
        "test · 主 101% · 次 --",
        "test · 主 NaN% · 次 --",
    ] {
        assert!(AccountMenuLabel::from_text(text, GOOD_COLOR).is_none());
    }
}

#[test]
fn usage_colors_follow_the_rounded_percentage_shown_to_the_user() {
    for (remaining, displayed, expected_color) in [
        (15.49, "15%", [0xb9, 0x4b, 0x42]),
        (15.5, "16%", [0xa8, 0x75, 0x15]),
        (35.49, "35%", [0xa8, 0x75, 0x15]),
        (35.5, "36%", GOOD_COLOR),
    ] {
        let usage = UsageSummary {
            primary: Some(usage_window(remaining)),
            ..UsageSummary::default()
        };
        let text = account_label("test", &usage, true);
        let label = AccountMenuLabel::from_text(&text, GOOD_COLOR).unwrap();

        assert_eq!(label.segments[1].text, displayed);
        assert_eq!(label.segments[1].color, Some(expected_color));
    }
}

#[test]
fn email_truncation_preserves_unicode_characters_and_exact_length_names() {
    let short_name = "一二三四五六七八九十甲乙丙丁😀";
    assert_eq!(truncate_email(short_name), short_name);
    assert_eq!(
        truncate_email(&format!("{short_name}戊@example.com")),
        format!("{short_name}...")
    );

    let text = account_label(
        &format!("{short_name}&@example.com"),
        &UsageSummary::default(),
        true,
    );
    assert_eq!(text, format!("{short_name}... · 主 -- · 次 --"));
    let label = AccountMenuLabel::from_text(&text, GOOD_COLOR).unwrap();
    assert!(label.segments.iter().all(|segment| segment.color.is_none()));
}

#[test]
fn custom_theme_color_applies_only_to_sufficient_remaining_usage() {
    let custom_color = [0x12, 0x34, 0x56];
    let label = AccountMenuLabel::from_text("test · 主 90% · 次 10%", custom_color).unwrap();

    assert_eq!(label.segments[1].color, Some(custom_color));
    assert_eq!(label.segments[3].color, Some([0xb9, 0x4b, 0x42]));
    assert_eq!(label.segments[0].color, None);
    assert_eq!(label.segments[2].color, None);
}

#[cfg(windows)]
#[test]
fn menu_theme_color_matches_saved_and_legacy_frontend_values() {
    assert_eq!(theme_color(Some(" #aBc ")), [0xaa, 0xbb, 0xcc]);
    assert_eq!(theme_color(Some("#12ABef")), [0x12, 0xab, 0xef]);
    for value in [
        None,
        Some(""),
        Some("#abcd"),
        Some("123456"),
        Some("#zzzzzz"),
        Some("#中文"),
    ] {
        assert_eq!(theme_color(value), GOOD_COLOR);
    }
}
