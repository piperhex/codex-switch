//! Named events are shared only by processes from the same executable path.
use std::{io, path::Path, ptr};

use sha2::{Digest, Sha256};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE, WAIT_ABANDONED, WAIT_OBJECT_0, WAIT_TIMEOUT},
    System::Threading::{CreateEventW, CreateMutexW, ReleaseMutex, WaitForSingleObject},
};

pub struct Event(pub(super) HANDLE);

/// A mutex owner is abandoned by Windows even if the installer guard crashes.
pub struct GuardOwner(pub(super) HANDLE);

impl GuardOwner {
    pub fn open(executable: &Path) -> io::Result<Self> {
        let name: Vec<u16> = event_name(executable, "owner")
            .encode_utf16()
            .chain([0])
            .collect();
        // SAFETY: a live null-terminated name is supplied; this creates an unowned mutex.
        let handle = unsafe { CreateMutexW(ptr::null(), 0, name.as_ptr()) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        Ok(Self(handle))
    }

    fn is_held(&self) -> io::Result<bool> {
        // SAFETY: this bounded query acquires the mutex only when the guard is absent/dead.
        match unsafe { WaitForSingleObject(self.0, 0) } {
            WAIT_TIMEOUT => Ok(true),
            WAIT_OBJECT_0 | WAIT_ABANDONED => {
                // SAFETY: this thread has just acquired the mutex and immediately releases it.
                if unsafe { ReleaseMutex(self.0) } == 0 {
                    return Err(io::Error::last_os_error());
                }
                Ok(false)
            }
            _ => Err(io::Error::last_os_error()),
        }
    }
}

impl Drop for GuardOwner {
    fn drop(&mut self) {
        // SAFETY: this wrapper uniquely owns the handle; the installer releases ownership first.
        if unsafe { CloseHandle(self.0) } == 0 {
            eprintln!("installer owner handle could not be closed");
        }
    }
}

pub fn installation_active(executable: &Path) -> io::Result<bool> {
    Ok(Event::open(executable, "active")?.wait(0)? && GuardOwner::open(executable)?.is_held()?)
}

// SAFETY: event handles are kernel objects usable from any thread; this wrapper owns the handle.
unsafe impl Send for Event {}

impl Event {
    pub fn open(executable: &Path, purpose: &str) -> io::Result<Self> {
        let name: Vec<u16> = event_name(executable, purpose)
            .encode_utf16()
            .chain([0])
            .collect();
        // SAFETY: the null-terminated name is live for the call; default security permits the
        // owning user and SYSTEM. Global events allow an elevated MSI worker to signal user apps.
        let handle = unsafe { CreateEventW(ptr::null(), 1, 0, name.as_ptr()) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        Ok(Self(handle))
    }

    pub fn wait(&self, milliseconds: u32) -> io::Result<bool> {
        // SAFETY: the handle remains owned for the entire bounded wait.
        match unsafe { WaitForSingleObject(self.0, milliseconds) } {
            WAIT_OBJECT_0 => Ok(true),
            WAIT_TIMEOUT => Ok(false),
            _ => Err(io::Error::last_os_error()),
        }
    }
}

impl Drop for Event {
    fn drop(&mut self) {
        // SAFETY: close the uniquely owned handle once; retrying a failed close is not safe.
        if unsafe { CloseHandle(self.0) } == 0 {
            eprintln!("installer event handle could not be closed");
        }
    }
}

pub fn path_key(path: &Path) -> String {
    let value = path.to_string_lossy().replace('/', "\\");
    if let Some(value) = value.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{value}").to_lowercase();
    }
    value.strip_prefix(r"\\?\").unwrap_or(&value).to_lowercase()
}

fn event_name(executable: &Path, purpose: &str) -> String {
    let digest = Sha256::digest(path_key(executable).as_bytes());
    format!(r"Global\CodexSwitch.Install.{digest:x}.{purpose}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_match_windows_path_variants_but_isolate_installations() {
        assert_eq!(
            event_name(Path::new(r"C:\Apps\csw.exe"), "active"),
            event_name(Path::new(r"\\?\c:\apps\csw.exe"), "active")
        );
        assert_ne!(
            event_name(Path::new(r"C:\Apps\csw.exe"), "active"),
            event_name(Path::new(r"D:\Apps\csw.exe"), "active")
        );
    }
}
