fn main() {
    tauri_build::build();

    #[cfg(windows)]
    link_windows_resources_to_tests();
}

#[cfg(windows)]
fn link_windows_resources_to_tests() {
    let output_dir = std::env::var_os("OUT_DIR").expect("Cargo must provide OUT_DIR");
    let resource_path = std::path::PathBuf::from(output_dir).join("resource.lib");
    println!("cargo:rustc-link-arg-tests={}", resource_path.display());
}
