//! Resolve image references from native rich-text copies, without accepting frontend paths.
use std::{cell::RefCell, io::Read, path::PathBuf};

use html5ever::tokenizer::{
    states::RawKind, BufferQueue, StartTag, Token, TokenSink, TokenSinkResult, Tokenizer,
};

const MAX_HTML_BYTES: usize = 2 * 1024 * 1024;
const MAX_PATHS: usize = 33; // One beyond the attachment limit so callers can report overflow.

#[derive(Default)]
struct ImagePaths(RefCell<Vec<PathBuf>>);

fn local_image_path(source: &str) -> Option<PathBuf> {
    let url = url::Url::parse(source).ok()?;
    if url.scheme() != "file" || url.host_str().is_some() {
        return None;
    }
    let path = url.to_file_path().ok()?;
    (path.is_absolute() && !path.to_string_lossy().starts_with(r"\\")).then_some(path)
}

impl TokenSink for ImagePaths {
    type Handle = ();

    fn process_token(&self, token: Token, _: u64) -> TokenSinkResult<()> {
        let Token::TagToken(tag) = token else {
            return TokenSinkResult::Continue;
        };
        if tag.kind != StartTag {
            return TokenSinkResult::Continue;
        }
        match tag.name.as_ref() {
            "script" => return TokenSinkResult::RawData(RawKind::ScriptData),
            "style" | "xmp" | "iframe" | "noembed" | "noframes" => {
                return TokenSinkResult::RawData(RawKind::Rawtext);
            }
            "title" | "textarea" => return TokenSinkResult::RawData(RawKind::Rcdata),
            "img" => {}
            _ => return TokenSinkResult::Continue,
        }
        let mut paths = self.0.borrow_mut();
        if let Some(path) = tag
            .attrs
            .iter()
            .find(|attr| attr.name.local.as_ref() == "src")
            .and_then(|attr| local_image_path(&attr.value))
        {
            if paths.len() < MAX_PATHS && !paths.contains(&path) {
                paths.push(path);
            }
        }
        TokenSinkResult::Continue
    }
}

fn image_paths(html: &str) -> Vec<PathBuf> {
    if html.len() > MAX_HTML_BYTES {
        return Vec::new();
    }
    let input = BufferQueue::default();
    input.push_back(html.into());
    let tokenizer = Tokenizer::new(ImagePaths::default(), Default::default());
    // The sink only returns Continue/RawData, so feeding cannot suspend on scripts.
    let _result = tokenizer.feed(&input);
    tokenizer.end();
    tokenizer.sink.0.into_inner()
}

/// Read Explorer files first, then QQ-style HTML image references from the same clipboard.
pub(super) fn read_paths() -> Result<Vec<PathBuf>, arboard::Error> {
    let mut clipboard = arboard::Clipboard::new()?;
    match clipboard.get().file_list() {
        Ok(paths) if !paths.is_empty() => return Ok(paths),
        Err(arboard::Error::ContentNotAvailable) | Ok(_) => {}
        Err(error) => return Err(error),
    }
    // arboard reports a missing Windows HTML format as Unknown, not ContentNotAvailable.
    // Other formats (plain text / screenshots) are handled by the browser paste payload.
    let html = match clipboard.get().html() {
        Ok(html) => html,
        Err(_) => return Ok(Vec::new()),
    };
    drop(clipboard);
    let paths = image_paths(&html);
    for path in &paths {
        // HTML may only grant image access; an <img> tag must not turn arbitrary files into attachments.
        let mut header = [0; 16];
        let length = std::fs::File::open(path)
            .and_then(|mut file| file.read(&mut header))
            .map_err(|_| arboard::Error::ConversionFailure)?;
        if !matches!(
            image::guess_format(&header[..length]),
            Ok(image::ImageFormat::Png
                | image::ImageFormat::Jpeg
                | image::ImageFormat::WebP
                | image::ImageFormat::Gif
                | image::ImageFormat::Bmp)
        ) {
            return Err(arboard::Error::ConversionFailure);
        }
    }
    Ok(paths)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_qq_images_and_decodes_entities_without_duplicates() {
        let path = std::env::temp_dir().join("QQ 图片 & photo.png");
        let source = url::Url::from_file_path(&path).unwrap().to_string();
        let html = format!("文字<br><IMG SRC='{source}'><img src=\"{source}\">");
        assert_eq!(image_paths(&html), vec![path]);
        let path = std::env::temp_dir().join("a&b.png");
        let source = url::Url::from_file_path(&path)
            .unwrap()
            .to_string()
            .replace('&', "&amp;");
        assert_eq!(image_paths(&format!("<img src='{source}'>")), vec![path]);
    }

    #[test]
    fn ignores_non_images_remote_paths_and_script_contents() {
        let html = "<script>const s = '<img src=\"file:///tmp/secret.png\">';</script>\
            <a href='file:///tmp/secret.png'>link</a><img src='https://example.com/a.png'>\
            <img src='file://server/share/a.png'><img src='relative.png'>";
        assert!(image_paths(html).is_empty());
        assert!(image_paths(&"x".repeat(MAX_HTML_BYTES + 1)).is_empty());
    }

    #[test]
    #[cfg(windows)]
    fn accepts_qq_windows_paths_with_backslashes() {
        let html = r#"文字<br><img src="file:///C:\Users\User\Tencent Files\Ori\photo.png">"#;
        assert_eq!(
            image_paths(html),
            vec![PathBuf::from(r"C:\Users\User\Tencent Files\Ori\photo.png")]
        );
    }
}
