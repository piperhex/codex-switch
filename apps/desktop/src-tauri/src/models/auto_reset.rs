/// Local opt-in policy for restoring exhausted official accounts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct AutoResetSettings {
    pub(crate) enabled: bool,
    /// None follows the eligible pool; Some(empty) authorizes no accounts.
    pub(crate) account_ids: Option<Vec<String>>,
    pub(crate) max_cards: u16,
    pub(crate) reserve_cards: u16,
}

impl Default for AutoResetSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            account_ids: None,
            max_cards: 1,
            reserve_cards: 0,
        }
    }
}

impl AutoResetSettings {
    pub(crate) const MAX_CARDS: u16 = 100;

    pub(crate) fn validate(&self) -> Result<(), String> {
        if !(1..=Self::MAX_CARDS).contains(&self.max_cards) || self.reserve_cards > Self::MAX_CARDS
        {
            return Err("重置卡数量设置无效".to_string());
        }
        Ok(())
    }

    pub(crate) fn allows(&self, id: &str) -> bool {
        self.account_ids
            .as_ref()
            .is_none_or(|ids| ids.iter().any(|selected| selected == id))
    }

    pub(crate) fn budget(&self, concurrent: bool) -> usize {
        if concurrent {
            usize::from(self.max_cards)
        } else {
            1
        }
    }
}
