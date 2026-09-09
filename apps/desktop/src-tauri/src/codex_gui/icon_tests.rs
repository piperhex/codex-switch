use super::*;
use serde_json::json;

struct Package(std::path::PathBuf);

impl Package {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("gui-icons-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("skills/demo/assets")).unwrap();
        std::fs::write(root.join("skills/demo/SKILL.md"), "demo").unwrap();
        std::fs::write(root.join("skills/demo/assets/icon.svg"), "<svg/>").unwrap();
        Self(root)
    }

    fn skill(&self, icon: &Path) -> Value {
        json!({"path": self.0.join("skills/demo/SKILL.md"),
            "interface": {"iconSmall": icon}, "enabled": true, "name": "demo"})
    }
}

impl Drop for Package {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn embeds_local_skill_icons_and_preserves_catalog_state() {
    let package = Package::new();
    let skill = package.skill(&package.0.join("skills/demo/assets/icon.svg"));
    let response = enrich(json!({"data": [{"skills": [skill], "errors": []}]}), true);
    let skill = &response["data"][0]["skills"][0];
    assert_eq!(skill["iconUrl"], "data:image/svg+xml;base64,PHN2Zy8+");
    assert_eq!(skill["name"], "demo");
    assert_eq!(skill["enabled"], true);
    assert_eq!(response["data"][0]["errors"], json!([]));
}

#[test]
fn permits_shared_package_icons_but_rejects_assets_outside_the_package() {
    let package = Package::new();
    let shared = package.0.join("shared.svg");
    std::fs::write(&shared, "<svg/>").unwrap();
    let skill = package.skill(&shared);
    assert!(skill_icon(&skill).is_none());
    std::fs::create_dir(package.0.join(".codex-plugin")).unwrap();
    std::fs::write(package.0.join(".codex-plugin/plugin.json"), "{}").unwrap();
    assert!(skill_icon(&skill).is_some());
    let outside = Package::new();
    assert!(skill_icon(&package.skill(&outside.0.join("skills/demo/assets/icon.svg"))).is_none());
}

#[test]
fn falls_back_from_missing_small_icons_and_rejects_non_images() {
    let package = Package::new();
    let mut skill = package.skill(&package.0.join("missing.svg"));
    skill["interface"]["iconLarge"] = json!(package.0.join("skills/demo/assets/icon.svg"));
    assert!(skill_icon(&skill).is_some());
    skill["interface"]["iconLarge"] = json!(package.0.join("skills/demo/SKILL.md"));
    assert!(skill_icon(&skill).is_none());
}

#[test]
fn uses_https_catalog_icons_and_falls_back_from_unsafe_urls() {
    let package = Package::new();
    let mut skill = package.skill(&package.0.join("skills/demo/assets/icon.svg"));
    skill["interface"]["iconSmallUrl"] = json!("https://example.com/icon.svg");
    assert_eq!(
        skill_icon(&skill).as_deref(),
        Some("https://example.com/icon.svg")
    );
    skill["interface"]["iconSmallUrl"] = json!("file:///private/icon.svg");
    assert!(skill_icon(&skill).unwrap().starts_with("data:image/"));
}

#[test]
fn embeds_plugin_composer_icons_and_supports_logo_fallback() {
    let package = Package::new();
    let plugin = json!({"source": {"type": "local", "path": package.0},
        "interface": {"composerIcon": "missing.svg", "logo": "skills/demo/assets/icon.svg"}});
    let response = enrich(
        json!({"marketplaces": [{"plugins": [plugin]}], "marketplaceLoadErrors": []}),
        false,
    );
    assert_eq!(
        response["marketplaces"][0]["plugins"][0]["iconUrl"],
        "data:image/svg+xml;base64,PHN2Zy8+"
    );
    assert_eq!(response["marketplaceLoadErrors"], json!([]));
}
