use std::path::PathBuf;

use windows::{
    core::PWSTR,
    Win32::{
        Foundation::{CloseHandle, FILETIME, HANDLE},
        System::Threading::{
            GetProcessTimes, OpenProcess, QueryFullProcessImageNameW, TerminateProcess,
            PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
        },
    },
};

use super::{same_process_instance, ObservedProcess};

const MAX_WINDOWS_PATH_UNITS: usize = 32_768;
const FILETIME_UNITS_PER_SECOND: u64 = 10_000_000;
const WINDOWS_TO_UNIX_EPOCH_SECONDS: u64 = 11_644_473_600;
const TERMINATION_EXIT_CODE: u32 = 1;

struct ProcessHandle(HANDLE);

impl Drop for ProcessHandle {
    fn drop(&mut self) {
        // SAFETY: this guard owns the successful OpenProcess handle exclusively.
        // Closing cannot be retried after ownership ends; the OS handles cleanup.
        let _ = unsafe { CloseHandle(self.0) };
    }
}

impl ProcessHandle {
    fn open(pid: u32) -> Option<Self> {
        // SAFETY: the PID is an observed integer and no handle is inherited.
        let handle = unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE,
                false,
                pid,
            )
        }
        .ok()?;
        Some(Self(handle))
    }

    fn executable(&self) -> Option<PathBuf> {
        let mut buffer = vec![0u16; MAX_WINDOWS_PATH_UNITS];
        let mut length = buffer.len() as u32;
        // SAFETY: buffer is writable for length UTF-16 units and the handle is live.
        unsafe {
            QueryFullProcessImageNameW(
                self.0,
                PROCESS_NAME_WIN32,
                PWSTR(buffer.as_mut_ptr()),
                &mut length,
            )
        }
        .ok()?;
        Some(PathBuf::from(
            String::from_utf16(&buffer[..length as usize]).ok()?,
        ))
    }

    fn started_at(&self) -> Option<u64> {
        let (mut creation, mut exit, mut kernel, mut user) = (
            FILETIME::default(),
            FILETIME::default(),
            FILETIME::default(),
            FILETIME::default(),
        );
        // SAFETY: all four output pointers are distinct live FILETIME values.
        unsafe { GetProcessTimes(self.0, &mut creation, &mut exit, &mut kernel, &mut user) }
            .ok()?;
        let timestamp = ((creation.dwHighDateTime as u64) << 32) | creation.dwLowDateTime as u64;
        (timestamp / FILETIME_UNITS_PER_SECOND).checked_sub(WINDOWS_TO_UNIX_EPOCH_SECONDS)
    }
}

/// The same handle is used to verify identity and terminate, avoiding PID reuse races.
pub(super) fn terminate_observed_process(expected: &ObservedProcess) -> bool {
    let Some(handle) = ProcessHandle::open(expected.pid) else {
        return false;
    };
    let (Some(executable), Some(started_at)) = (handle.executable(), handle.started_at()) else {
        return false;
    };
    let current = ObservedProcess {
        pid: expected.pid,
        started_at,
        executable,
    };
    if !same_process_instance(expected, &current) {
        return false;
    }
    // SAFETY: this owned handle still refers to the process whose path and creation
    // time were verified above, even if its numeric PID is subsequently reused.
    unsafe { TerminateProcess(handle.0, TERMINATION_EXIT_CODE) }.is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_start_time_matches_native_query_for_current_process() {
        let pid = std::process::id();
        let system = super::super::process_snapshot();
        let observed = system
            .process(sysinfo::Pid::from_u32(pid))
            .expect("the test process should be present in its own snapshot");
        assert!(observed.start_time() > 0);
        // SAFETY: the test requests only query access to its own live process.
        // It never obtains termination rights or calls a termination function.
        let handle = ProcessHandle(unsafe {
            OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
                .expect("the test process should allow read-only process queries")
        });
        assert_eq!(handle.started_at(), Some(observed.start_time()));
    }
}
