use super::*;

#[test]
fn browses_only_the_project_and_filters_photos_without_hiding_folders() {
    let root = std::env::temp_dir().join(format!("csw-project-files-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&root).unwrap();
    let root = root.canonicalize().unwrap();
    fs::create_dir(root.join("subfolder")).unwrap();
    fs::write(root.join("note.txt"), "hello").unwrap();
    fs::write(root.join("photo.PNG"), "image").unwrap();
    let files = browse(&root, "", false).unwrap();
    assert_eq!(files["entries"].as_array().unwrap().len(), 3);
    assert_eq!(files["entries"][0]["name"], "subfolder");
    assert_eq!(files["parent"], serde_json::Value::Null);
    let photos = browse(&root, "", true).unwrap();
    assert_eq!(photos["entries"].as_array().unwrap().len(), 2);
    assert_eq!(photos["entries"][1]["name"], "photo.PNG");
    let child = browse(&root, &execution_path(&root.join("subfolder")), false).unwrap();
    assert_eq!(child["parent"], execution_path(&root));
    assert!(browse(&root, &execution_path(root.parent().unwrap()), false).is_err());
    assert!(root.starts_with(std::env::temp_dir().canonicalize().unwrap()));
    fs::remove_dir_all(root).unwrap();
}
