fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().windows_attributes(
            tauri_build::WindowsAttributes::new_without_app_manifest(),
        ),
    )
    .expect("failed to run tauri build");

    #[cfg(windows)]
    embed_common_controls_v6_manifest();
}

// Tauri embeds Common-Controls v6 for app binaries only; lib test harnesses need it too.
// https://github.com/tauri-apps/tauri/issues/13419
#[cfg(windows)]
fn embed_common_controls_v6_manifest() {
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").ok();
    if target_env.as_deref() != Some("msvc") {
        return;
    }

    let manifest = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect(
        "CARGO_MANIFEST_DIR should be set when build.rs runs",
    ))
    .join("windows-app-manifest.xml");

    println!("cargo:rerun-if-changed={}", manifest.display());
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!(
        "cargo:rustc-link-arg=/MANIFESTINPUT:{}",
        manifest.to_str().expect("manifest path must be UTF-8")
    );
}
