    use super::*;

    #[test]
    fn page_requests_are_bounded() {
        assert!(validate_page_request(0, 24).is_ok());
        assert!(validate_page_request(0, 0).is_err());
        assert!(validate_page_request(0, 49).is_err());
        assert!(validate_page_request(500, 24).is_err());
    }

    #[test]
    fn version_ids_and_theme_ids_are_strict() {
        assert!(validate_version_id("ver_1234abcd").is_ok());
        assert!(validate_version_id("../theme").is_err());
        assert!(valid_theme_id("calm.theme-1"));
        assert!(!valid_theme_id("../theme"));
    }
