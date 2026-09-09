use super::*;

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("gui-preview-{}", uuid::Uuid::new_v4()));
        for dir in ["workspace", "generated", "outside"] {
            std::fs::create_dir_all(root.join(dir)).unwrap();
        }
        Self(root)
    }

    fn write_image(&self, name: &str) -> PathBuf {
        let path = self.0.join(name);
        std::fs::write(&path, include_bytes!("../../icons/32x32.png")).unwrap();
        path
    }

    fn read(&self, source: &str) -> Result<String> {
        read_image(source, &self.0.join("workspace"), &self.0.join("generated"))
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn previews_workspace_and_generated_images_in_supported_path_forms() {
    let fixture = Fixture::new();
    let image = fixture.write_image("workspace/页面 截图.png");
    let expected = format!(
        "data:image/png;base64,{}",
        STANDARD.encode(include_bytes!("../../icons/32x32.png"))
    );
    assert_eq!(fixture.read("页面 截图.png").unwrap(), expected);
    assert_eq!(fixture.read(image.to_str().unwrap()).unwrap(), expected);
    assert_eq!(
        fixture
            .read(url::Url::from_file_path(&image).unwrap().as_str())
            .unwrap(),
        expected
    );
    let generated = fixture.write_image("generated/bird.png");
    assert_eq!(fixture.read(generated.to_str().unwrap()).unwrap(), expected);
}

#[test]
fn rejects_traversal_other_tasks_network_and_device_paths() {
    let fixture = Fixture::new();
    let outside = fixture.write_image("outside/secret.png");
    for source in [
        outside.to_str().unwrap(),
        "../outside/secret.png",
        "missing.png",
        "file://server/share/image.png",
        r"\\server\share\image.png",
        r"\\?\C:\image.png",
        "https://example.com/image.png",
        "/__codex_switch__/api/invoke",
        "image.png\0",
    ] {
        assert!(
            fixture.read(source).is_err(),
            "unexpectedly accepted {source}"
        );
    }
}

#[test]
fn rejects_non_images_empty_files_directories_and_oversized_files() {
    let fixture = Fixture::new();
    std::fs::write(fixture.0.join("workspace/fake.png"), b"not an image").unwrap();
    std::fs::write(fixture.0.join("workspace/vector.svg"), b"<svg/>").unwrap();
    File::create(fixture.0.join("workspace/empty.png")).unwrap();
    std::fs::create_dir(fixture.0.join("workspace/directory.png")).unwrap();
    File::create(fixture.0.join("workspace/large.png"))
        .unwrap()
        .set_len(MAX_IMAGE_BYTES + 1)
        .unwrap();
    for source in [
        "fake.png",
        "vector.svg",
        "empty.png",
        "directory.png",
        "large.png",
    ] {
        assert!(
            fixture.read(source).is_err(),
            "unexpectedly accepted {source}"
        );
    }
}

#[cfg(unix)]
#[test]
fn rejects_symlinks_outside_the_allowed_directories() {
    let fixture = Fixture::new();
    let outside = fixture.write_image("outside/secret.png");
    std::os::unix::fs::symlink(outside, fixture.0.join("workspace/link.png")).unwrap();
    assert!(fixture.read("link.png").is_err());
}
