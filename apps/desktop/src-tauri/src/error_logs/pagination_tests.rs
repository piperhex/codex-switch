use super::{
    database,
    models::*,
    tests::{entry, Fixture},
};

fn numbered(page: u32, snapshot_id: Option<i64>) -> ListQuery {
    ListQuery::new(Some(2), None, Some(ErrorLogSource::Proxy))
        .unwrap()
        .with_pagination(Some(ErrorLogPagination { page, snapshot_id }))
        .unwrap()
}

#[test]
fn numbered_pages_count_filtered_records_and_stay_anchored_during_new_writes() {
    let fixture = Fixture::new();
    let mut connection = database::open(&fixture.database_path()).unwrap();
    for message in ["first", "second", "third", "fourth", "fifth"] {
        database::insert(&mut connection, entry(ErrorLogSource::Proxy, message)).unwrap();
    }
    database::insert(
        &mut connection,
        entry(ErrorLogSource::Toast, "notification"),
    )
    .unwrap();
    let first = database::list(&connection, numbered(1, None)).unwrap();
    assert_eq!(first.total, 5);
    assert_eq!(first.page, 1);
    assert_eq!(first.snapshot_id, Some(first.entries[0].id));
    database::insert(&mut connection, entry(ErrorLogSource::Proxy, "newest")).unwrap();
    let second = database::list(&connection, numbered(2, first.snapshot_id)).unwrap();
    assert_eq!(second.total, 5);
    assert_eq!(second.page, 2);
    assert_eq!(
        second
            .entries
            .iter()
            .map(|entry| entry.message.as_str())
            .collect::<Vec<_>>(),
        ["third", "second"]
    );
    let last = database::list(&connection, numbered(3, first.snapshot_id)).unwrap();
    assert_eq!(last.entries[0].message, "first");
    assert!(!last.has_more);
    assert_eq!(
        database::list(&connection, numbered(1, None))
            .unwrap()
            .total,
        6
    );
}

#[test]
fn removed_pages_clamp_to_the_last_available_page_and_clear_returns_page_one() {
    let fixture = Fixture::new();
    let mut connection = database::open(&fixture.database_path()).unwrap();
    for message in ["first", "second", "third"] {
        database::insert(&mut connection, entry(ErrorLogSource::Proxy, message)).unwrap();
    }
    let page = database::list(&connection, numbered(3, None)).unwrap();
    assert_eq!(page.page, 2);
    assert_eq!(page.entries[0].message, "first");
    database::clear(&connection).unwrap();
    let empty = database::list(&connection, numbered(2, page.snapshot_id)).unwrap();
    assert_eq!(empty.page, 1);
    assert_eq!(empty.total, 0);
    assert!(empty.entries.is_empty());
}

#[test]
fn numbered_queries_reject_invalid_pages_snapshots_and_mixed_cursors() {
    for (page, snapshot_id) in [(0, None), (MAX_ENTRIES as u32 + 1, None), (1, Some(0))] {
        assert!(ListQuery::new(Some(10), None, None)
            .unwrap()
            .with_pagination(Some(ErrorLogPagination { page, snapshot_id }))
            .is_err());
    }
    assert!(ListQuery::new(Some(10), Some(10), None)
        .unwrap()
        .with_pagination(Some(ErrorLogPagination {
            page: 2,
            snapshot_id: None
        }))
        .is_err());
}
