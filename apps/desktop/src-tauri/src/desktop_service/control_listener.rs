//! Keep one owner-control listener alive while the preceding client consumes its response.
use super::{platform, Result, ServiceError};
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};

pub(super) struct Listener {
    name: String,
    acl: String,
    server: NamedPipeServer,
}

impl Listener {
    pub(super) fn new(name: &str, acl: &str) -> Result<Self> {
        let server =
            platform::pipe_with_options(name, acl, ServerOptions::new().first_pipe_instance(true))?;
        Ok(Self {
            name: name.into(),
            acl: acl.into(),
            server,
        })
    }

    pub(super) async fn accept(&mut self) -> Result<NamedPipeServer> {
        loop {
            let connected = self.server.connect().await;
            // Acquire the successor before releasing this handle: the pipe name and its ACL
            // stay owned continuously. Only the first creation asserts FIRST_PIPE_INSTANCE.
            let successor =
                platform::pipe_with_options(&self.name, &self.acl, &ServerOptions::new())?;
            let previous = std::mem::replace(&mut self.server, successor);
            match connected {
                Ok(()) => return Ok(previous),
                Err(error)
                    if error.raw_os_error()
                        == Some(windows_sys::Win32::Foundation::ERROR_NO_DATA as i32) => {}
                Err(_) => return Err(ServiceError::Unavailable),
            }
        }
    }
}
