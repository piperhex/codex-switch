//! Resolve image references from native rich-text copies, without accepting frontend paths.
use std::{cell::RefCell, io::Read, path::PathBuf};

use html5ever::tokenizer::{
    states::RawKind, BufferQueue, StartTag, Token, TokenSink, TokenSinkResult, Tokenizer,
};

use super::clipboard_dingtalk::image_url as dingtalk_image_url;

const MAX_HTML_BYTES: usize = 2 * 1024 * 1024;
const MAX_PATHS: usize = 33; // One beyond the attachment limit so callers can report overflow.

#[derive(Default)]
pub(super) struct ClipboardReferences {
    pub paths: Vec<PathBuf>,
    pub image_urls: Vec<String>,
}

impl ClipboardReferences {
    fn push_source(&mut self, source: &str) {
        if self.paths.len() + self.image_urls.len() >= MAX_PATHS {
            return;
        }
        if let Some(path) = local_image_path(source) {
            if !self.paths.contains(&path) {
                self.paths.push(path);
            }
        } else if let Some(url) = dingtalk_image_url(source) {
            let url = url.to_string();
            if !self.image_urls.contains(&url) {
                self.image_urls.push(url);
            }
        }
    }
}

#[derive(Default)]
struct ImageReferences(RefCell<ClipboardReferences>);

fn local_image_path(source: &str) -> Option<PathBuf> {
    let url = url::Url::parse(source).ok()?;
    if url.scheme() != "file" || url.host_str().is_some() {
        return None;
    }
    let path = url.to_file_path().ok()?;
    (path.is_absolute() && !path.to_string_lossy().starts_with(r"\\")).then_some(path)
}

impl TokenSink for ImageReferences {
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
        let Some(source) = tag
            .attrs
            .iter()
            .find(|attr| attr.name.local.as_ref() == "src")
            .map(|attr| attr.value.as_ref())
        else {
            return TokenSinkResult::Continue;
        };
        self.0.borrow_mut().push_source(source);
        TokenSinkResult::Continue
    }
}

fn image_references(html: &str) -> ClipboardReferences {
    if html.len() > MAX_HTML_BYTES {
        return ClipboardReferences::default();
    }
    let input = BufferQueue::default();
    input.push_back(html.into());
    let tokenizer = Tokenizer::new(ImageReferences::default(), Default::default());
    // The sink only returns Continue/RawData, so feeding cannot suspend on scripts.
    let _result = tokenizer.feed(&input);
    tokenizer.end();
    tokenizer.sink.0.into_inner()
}

/// Read Explorer files first, then QQ-style HTML image references from the same clipboard.
pub(super) fn read_paths() -> Result<Vec<PathBuf>, arboard::Error> {
    Ok(read_references()?.paths)
}

/// Snapshot native references before releasing the clipboard; network reads happen afterwards.
pub(super) fn read_references() -> Result<ClipboardReferences, arboard::Error> {
    let mut clipboard = arboard::Clipboard::new()?;
    match clipboard.get().file_list() {
        Ok(paths) if !paths.is_empty() => {
            return Ok(ClipboardReferences {
                paths,
                image_urls: Vec::new(),
            });
        }
        Err(arboard::Error::ContentNotAvailable) | Ok(_) => {}
        Err(error) => return Err(error),
    }
    // arboard reports a missing Windows HTML format as Unknown, not ContentNotAvailable.
    // Other formats (plain text / screenshots) are handled by the browser paste payload.
    let html = match clipboard.get().html() {
        Ok(html) => html,
        Err(_) => return Ok(ClipboardReferences::default()),
    };
    drop(clipboard);
    let references = image_references(&html);
    for path in &references.paths {
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
    Ok(references)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn image_paths(html: &str) -> Vec<PathBuf> {
        image_references(html).paths
    }

    #[test]
    fn reads_dingtalk_rich_text_images_without_treating_them_as_local_files() {
        let source = "https://static.dingtalk.com/media/example_4032_3024.jpg";
        let html = format!(
            r#"<article class="4ever-article"><img src="{source}" width="4032" height="3024">
            <span data-type="text"><span data-type="leaf">图片说明</span></span></article>
            <img src="{source}">"#
        );
        let references = image_references(&html);
        assert!(references.paths.is_empty());
        assert_eq!(references.image_urls, vec![source]);
    }

    #[test]
    fn limits_network_access_to_dingtalk_media_without_credentials_or_custom_ports() {
        for source in [
            "http://static.dingtalk.com/media/image.jpg",
            "https://static.dingtalk.com.evil.example/media/image.jpg",
            "https://user:password@static.dingtalk.com/media/image.jpg",
            "https://static.dingtalk.com:8443/media/image.jpg",
            "https://static.dingtalk.com/other/image.jpg",
            "https://127.0.0.1/media/image.jpg",
            "https://example.com/image.jpg",
        ] {
            assert!(dingtalk_image_url(source).is_none(), "{source}");
        }
        let script =
            r#"<script>'<img src="https://static.dingtalk.com/media/secret.jpg">'</script>"#;
        assert!(image_references(script).image_urls.is_empty());
    }

    #[test]
    fn bounds_dingtalk_references_and_decodes_html_entities() {
        let html = (0..MAX_PATHS + 10)
            .map(|index| {
                format!("<img src='https://static.dingtalk.com/media/{index}.png?a=1&amp;b=2'>")
            })
            .collect::<String>();
        let references = image_references(&html);
        assert_eq!(references.image_urls.len(), MAX_PATHS);
        assert!(references.image_urls[0].ends_with("?a=1&b=2"));
        assert!(image_references(&"x".repeat(MAX_HTML_BYTES + 1))
            .image_urls
            .is_empty());
    }

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
