//! Only the installer may change the shared shutdown gate; applications only observe it.
use crate::protocol::{Event, GuardOwner};
use std::io;
use windows_sys::Win32::{
    Foundation::{WAIT_ABANDONED, WAIT_OBJECT_0},
    System::Threading::{ReleaseMutex, ResetEvent, SetEvent, WaitForSingleObject},
};

pub struct Lease(GuardOwner);

impl Lease {
    pub fn acquire(executable: &std::path::Path) -> io::Result<Self> {
        let owner = GuardOwner::open(executable)?;
        // SAFETY: the guard thread retains this mutex until its Lease is dropped on that thread.
        let result = unsafe { WaitForSingleObject(owner.0, 1_000) };
        if !matches!(result, WAIT_OBJECT_0 | WAIT_ABANDONED) {
            return Err(io::Error::other(
                "another installer is updating this application",
            ));
        }
        Ok(Self(owner))
    }
}

impl Drop for Lease {
    fn drop(&mut self) {
        // SAFETY: the creating guard thread owns this mutex and releases it exactly once.
        if unsafe { ReleaseMutex(self.0 .0) } == 0 {
            eprintln!("installer lease could not be released");
        }
    }
}

impl Event {
    pub fn set(&self) -> io::Result<()> {
        // SAFETY: the wrapper owns a live event handle.
        if unsafe { SetEvent(self.0) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    pub fn reset(&self) -> io::Result<()> {
        // SAFETY: the wrapper owns a live event handle.
        if unsafe { ResetEvent(self.0) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
}
