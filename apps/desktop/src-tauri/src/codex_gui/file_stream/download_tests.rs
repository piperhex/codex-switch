use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::fs;

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("csw-download-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("project")).unwrap();
        Self(root)
    }
    fn root(&self) -> PathBuf {
        self.0.join("project")
    }
    fn open(&self, streams: &FileStreams, name: &str) -> Result<StreamInfo> {
        streams.insert(
            self.root(),
            StreamOpen {
                thread_id: "chat".into(),
                path: name.into(),
                max_bytes: u64::MAX,
            },
        )
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        assert!(self.0.starts_with(std::env::temp_dir()));
        fs::remove_dir_all(&self.0).unwrap();
    }
}
fn read(info: &StreamInfo, offset: u64) -> StreamRead {
    StreamRead {
        thread_id: "chat".into(),
        id: info.id.clone(),
        offset,
        length: CHUNK_BYTES,
        max_bytes: u64::MAX,
    }
}

#[test]
fn downloads_all_binary_types_and_empty_files_with_original_names() {
    let fixture = Fixture::new();
    let streams = FileStreams::downloads();
    let bytes: Vec<u8> = (0..CHUNK_BYTES * 2 + 17).map(|i| (i % 256) as u8).collect();
    for name in [
        "安装包.apk",
        "setup.exe",
        "archive.zip",
        "photo.png",
        "video.mp4",
        "no-extension",
        "empty",
    ] {
        let expected = if name == "empty" { &[][..] } else { &bytes[..] };
        fs::write(fixture.root().join(name), expected).unwrap();
        let info = fixture.open(&streams, name).unwrap();
        assert_eq!(info.name, name);
        assert_eq!(info.size, expected.len() as u64);
        if name.ends_with(".apk") {
            assert_eq!(info.mime_type, "application/vnd.android.package-archive");
        }
        let mut downloaded = Vec::new();
        while (downloaded.len() as u64) < info.size {
            let chunk = streams
                .read_chunk(read(&info, downloaded.len() as u64))
                .unwrap();
            downloaded.extend(STANDARD.decode(chunk.data).unwrap());
        }
        assert_eq!(downloaded, expected);
    }
}

#[test]
fn keeps_download_handles_separate_and_rechecks_limits_and_ownership() {
    let fixture = Fixture::new();
    let streams = FileStreams::downloads();
    fs::write(fixture.root().join("app.exe"), [0, 255, 0, 1]).unwrap();
    let info = fixture.open(&streams, "app.exe").unwrap();
    assert!(FileStreams::default().read_chunk(read(&info, 0)).is_err());
    let mut request = read(&info, 0);
    request.max_bytes = 3;
    assert!(matches!(
        streams.read_chunk(request),
        Err(GuiError::FileTooLarge)
    ));
    let mut request = read(&info, 0);
    request.thread_id = "other".into();
    assert!(streams.read_chunk(request).is_err());
    assert!(streams
        .remove(StreamClose {
            thread_id: "other".into(),
            id: info.id.clone()
        })
        .is_err());
    fs::write(fixture.root().join("app.exe"), [0, 255]).unwrap();
    assert!(matches!(
        streams.read_chunk(read(&info, 0)),
        Err(GuiError::FileChanged)
    ));
    streams
        .remove(StreamClose {
            thread_id: "chat".into(),
            id: info.id.clone(),
        })
        .unwrap();
    assert!(streams.read_chunk(read(&info, 0)).is_err());
}

#[test]
fn rejects_downloads_outside_the_conversation_workspace() {
    let fixture = Fixture::new();
    let streams = FileStreams::downloads();
    fs::write(fixture.0.join("private.exe"), [1]).unwrap();
    fs::write(fixture.root().join("app.exe"), [1]).unwrap();
    for path in [
        "../private.exe",
        ".",
        "missing",
        "//server/share",
        "app.exe:secret",
        "file://app.exe",
    ] {
        assert!(fixture.open(&streams, path).is_err(), "{path}");
    }
    assert!(fixture
        .open(&streams, fixture.0.join("private.exe").to_str().unwrap())
        .is_err());
}

#[test]
fn reopening_a_changed_file_returns_a_new_revision_even_when_size_is_unchanged() {
    let fixture = Fixture::new();
    let streams = FileStreams::downloads();
    let path = fixture.root().join("resume.bin");
    fs::write(&path, [1, 2, 3]).unwrap();
    let before = fixture.open(&streams, "resume.bin").unwrap();
    fs::write(&path, [4, 5, 6]).unwrap();
    fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(
            fs::FileTimes::new()
                .set_modified(std::time::SystemTime::now() + Duration::from_secs(2)),
        )
        .unwrap();
    let after = fixture.open(&streams, "resume.bin").unwrap();
    assert_eq!(before.size, after.size);
    assert_ne!(before.revision, after.revision);
    assert_eq!(
        STANDARD
            .decode(streams.read_chunk(read(&after, 1)).unwrap().data)
            .unwrap(),
        [5, 6]
    );
}

#[test]
fn rejects_symbolic_links_outside_the_workspace() {
    let fixture = Fixture::new();
    fs::write(fixture.0.join("private"), [1]).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(fixture.0.join("private"), fixture.root().join("link")).unwrap();
    #[cfg(windows)]
    {
        let result = std::os::windows::fs::symlink_file(
            fixture.0.join("private"),
            fixture.root().join("link"),
        );
        if result
            .as_ref()
            .is_err_and(|error| error.raw_os_error() == Some(1314))
        {
            return;
        }
        result.unwrap();
    }
    assert!(fixture.open(&FileStreams::downloads(), "link").is_err());
}
