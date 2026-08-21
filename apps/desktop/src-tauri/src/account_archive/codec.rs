fn encode_archive(payload: &AccountArchivePayload) -> Result<Vec<u8>, String> {
    let json = serde_json::to_vec(payload).map_err(|error| error.to_string())?;
    let compressed = gzip(&json)?;
    let encrypted = encrypt_payload(&compressed)?;

    let cursor = Cursor::new(Vec::new());
    let mut zip = ZipWriter::new(cursor);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    zip.start_file(ARCHIVE_PAYLOAD_FILE, options)
        .map_err(|error| format!("Failed to create archive payload: {error}"))?;
    zip.write_all(&encrypted)
        .map_err(|error| format!("Failed to write archive payload: {error}"))?;
    let cursor = zip
        .finish()
        .map_err(|error| format!("Failed to finalize archive: {error}"))?;
    Ok(cursor.into_inner())
}

fn decode_archive(path: &Path) -> Result<AccountArchivePayload, String> {
    let file =
        File::open(path).map_err(|error| format!("Failed to open {}: {error}", path.display()))?;
    let mut zip = ZipArchive::new(file)
        .map_err(|error| format!("The selected file is not a valid .cs archive: {error}"))?;
    let mut encrypted = Vec::new();
    zip.by_name(ARCHIVE_PAYLOAD_FILE)
        .map_err(|_| "The selected archive is missing its encrypted account payload".to_string())?
        .read_to_end(&mut encrypted)
        .map_err(|error| format!("Failed to read archive payload: {error}"))?;
    let compressed = decrypt_payload(&encrypted)?;
    let json = gunzip(&compressed)?;
    let payload: AccountArchivePayload = serde_json::from_slice(&json)
        .map_err(|error| format!("Account archive payload is invalid: {error}"))?;
    Ok(payload)
}

fn gzip(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(bytes)
        .map_err(|error| format!("Failed to compress account archive: {error}"))?;
    encoder
        .finish()
        .map_err(|error| format!("Failed to finish account archive compression: {error}"))
}

fn gunzip(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoder = GzDecoder::new(bytes);
    let mut decoded = Vec::new();
    decoder
        .read_to_end(&mut decoded)
        .map_err(|error| format!("Failed to decompress account archive: {error}"))?;
    Ok(decoded)
}

fn encrypt_payload(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(&ARCHIVE_KEY)
        .map_err(|error| format!("Failed to initialize account archive encryption: {error}"))?;
    let nonce_bytes: [u8; NONCE_LENGTH] = rand::random();
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(
            nonce,
            Payload {
                msg: bytes,
                aad: ARCHIVE_MAGIC,
            },
        )
        .map_err(|_| "Failed to encrypt account archive payload".to_string())?;
    let mut output = Vec::with_capacity(ARCHIVE_MAGIC.len() + NONCE_LENGTH + ciphertext.len());
    output.extend_from_slice(ARCHIVE_MAGIC);
    output.extend_from_slice(&nonce_bytes);
    output.extend_from_slice(&ciphertext);
    Ok(output)
}

fn decrypt_payload(bytes: &[u8]) -> Result<Vec<u8>, String> {
    if bytes.len() <= ARCHIVE_MAGIC.len() + NONCE_LENGTH {
        return Err("The encrypted account archive payload is incomplete".to_string());
    }
    if &bytes[..ARCHIVE_MAGIC.len()] != ARCHIVE_MAGIC {
        return Err("The selected file is not a Codex Switch account archive".to_string());
    }
    let nonce_start = ARCHIVE_MAGIC.len();
    let nonce_end = nonce_start + NONCE_LENGTH;
    let nonce = Nonce::from_slice(&bytes[nonce_start..nonce_end]);
    let ciphertext = &bytes[nonce_end..];
    let cipher = Aes256Gcm::new_from_slice(&ARCHIVE_KEY)
        .map_err(|error| format!("Failed to initialize account archive encryption: {error}"))?;
    cipher
        .decrypt(
            nonce,
            Payload {
                msg: ciphertext,
                aad: ARCHIVE_MAGIC,
            },
        )
        .map_err(|_| "Failed to decrypt account archive payload".to_string())
}
