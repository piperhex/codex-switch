use super::{FileError, Result};
use std::{
    fs::{self, File, OpenOptions},
    path::Path,
};

pub(super) fn copy(source: &Path, destination: &Path) -> Result<()> {
    let parent = destination.parent().ok_or(FileError::Save)?;
    let temporary = parent.join(format!(".codex-switch-save-{}", uuid::Uuid::new_v4()));
    // Stage the copy before replacing the destination so failed writes and hard links cannot truncate the source.
    let result = (|| {
        let mut input = File::open(source)?;
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        std::io::copy(&mut input, &mut output)?;
        output.sync_all()?;
        drop(output);
        fs::rename(&temporary, destination)
    })();
    if result.is_err() && temporary.exists() && fs::remove_file(&temporary).is_err() {
        eprintln!("Could not remove an unfinished file copy");
    }
    result.map_err(|_| FileError::Save)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replacing_a_copy_or_hard_link_preserves_the_source() {
        let root = std::env::temp_dir().join(format!("gui-save-copy-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let source = root.join("source.txt");
        let destination = root.join("copy.txt");
        fs::write(&source, "文件内容").unwrap();
        fs::hard_link(&source, &destination).unwrap();
        copy(&source, &destination).unwrap();
        assert_eq!(fs::read_to_string(&source).unwrap(), "文件内容");
        assert_eq!(fs::read_to_string(&destination).unwrap(), "文件内容");
        fs::write(&source, "new contents").unwrap();
        assert_eq!(fs::read_to_string(&destination).unwrap(), "文件内容");
        copy(&source, &destination).unwrap();
        assert_eq!(fs::read_to_string(&destination).unwrap(), "new contents");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
        fs::remove_dir_all(root).unwrap();
    }
}
