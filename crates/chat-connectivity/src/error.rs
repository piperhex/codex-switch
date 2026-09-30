/// Native boundary failures never include credentials, addresses or underlying I/O messages.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("invalid connectivity configuration")]
    Invalid,
    #[error("connectivity is unavailable")]
    Unavailable,
    #[error("connectivity queue is full or closed")]
    Closed,
    #[error("connectivity I/O failed")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, Error>;
