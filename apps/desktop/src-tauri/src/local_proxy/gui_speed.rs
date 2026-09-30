use super::ProxyServiceTier;

/// GUI speed is independent of the external proxy and applies to subsequent requests.
#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
#[repr(u8)]
pub(crate) enum GuiRequestSpeed {
    #[default]
    Normal,
    Fast,
    Ultrafast,
}

impl GuiRequestSpeed {
    pub(super) fn from_stored(value: u8) -> Self {
        match value {
            value if value == Self::Fast as u8 => Self::Fast,
            value if value == Self::Ultrafast as u8 => Self::Ultrafast,
            _ => Self::Normal,
        }
    }

    pub(super) fn service_tier(self) -> ProxyServiceTier {
        match self {
            Self::Normal => ProxyServiceTier::Default,
            Self::Fast => ProxyServiceTier::Priority,
            Self::Ultrafast => ProxyServiceTier::Ultrafast,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_wire_values_and_maps_each_speed_to_its_own_tier() {
        for (name, tier) in [
            ("normal", "default"),
            ("fast", "priority"),
            ("ultrafast", "ultrafast"),
        ] {
            let speed: GuiRequestSpeed = serde_json::from_value(serde_json::json!(name)).unwrap();
            assert_eq!(GuiRequestSpeed::from_stored(speed as u8), speed);
            assert_eq!(speed.service_tier().as_str(), tier);
            assert_eq!(serde_json::to_value(speed).unwrap(), name);
        }
        assert!(serde_json::from_value::<GuiRequestSpeed>(serde_json::json!("unknown")).is_err());
    }
}
