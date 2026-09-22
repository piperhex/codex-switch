const MAX_OBJECT_READS = 20;
const MAX_PROPERTIES = 10;
const MAX_INDEXED_ARRAY_LENGTH = 1000;

// Retained console events may omit previews. Inspect data descriptors, never call page getters.
// These values reflect the object at read time, just like expanding a retained DevTools entry.
export function createObjectReader(send) {
  const reads = new Map();
  return value => {
    if (value.preview || !value.objectId || value.type !== 'object') return value;
    if (value.subtype && value.subtype !== 'array') return value;
    if (reads.has(value.objectId)) return reads.get(value.objectId);
    if (reads.size >= MAX_OBJECT_READS) return { ...value, previewUnavailable: true };
    const read = propertiesPreview(value, send);
    reads.set(value.objectId, read);
    return read;
  };
}

async function propertiesPreview(value, send) {
  const arrayLength = /^Array\((\d+)\)$/.exec(value.description ?? '')?.[1];
  const skipIndices = Number(arrayLength) > MAX_INDEXED_ARRAY_LENGTH;
  let response;
  try {
    response = await send('Runtime.getProperties', { objectId: value.objectId, ownProperties: true,
      generatePreview: true, ...(skipIndices ? { nonIndexedPropertiesOnly: true } : {}) });
  } catch {
    // A retained object's handle can expire. The caller must still recheck scope and access after flushing.
    return { ...value, previewUnavailable: true };
  }
  if (response.exceptionDetails || !response.result) return { ...value, previewUnavailable: true };
  const descriptors = response.result.filter(property => property.enumerable || property.name === 'length');
  const properties = descriptors.slice(0, MAX_PROPERTIES).map(propertyPreview);
  return { ...value, previewReadAt: true, preview: { type: value.type, subtype: value.subtype,
    description: value.description, properties, overflow: skipIndices || descriptors.length > MAX_PROPERTIES } };
}

function propertyPreview(property) {
  if (!property.value) return { name: property.name, type: 'accessor' };
  const value = property.value;
  return { name: property.name, type: value.type, valuePreview: value.preview,
    value: Object.hasOwn(value, 'value') ? String(value.value)
      : value.unserializableValue ?? value.description ?? value.type };
}
