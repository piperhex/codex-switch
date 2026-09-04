    #[test]
    fn config_repair_fully_replaces_invalid_config_and_stale_backup() {
        let paths = test_paths();
        write_text_atomic(&paths.current_config, "[broken").unwrap();
        write_text_atomic(&paths.config_backup, "model = \"stale\"\n").unwrap();
        let expected = codex_config::default_official(
            DEFAULT_OFFICIAL_MODEL,
            DEFAULT_OFFICIAL_REASONING_EFFORT,
        );

        replace_codex_config(&paths, &expected, false).unwrap();

        assert_eq!(fs::read_to_string(&paths.current_config).unwrap(), expected);
        assert!(!paths.config_backup.exists());
        fs::remove_dir_all(paths.codex_home.parent().unwrap()).unwrap();
    }

    #[test]
    fn config_repair_prepares_fresh_official_backup_before_proxy_reapply() {
        let paths = test_paths();
        let expected = codex_config::default_official(
            DEFAULT_OFFICIAL_MODEL,
            DEFAULT_OFFICIAL_REASONING_EFFORT,
        );

        replace_codex_config(&paths, &expected, true).unwrap();

        assert_eq!(fs::read_to_string(&paths.current_config).unwrap(), expected);
        assert_eq!(fs::read_to_string(&paths.config_backup).unwrap(), expected);
        fs::remove_dir_all(paths.codex_home.parent().unwrap()).unwrap();
    }
