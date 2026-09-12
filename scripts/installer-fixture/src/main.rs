#![cfg_attr(windows, windows_subsystem = "windows")]

#[cfg(all(target_env = "msvc", not(target_feature = "crt-static")))]
compile_error!("Installer fixture requires static CRT; use scripts/check-installer-fixture.mjs.");

use std::{env, process::ExitCode, thread};

fn main() -> ExitCode {
    let mut arguments = env::args().skip(1);
    let valid_mode = matches!(
        arguments.next().as_deref(),
        None | Some("--chrome-plugin-native-host")
    );
    if !valid_mode || arguments.next().is_some() {
        eprintln!("Usage: csw-installer-fixture [--chrome-plugin-native-host]");
        return ExitCode::FAILURE;
    }

    // No window or shutdown handler: the installer must close a legacy background process itself.
    loop {
        thread::park();
    }
}
