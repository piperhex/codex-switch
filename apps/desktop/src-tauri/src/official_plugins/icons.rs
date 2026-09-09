use base64::{engine::general_purpose::STANDARD, Engine};
use std::{fs::File, io::Read, path::Path};

const MAX_ICON_BYTES: u64 = 512 * 1024;

/// Only load bounded image assets inside the plugin package reported by the CLI.
pub(crate) fn local_icon(source: Option<&str>, icon: Option<&str>) -> Option<String> {
    let root = Path::new(source?).canonicalize().ok()?;
    let path = root.join(icon?).canonicalize().ok()?;
    if !path.starts_with(&root) {
        return None;
    }
    let mime = match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => return None,
    };
    let file = File::open(path).ok()?;
    if file.metadata().ok()?.len() > MAX_ICON_BYTES {
        return None;
    }
    let mut bytes = Vec::new();
    file.take(MAX_ICON_BYTES + 1).read_to_end(&mut bytes).ok()?;
    if bytes.len() as u64 > MAX_ICON_BYTES {
        return None;
    }
    Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_assets_outside_the_plugin_and_oversized_files() {
        let root = std::env::temp_dir().join(format!("plugin-icons-{}", uuid::Uuid::new_v4()));
        let plugin = root.join("plugin");
        std::fs::create_dir_all(&plugin).unwrap();
        let icon = plugin.join("icon.svg");
        std::fs::write(&icon, "<svg/>").unwrap();
        assert_eq!(
            local_icon(plugin.to_str(), icon.to_str()),
            Some(format!(
                "data:image/svg+xml;base64,{}",
                STANDARD.encode("<svg/>")
            ))
        );
        let outside = root.join("outside.svg");
        std::fs::write(&outside, "outside").unwrap();
        assert!(local_icon(plugin.to_str(), outside.to_str()).is_none());
        File::create(&icon)
            .unwrap()
            .set_len(MAX_ICON_BYTES + 1)
            .unwrap();
        assert!(local_icon(plugin.to_str(), icon.to_str()).is_none());
        std::fs::remove_dir_all(root).unwrap();
    }
}
