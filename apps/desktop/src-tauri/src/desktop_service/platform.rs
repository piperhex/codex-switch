use super::{Result, ServiceError};
use std::{
    ffi::c_void,
    mem::{size_of, size_of_val},
    os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    ptr,
};
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
use windows_sys::Win32::{
    Foundation::{LocalFree, HANDLE},
    Security::*,
    System::Threading::*,
};

pub(super) fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}
pub(crate) fn valid_pipe(value: &str) -> bool {
    value
        .strip_prefix(r"\\.\pipe\codex-switch-desktop-")
        .is_some_and(|suffix| uuid::Uuid::parse_str(suffix).is_ok())
}
pub(super) fn token() -> Result<OwnedHandle> {
    let mut token: HANDLE = ptr::null_mut();
    // SAFETY: Windows initializes the output handle; ownership transfers only on success.
    if unsafe {
        OpenProcessToken(
            GetCurrentProcess(),
            TOKEN_QUERY | TOKEN_DUPLICATE | TOKEN_ASSIGN_PRIMARY | TOKEN_ADJUST_PRIVILEGES,
            &mut token,
        )
    } == 0
    {
        return Err(ServiceError::Denied);
    }
    // SAFETY: OpenProcessToken returned a new owned handle.
    Ok(unsafe { OwnedHandle::from_raw_handle(token) })
}
pub(crate) fn is_system() -> Result<bool> {
    let token = token()?;
    let mut buffer = [0usize; 64];
    let mut length = 0;
    // SAFETY: the aligned buffer has room for TOKEN_USER and a maximal SID and lives through the SID check.
    unsafe {
        if GetTokenInformation(
            token.as_raw_handle(),
            TokenUser,
            buffer.as_mut_ptr().cast(),
            size_of_val(&buffer) as u32,
            &mut length,
        ) == 0
        {
            return Err(ServiceError::Denied);
        }
        let user = &*buffer.as_ptr().cast::<TOKEN_USER>();
        Ok(IsWellKnownSid(user.User.Sid, WinLocalSystemSid) != 0)
    }
}
pub(super) fn elevated() -> Result<bool> {
    let token = token()?;
    let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
    let mut length = 0;
    // SAFETY: elevation points to an initialized, correctly sized TOKEN_ELEVATION.
    if unsafe {
        GetTokenInformation(
            token.as_raw_handle(),
            TokenElevation,
            (&mut elevation as *mut TOKEN_ELEVATION).cast(),
            size_of::<TOKEN_ELEVATION>() as u32,
            &mut length,
        )
    } == 0
    {
        return Err(ServiceError::Denied);
    }
    Ok(elevation.TokenIsElevated != 0)
}
pub(super) fn user_sid() -> Result<String> {
    let token = token()?;
    let mut buffer = [0usize; 64];
    let mut length = 0;
    let mut text = ptr::null_mut();
    // SAFETY: the aligned buffer remains valid while its SID is converted; Windows owns the output allocation.
    unsafe {
        if GetTokenInformation(
            token.as_raw_handle(),
            TokenUser,
            buffer.as_mut_ptr().cast(),
            size_of_val(&buffer) as u32,
            &mut length,
        ) == 0
        {
            return Err(ServiceError::Denied);
        }
        let user = &*buffer.as_ptr().cast::<TOKEN_USER>();
        if Authorization::ConvertSidToStringSidW(user.User.Sid, &mut text) == 0 {
            return Err(ServiceError::Denied);
        }
        let mut size = 0;
        while *text.add(size) != 0 && size < 184 {
            size += 1;
        }
        let value = String::from_utf16(std::slice::from_raw_parts(text, size))
            .map_err(|_| ServiceError::Denied);
        LocalFree(text.cast());
        value
    }
}
pub(super) fn console_session() -> Option<u32> {
    // SAFETY: this query has no pointer parameters or side effects.
    let id = unsafe { windows_sys::Win32::System::RemoteDesktop::WTSGetActiveConsoleSessionId() };
    (id != u32::MAX).then_some(id)
}
pub(super) fn system_binary(name: &str) -> Result<std::path::PathBuf> {
    let mut path = [0u16; 32768];
    // SAFETY: Windows receives the actual capacity of this initialized path buffer.
    let length = unsafe {
        windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW(
            path.as_mut_ptr(),
            path.len() as u32,
        )
    } as usize;
    if length == 0 || length >= path.len() {
        return Err(ServiceError::Unavailable);
    }
    Ok(std::path::PathBuf::from(
        String::from_utf16(&path[..length]).map_err(|_| ServiceError::Unavailable)?,
    )
    .join(name))
}

pub(super) fn private_pipe(name: &str) -> Result<NamedPipeServer> {
    if !valid_pipe(name) {
        return Err(ServiceError::Invalid);
    }
    pipe_with_acl(name, "D:P(A;;GA;;;SY)")
}
pub(super) fn pipe_with_acl(name: &str, acl: &str) -> Result<NamedPipeServer> {
    pipe_with_options(
        name,
        acl,
        ServerOptions::new()
            .first_pipe_instance(true)
            .max_instances(1),
    )
}

pub(super) fn pipe_with_options(
    name: &str,
    acl: &str,
    options: &ServerOptions,
) -> Result<NamedPipeServer> {
    let sddl = wide(acl);
    let mut descriptor: PSECURITY_DESCRIPTOR = ptr::null_mut();
    // SAFETY: SDDL is NUL terminated and Windows allocates the descriptor released below.
    if unsafe {
        Authorization::ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            1,
            &mut descriptor,
            ptr::null_mut(),
        )
    } == 0
    {
        return Err(ServiceError::Denied);
    }
    let attributes = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: descriptor,
        bInheritHandle: 0,
    };
    // SAFETY: the descriptor/attributes remain alive for CreateNamedPipe; the kernel copies the descriptor.
    let pipe = unsafe {
        options.create_with_security_attributes_raw(
            name,
            &attributes as *const SECURITY_ATTRIBUTES as *mut c_void,
        )
    };
    // SAFETY: descriptor was allocated by ConvertStringSecurityDescriptorToSecurityDescriptorW.
    unsafe {
        LocalFree(descriptor);
    }
    pipe.map_err(|_| ServiceError::Unavailable)
}
