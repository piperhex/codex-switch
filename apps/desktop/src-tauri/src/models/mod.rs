include!("accounts.rs");
include!("auto_reset.rs");
include!("providers.rs");
include!("settings.rs");
include!("cloud_sync.rs");

#[cfg(test)]
mod tests {
    include!("tests.rs");
}
