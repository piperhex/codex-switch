use std::{collections::BTreeMap, fs, io, path::Path, sync::Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::storage::write_json_if_changed;

const CUSTOMIZATIONS_FILENAME: &str = "codex-switch-model-customizations.json";
// Serialize the complete read/merge/write operation, including the customization archive.
static CATALOG_WRITE_LOCK: Mutex<()> = Mutex::new(());

const MANAGED_MODEL_FIELDS: &[&str] = &[
    "slug",
    "display_name",
    "description",
    "priority",
    "visibility",
    "supported_in_api",
    "default_reasoning_level",
    "supported_reasoning_levels",
    "context_window",
    "max_context_window",
    "input_modalities",
    "additional_speed_tiers",
    "service_tiers",
    "default_service_tier",
];

type Customizations = BTreeMap<String, Map<String, Value>>;

#[derive(Debug, thiserror::Error)]
pub(super) enum CatalogError {
    #[error("could not read model catalog data")]
    Read(#[from] io::Error),
    #[error("invalid model catalog data")]
    InvalidJson(#[from] serde_json::Error),
    #[error("model catalog contains an empty or duplicate model slug")]
    InvalidModels,
    #[error("model catalog writer is unavailable")]
    WriterUnavailable,
    #[error("could not save model catalog data: {0}")]
    Write(String),
}

#[derive(Deserialize, Serialize)]
struct ModelCatalog {
    models: Vec<ModelEntry>,
    #[serde(flatten)]
    fields: Map<String, Value>,
}

#[derive(Deserialize, Serialize)]
struct ModelEntry {
    slug: String,
    #[serde(flatten)]
    fields: Map<String, Value>,
}

/// Updates managed fields while retaining custom attributes by exact model slug.
/// Call from a blocking worker: the guard covers all file reads and atomic writes.
pub(super) fn write_catalog(path: &Path, generated: Value) -> Result<(), CatalogError> {
    let _guard = CATALOG_WRITE_LOCK
        .lock()
        .map_err(|_| CatalogError::WriterUnavailable)?;
    let mut catalog: ModelCatalog = serde_json::from_value(generated)?;
    validate_models(&catalog)?;
    let existing = read_optional::<ModelCatalog>(path)?;
    let archive_path = path.with_file_name(CUSTOMIZATIONS_FILENAME);
    let mut customizations = read_optional::<Customizations>(&archive_path)?.unwrap_or_default();
    if let Some(existing) = existing {
        validate_models(&existing)?;
        capture_customizations(&existing, &mut customizations);
        let generated_fields = std::mem::replace(&mut catalog.fields, existing.fields);
        catalog.fields.extend(generated_fields);
    }
    apply_customizations(&mut catalog, &customizations);
    // Archive first: switching to a disjoint model list must not discard the previous edits.
    if !customizations.is_empty() {
        write_json_if_changed(&archive_path, &serde_json::to_value(&customizations)?)
            .map_err(CatalogError::Write)?;
    }
    write_json_if_changed(path, &serde_json::to_value(catalog)?).map_err(CatalogError::Write)?;
    Ok(())
}

fn read_optional<T: serde::de::DeserializeOwned>(path: &Path) -> Result<Option<T>, CatalogError> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn validate_models(catalog: &ModelCatalog) -> Result<(), CatalogError> {
    let mut slugs = std::collections::HashSet::new();
    for entry in &catalog.models {
        if entry.slug.trim().is_empty() || !slugs.insert(&entry.slug) {
            return Err(CatalogError::InvalidModels);
        }
    }
    Ok(())
}

fn capture_customizations(catalog: &ModelCatalog, customizations: &mut Customizations) {
    for entry in &catalog.models {
        let fields = entry
            .fields
            .iter()
            .filter(|(key, _)| !MANAGED_MODEL_FIELDS.contains(&key.as_str()))
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect();
        // Replace rather than extend so deleting a custom field also clears its archived value.
        customizations.insert(entry.slug.clone(), fields);
    }
}

fn apply_customizations(catalog: &mut ModelCatalog, customizations: &Customizations) {
    for entry in &mut catalog.models {
        let Some(fields) = customizations.get(&entry.slug) else {
            continue;
        };
        entry.fields.extend(
            fields
                .iter()
                .filter(|(key, _)| !MANAGED_MODEL_FIELDS.contains(&key.as_str()))
                .map(|(key, value)| (key.clone(), value.clone())),
        );
    }
}
