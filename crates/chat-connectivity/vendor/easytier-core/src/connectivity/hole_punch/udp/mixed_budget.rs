//! Trade socket diversity for a wider prediction window without growing the NAT table budget.

#[derive(Clone, Copy, Debug, Default)]
pub(super) enum MixedBudget {
    #[default]
    Focused,
    Wider,
    Widest,
}

impl MixedBudget {
    pub fn next(self) -> Self {
        match self {
            Self::Focused => Self::Wider,
            Self::Wider => Self::Widest,
            Self::Widest => Self::Focused,
        }
    }

    pub fn sockets(self) -> usize {
        match self {
            Self::Focused => 16,
            Self::Wider => 8,
            Self::Widest => 4,
        }
    }

    pub fn port_span(self) -> u16 {
        match self {
            Self::Focused => 256,
            Self::Wider => 512,
            Self::Widest => 1024,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn widening_and_rotation_keep_a_fixed_mapping_and_datagram_budget() {
        let mut budget = MixedBudget::default();
        for expected_span in [256, 512, 1024, 256] {
            assert_eq!(budget.port_span(), expected_span);
            let mappings = budget.sockets() * usize::from(budget.port_span());
            assert_eq!(mappings, 4096);
            assert_eq!(mappings * 3, 12_288);
            budget = budget.next();
        }
    }
}
