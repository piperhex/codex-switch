use super::*;

const VERSION: &str = "0123456789abcdef0123456789abcdef";

fn release_with_asset(version: &str, include_asset: bool) -> GithubRelease {
    let assets = include_asset
        .then(|| GithubAsset {
            name: format!("dream-skin-resources-{version}.zip"),
            browser_download_url: "https://example.invalid/resources.zip".to_string(),
            size: 42,
        })
        .into_iter()
        .collect();
    GithubRelease {
        tag_name: format!("dream-skin-{version}"),
        draft: false,
        assets,
    }
}

#[test]
fn resource_versions_are_lowercase_md5_values() {
    assert!(valid_version(VERSION));
    assert!(!valid_version("0123456789ABCDEF0123456789ABCDEF"));
    assert!(!valid_version("v1"));
}

#[test]
fn release_selection_requires_matching_versioned_asset() {
    let selected = select_release(vec![release_with_asset(VERSION, true)])
        .expect("release should be selected");
    assert_eq!(selected.version, VERSION);
    assert_eq!(selected.size, 42);
}

#[test]
fn release_selection_skips_invalid_candidates() {
    let selected = select_release(vec![
        release_with_asset(VERSION, false),
        release_with_asset(VERSION, true),
    ])
    .expect("later valid release should be selected");
    assert_eq!(selected.version, VERSION);
}
