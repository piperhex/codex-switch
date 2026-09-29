//! Single byte ranges used by browser media playback and PDF seeking.
#[derive(Debug, PartialEq)]
pub(super) struct ByteRange {
    pub start: u64,
    pub length: u64,
}

pub(super) fn parse(value: &str, size: u64) -> Option<ByteRange> {
    let (start, end) = value.strip_prefix("bytes=")?.split_once('-')?;
    if size == 0 {
        return None;
    }
    if start.is_empty() {
        let length = end.parse::<u64>().ok()?.min(size);
        return (length > 0).then_some(ByteRange {
            start: size - length,
            length,
        });
    }
    let start = start.parse::<u64>().ok()?;
    let end = if end.is_empty() {
        size - 1
    } else {
        end.parse::<u64>().ok()?.min(size - 1)
    };
    if start >= size || end < start {
        return None;
    }
    Some(ByteRange {
        start,
        length: end - start + 1,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn supports_seek_open_ended_and_suffix_ranges() {
        assert_eq!(
            parse("bytes=4-7", 10),
            Some(ByteRange {
                start: 4,
                length: 4
            })
        );
        assert_eq!(
            parse("bytes=4-", 10),
            Some(ByteRange {
                start: 4,
                length: 6
            })
        );
        assert_eq!(
            parse("bytes=-4", 10),
            Some(ByteRange {
                start: 6,
                length: 4
            })
        );
        assert_eq!(
            parse("bytes=0-999", 10),
            Some(ByteRange {
                start: 0,
                length: 10
            })
        );
        for value in [
            "bytes=10-",
            "bytes=7-4",
            "bytes=-0",
            "bytes=0-1,3-4",
            "items=0-1",
        ] {
            assert_eq!(parse(value, 10), None);
        }
        assert_eq!(parse("bytes=0-", 0), None);
    }
}
