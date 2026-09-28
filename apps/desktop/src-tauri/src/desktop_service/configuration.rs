use super::{Result, ServiceError};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, ptr};
use windows::Win32::{
    System::Com::CoTaskMemFree,
    UI::Shell::{
        FOLDERID_ProgramData, FOLDERID_ProgramFiles, SHGetKnownFolderPath, KF_FLAG_DEFAULT,
    },
};
use windows_sys::Win32::{Foundation::LocalFree, Security::Cryptography::*};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Configuration {
    pub base_url: String,
    pub credential: String,
    pub device_id: String,
    pub name: String,
    pub version: String,
    pub identity_secret: String,
    pub owner_sid: String,
    pub permissions: crate::remote_desktop::permissions::Permissions,
}
fn folder(id: &windows::core::GUID) -> Result<PathBuf> {
    // SAFETY: the OS allocates a NUL-terminated path and we release it with the documented allocator.
    unsafe {
        let value =
            SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None).map_err(|_| ServiceError::Storage)?;
        let result = value
            .to_string()
            .map(PathBuf::from)
            .map_err(|_| ServiceError::Storage);
        CoTaskMemFree(Some(value.0.cast()));
        result
    }
}
pub(crate) fn install_root() -> Result<PathBuf> {
    Ok(folder(&FOLDERID_ProgramFiles)?.join("Codex Switch Remote Desktop"))
}
pub(super) fn data_root() -> Result<PathBuf> {
    Ok(folder(&FOLDERID_ProgramData)?.join("CodexSwitchRemoteDesktop"))
}
impl Configuration {
    pub(super) fn validate(&self) -> Result<()> {
        let url = url::Url::parse(&self.base_url).map_err(|_| ServiceError::Invalid)?;
        if url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || url.host_str().is_none()
            || url.query().is_some()
            || url.fragment().is_some()
            || self.base_url.len() > 2048
            || self.name.len() > 200
            || self.version.len() > 50
            || !self.credential.starts_with("csw-desktop-service-")
            || self.credential.len() != 84
            || !self.credential[20..]
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
            || uuid::Uuid::parse_str(&self.device_id).is_err()
        {
            return Err(ServiceError::Invalid);
        }
        if STANDARD
            .decode(&self.identity_secret)
            .map_err(|_| ServiceError::Invalid)?
            .len()
            != 32
        {
            return Err(ServiceError::Invalid);
        }
        if !self.owner_sid.starts_with("S-1-")
            || self.owner_sid.len() > 184
            || !self.owner_sid[4..]
                .bytes()
                .all(|byte| byte.is_ascii_digit() || byte == b'-')
        {
            return Err(ServiceError::Invalid);
        }
        Ok(())
    }
}
pub(crate) fn read() -> Result<Configuration> {
    let bytes =
        std::fs::read(data_root()?.join("configuration.bin")).map_err(|_| ServiceError::Storage)?;
    unseal(&bytes)
}
pub(super) fn write(config: &Configuration) -> Result<()> {
    use std::io::Write;
    let root = data_root()?;
    let temporary = root.join(format!(".configuration-{}.tmp", uuid::Uuid::new_v4()));
    let bytes = seal(config)?;
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|_| ServiceError::Storage)?;
        file.write_all(&bytes).map_err(|_| ServiceError::Storage)?;
        file.sync_all().map_err(|_| ServiceError::Storage)?;
        drop(file);
        crate::storage::replace_file(&temporary, &root.join("configuration.bin"))
            .map_err(|_| ServiceError::Storage)
    })();
    if result.is_err() && temporary.exists() && std::fs::remove_file(temporary).is_err() {
        eprintln!("desktop configuration temporary cleanup failed");
    }
    result
}
pub(super) fn seal(config: &Configuration) -> Result<Vec<u8>> {
    config.validate()?;
    let mut bytes = serde_json::to_vec(config).map_err(|_| ServiceError::Invalid)?;
    let result = protect(&mut bytes, true);
    bytes.fill(0);
    result
}
pub(super) fn unseal(bytes: &[u8]) -> Result<Configuration> {
    if bytes.len() > 64 * 1024 {
        return Err(ServiceError::Invalid);
    }
    let mut input = bytes.to_vec();
    let mut plain = protect(&mut input, false)?;
    let decoded = serde_json::from_slice::<Configuration>(&plain);
    plain.fill(0);
    let config = decoded.map_err(|_| ServiceError::Invalid)?;
    config.validate()?;
    Ok(config)
}
fn protect(bytes: &mut [u8], encrypt: bool) -> Result<Vec<u8>> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_mut_ptr(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };
    // SAFETY: input is a live bounded slice; DPAPI allocates output, which is copied and freed exactly once.
    unsafe {
        let success = if encrypt {
            CryptProtectData(
                &input,
                ptr::null(),
                ptr::null(),
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_LOCAL_MACHINE | CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                ptr::null_mut(),
                ptr::null(),
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if success == 0 {
            return Err(ServiceError::Storage);
        }
        let result = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        std::ptr::write_bytes(output.pbData, 0, output.cbData as usize);
        LocalFree(output.pbData.cast());
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Configuration {
        Configuration {
            base_url: "https://example.test".into(),
            credential: format!("csw-desktop-service-{}", "a".repeat(64)),
            device_id: uuid::Uuid::new_v4().to_string(),
            name: "Fixture".into(),
            version: "test".into(),
            identity_secret: STANDARD.encode([3u8; 32]),
            owner_sid: "S-1-5-21-1234-1234-1234-1001".into(),
            permissions: Default::default(),
        }
    }
    #[test]
    fn configuration_roundtrips_without_plaintext_and_rejects_tampering() {
        let config = fixture();
        let mut bytes = seal(&config).unwrap();
        assert!(!bytes
            .windows(config.credential.len())
            .any(|value| value == config.credential.as_bytes()));
        assert_eq!(unseal(&bytes).unwrap().credential, config.credential);
        let middle = bytes.len() / 2;
        bytes[middle] ^= 1;
        assert!(unseal(&bytes).is_err());
    }
    #[test]
    fn configuration_rejects_unsafe_binding_and_account_tokens() {
        for address in [
            "http://example.test",
            "https://user:password@example.test",
            "https://example.test?q=x",
        ] {
            let mut config = fixture();
            config.base_url = address.into();
            assert!(config.validate().is_err());
        }
        let mut config = fixture();
        config.credential = "account-jwt".into();
        assert!(config.validate().is_err());
        let mut config = fixture();
        config.owner_sid = "S-1-1)(A;;GA;;;WD)".into();
        assert!(config.validate().is_err());
    }
}
