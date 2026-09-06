//! Flush each SSE read to HTTP/1.1 clients instead of buffering tiny_http's 8 KiB chunks.

use std::io::{self, Read, Write};
use tiny_http::{Method, Request, Response};

const STREAM_COPY_BUFFER_BYTES: usize = 8192;
const INTERRUPTED_STREAM_EVENT: &[u8] = concat!(
    "\n\nevent: error\ndata: {\"type\":\"error\",\"error\":{\"type\":\"api_error\",",
    "\"message\":\"The connection was interrupted. Please try again.\"}}\n\n"
)
.as_bytes();

pub(super) fn respond<R: Read>(request: Request, response: Response<R>) -> io::Result<()> {
    if *request.method() == Method::Head
        || matches!(response.status_code().0, 100..=199 | 204 | 304)
    {
        // tiny_http may otherwise collect an unknown-length body before suppressing it (e.g. 204).
        return request.respond(response.with_data(io::empty(), None));
    }
    let Some(headers) = chunked_headers(&request, &response)? else {
        return request.respond(response);
    };
    // Keep tiny_http's writer ownership: dropping it releases the next pipelined response.
    let mut writer = request.into_writer();
    writer.write_all(&headers)?;
    writer.flush()?;
    write_chunks(&mut response.into_reader(), &mut writer)
}

fn chunked_headers<R: Read>(
    request: &Request,
    response: &Response<R>,
) -> io::Result<Option<Vec<u8>>> {
    if *request.http_version() <= (1, 0) {
        return Ok(None);
    }
    // Reuse tiny_http's status/header validation, Date/Server defaults, and TE negotiation.
    let header_response = Response::new(
        response.status_code(),
        response.headers().to_vec(),
        io::empty(),
        response.data_length(),
        None,
    );
    let mut headers = Vec::new();
    header_response.raw_print(
        &mut headers,
        request.http_version().clone(),
        request.headers(),
        true,
        None,
    )?;
    let chunked = headers
        .split(|byte| *byte == b'\n')
        .any(|line| line.eq_ignore_ascii_case(b"Transfer-Encoding: chunked\r"));
    // TE: identity must retain the ordinary Content-Length path rather than send mismatched framing.
    Ok(chunked.then_some(headers))
}

fn write_chunks(reader: &mut impl Read, writer: &mut impl Write) -> io::Result<()> {
    let mut buffer = [0_u8; STREAM_COPY_BUFFER_BYTES];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => return finish_chunks(writer),
            Ok(count) => write_chunk(writer, &buffer[..count])?,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => {
                // A read failure must remain visible while preserving framing for the next response.
                write_chunk(writer, INTERRUPTED_STREAM_EVENT)?;
                finish_chunks(writer)?;
                return Err(error);
            }
        }
    }
}

fn write_chunk(writer: &mut impl Write, bytes: &[u8]) -> io::Result<()> {
    write!(writer, "{:x}\r\n", bytes.len())?;
    writer.write_all(bytes)?;
    writer.write_all(b"\r\n")?;
    writer.flush()
}

fn finish_chunks(writer: &mut impl Write) -> io::Result<()> {
    writer.write_all(b"0\r\n\r\n")?;
    writer.flush()
}
