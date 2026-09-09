//! Process handles are verified against the exact target path before any action.
use crate::protocol::path_key;
use std::{
    io,
    mem::size_of,
    path::{Path, PathBuf},
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE, WAIT_OBJECT_0},
    System::{
        Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        },
        Threading::{
            GetCurrentProcessId, OpenProcess, QueryFullProcessImageNameW, TerminateProcess,
            WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
            PROCESS_TERMINATE,
        },
    },
    UI::WindowsAndMessaging::{EnumWindows, GetWindowThreadProcessId, PostMessageW, WM_CLOSE},
};

pub struct Process(HANDLE);

impl Drop for Process {
    fn drop(&mut self) {
        // SAFETY: this wrapper closes its uniquely owned process/snapshot handle exactly once.
        if unsafe { CloseHandle(self.0) } == 0 {
            eprintln!("process handle could not be closed");
        }
    }
}

impl Process {
    pub fn open(pid: u32, terminate: bool) -> io::Result<Self> {
        let access = PROCESS_QUERY_LIMITED_INFORMATION
            | PROCESS_SYNCHRONIZE
            | if terminate { PROCESS_TERMINATE } else { 0 };
        // SAFETY: only a kernel process handle is requested; it is not inherited.
        let handle = unsafe { OpenProcess(access, 0, pid) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        Ok(Self(handle))
    }

    fn executable(&self) -> io::Result<PathBuf> {
        let mut buffer = vec![0u16; 32_768];
        let mut length = buffer.len() as u32;
        // SAFETY: the buffer has length writable UTF-16 units and the handle is live.
        if unsafe { QueryFullProcessImageNameW(self.0, 0, buffer.as_mut_ptr(), &mut length) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(PathBuf::from(String::from_utf16_lossy(
            &buffer[..length as usize],
        )))
    }

    pub fn exited(&self) -> bool {
        // SAFETY: a zero-time query of a live owned handle cannot block.
        unsafe { WaitForSingleObject(self.0, 0) == WAIT_OBJECT_0 }
    }

    pub fn terminate(&self) -> io::Result<()> {
        if self.exited() {
            return Ok(());
        }
        // SAFETY: callers only retain handles whose executable matches the validated target.
        // Using that same handle prevents PID reuse from redirecting termination.
        if unsafe { TerminateProcess(self.0, 0) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
}

fn snapshot() -> io::Result<Vec<PROCESSENTRY32W>> {
    // SAFETY: the snapshot contains only process metadata; no target is modified.
    let handle = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if handle == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    let snapshot = Process(handle);
    let mut entry = PROCESSENTRY32W {
        dwSize: size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let mut entries = Vec::new();
    // SAFETY: entry is correctly sized and writable; snapshot owns a valid snapshot handle.
    let mut found = unsafe { Process32FirstW(snapshot.0, &mut entry) } != 0;
    while found {
        entries.push(entry);
        // SAFETY: the same snapshot and sized output remain valid through enumeration.
        found = unsafe { Process32NextW(snapshot.0, &mut entry) } != 0;
    }
    Ok(entries)
}

pub fn parent_pid() -> io::Result<u32> {
    // SAFETY: GetCurrentProcessId has no preconditions.
    let pid = unsafe { GetCurrentProcessId() };
    snapshot()?
        .into_iter()
        .find(|entry| entry.th32ProcessID == pid)
        .map(|entry| entry.th32ParentProcessID)
        .ok_or_else(|| io::Error::other("installer parent process was not found"))
}

pub fn matching(target: &Path) -> io::Result<Vec<(u32, Process)>> {
    let mut matches = Vec::new();
    for entry in snapshot()? {
        let name = String::from_utf16_lossy(&entry.szExeFile)
            .trim_end_matches('\0')
            .to_owned();
        if !name.eq_ignore_ascii_case("csw.exe") {
            continue;
        }
        let Ok(query) = Process::open(entry.th32ProcessID, false) else {
            continue;
        };
        let Ok(path) = query.executable() else {
            continue;
        };
        if path_key(&path) != path_key(target) {
            continue;
        }
        let process = Process::open(entry.th32ProcessID, true)?;
        // Recheck the new handle: the PID may have been reused between OpenProcess calls.
        if path_key(&process.executable()?) == path_key(target) {
            matches.push((entry.th32ProcessID, process));
        }
    }
    Ok(matches)
}

pub fn request_close(pid: u32) {
    // SAFETY: the callback receives only a numeric PID, and enumeration is synchronous.
    unsafe {
        EnumWindows(Some(close_window), pid as isize);
    }
}

unsafe extern "system" fn close_window(window: *mut std::ffi::c_void, pid: isize) -> i32 {
    let mut owner = 0;
    // SAFETY: EnumWindows supplies a live HWND and owner is writable.
    unsafe {
        GetWindowThreadProcessId(window, &mut owner);
    }
    if owner == pid as u32 {
        // SAFETY: WM_CLOSE has no pointer parameters. Old versions may hide to tray;
        // the caller still waits and applies the path-scoped timeout fallback.
        unsafe {
            PostMessageW(window, WM_CLOSE, 0, 0);
        }
    }
    1
}
