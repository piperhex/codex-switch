use serde::Serialize;

/// Display identifiers are Windows device names, never caller-provided native handles.
#[derive(Clone, Serialize)]
pub(crate) struct DisplayInfo {
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub primary: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Opened {
    pub id: String,
    pub displays: Vec<DisplayInfo>,
    pub display_id: String,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Bounds {
    pub fn point(self, x: f64, y: f64) -> (i32, i32) {
        (
            self.x + (x * f64::from(self.width.saturating_sub(1))).round() as i32,
            self.y + (y * f64::from(self.height.saturating_sub(1))).round() as i32,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::Bounds;

    #[test]
    fn maps_corners_and_center_on_negative_and_portrait_displays() {
        let left = Bounds {
            x: -1920,
            y: -200,
            width: 1920,
            height: 1080,
        };
        assert_eq!(left.point(0.0, 0.0), (-1920, -200));
        assert_eq!(left.point(1.0, 1.0), (-1, 879));
        assert_eq!(left.point(0.5, 0.5), (-960, 340));
        let portrait = Bounds {
            x: 2560,
            y: -1080,
            width: 1080,
            height: 1920,
        };
        assert_eq!(portrait.point(1.0, 1.0), (3639, 839));
    }
}
