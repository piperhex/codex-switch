impl ProxyHistoryStore {
    fn save_attachment(&self, id: &str, source: &str) -> ProxyHistoryResult<()> {
        if source.len() > MAX_CONVERSATION_ATTACHMENT_BYTES {
            return Ok(());
        }
        if !valid_history_attachment_id(id) || !safe_conversation_image_source(source) {
            return Err(ProxyHistoryError::Attachment);
        }
        let connection = self
            .connection
            .lock()
            .map_err(|_| ProxyHistoryError::Lock)?;
        if let Some(data) = source.strip_prefix("data:") {
            let (mime, encoded) = data
                .split_once(";base64,")
                .ok_or(ProxyHistoryError::Attachment)?;
            self.save_image_file(id, mime, encoded)?;
            connection.execute(
                "INSERT OR REPLACE INTO attachments VALUES(?1, ?2, NULL)",
                params![id, mime],
            )?;
        } else {
            // Preserve external references without making proxy requests to arbitrary URLs.
            connection.execute(
                "INSERT OR REPLACE INTO attachments VALUES(?1, NULL, ?2)",
                params![id, source],
            )?;
        }
        Ok(())
    }

    fn attachment(&self, id: &str) -> ProxyHistoryResult<Option<String>> {
        use base64::Engine;
        if !valid_history_attachment_id(id) {
            return Err(ProxyHistoryError::Attachment);
        }
        let entry: Option<(Option<String>, Option<String>)> = {
            let connection = self
                .connection
                .lock()
                .map_err(|_| ProxyHistoryError::Lock)?;
            connection
                .query_row(
                    "SELECT media_type, remote_url FROM attachments WHERE id=?1",
                    [id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?
        };
        let Some((mime, remote_url)) = entry else {
            return Ok(None);
        };
        if let Some(url) = remote_url {
            return Ok(safe_conversation_image_source(&url).then_some(url));
        }
        let mime = mime.ok_or(ProxyHistoryError::Attachment)?;
        let path = self.image_path(id, &mime)?;
        let file = match fs::File::open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        let mut bytes = Vec::new();
        file.take(MAX_CONVERSATION_ATTACHMENT_BYTES as u64 + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() > MAX_CONVERSATION_ATTACHMENT_BYTES {
            return Err(ProxyHistoryError::Attachment);
        }
        Ok(Some(format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        )))
    }

    fn save_image_file(&self, id: &str, mime: &str, encoded: &str) -> ProxyHistoryResult<()> {
        use base64::Engine;
        let path = self.image_path(id, mime)?;
        if path.is_file() {
            return Ok(());
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|_| ProxyHistoryError::Attachment)?;
        let temporary = self
            .attachments
            .join(format!("{id}-{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| -> io::Result<()> {
            let mut file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temporary)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            drop(file);
            fs::rename(&temporary, path)
        })();
        if let Err(error) = result {
            if let Err(cleanup) = fs::remove_file(&temporary) {
                if cleanup.kind() != io::ErrorKind::NotFound {
                    eprintln!("history attachment cleanup: {cleanup}");
                }
            }
            return Err(error.into());
        }
        Ok(())
    }

    fn image_path(&self, id: &str, mime: &str) -> ProxyHistoryResult<PathBuf> {
        if !valid_history_attachment_id(id) {
            return Err(ProxyHistoryError::Attachment);
        }
        let extension = match mime {
            "image/png" => "png",
            "image/jpeg" | "image/jpg" => "jpg",
            "image/webp" => "webp",
            "image/gif" => "gif",
            _ => return Err(ProxyHistoryError::Attachment),
        };
        Ok(self.attachments.join(format!("{id}.{extension}")))
    }

    fn remove_unreferenced_attachments(&self) -> ProxyHistoryResult<()> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| ProxyHistoryError::Lock)?;
        let mut statement = connection.prepare(
            "SELECT id, media_type FROM attachments WHERE NOT EXISTS
             (SELECT 1 FROM request_attachments WHERE attachment_id=attachments.id)",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })?;
        for row in rows {
            let (id, mime) = row?;
            if let Some(mime) = mime {
                match fs::remove_file(self.image_path(&id, &mime)?) {
                    Ok(()) => {}
                    Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                    Err(error) => return Err(error.into()),
                }
            }
        }
        drop(statement);
        connection.execute(
            "DELETE FROM attachments WHERE NOT EXISTS
            (SELECT 1 FROM request_attachments WHERE attachment_id=attachments.id)",
            [],
        )?;
        Ok(())
    }
}

fn valid_history_attachment_id(id: &str) -> bool {
    id.len() == 64 && id.bytes().all(|byte| byte.is_ascii_hexdigit())
}
