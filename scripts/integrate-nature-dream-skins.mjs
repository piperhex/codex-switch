import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktop = path.join(root, "apps", "desktop");
const presetsRoot = path.join(
  desktop,
  "src-tauri",
  "resources",
  "dream-skin",
  "presets",
);
const manifestNames = [
  ".batch-mountain.json",
  ".batch-water.json",
  ".batch-forest.json",
  ".batch-extremes.json",
];
const requiredManifestKeys = [
  "id",
  "nameEn",
  "nameZh",
  "descriptionEn",
  "descriptionZh",
  "category",
  "tone",
  "appearance",
  "safeArea",
  "focusX",
  "focusY",
  "accent",
  "promptSummary",
  "finalPrompt",
];

const themes = manifestNames.flatMap((filename) => {
  const manifestPath = path.join(presetsRoot, filename);
  const entries = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(entries) || entries.length !== 25) {
    throw new Error(`${filename} must contain exactly 25 entries`);
  }
  return entries;
});

if (themes.length !== 100) {
  throw new Error(`Expected 100 nature themes, got ${themes.length}`);
}

const ids = new Set();
const localizationKeys = new Set();
for (const theme of themes) {
  for (const key of requiredManifestKeys) {
    if (!(key in theme)) {
      throw new Error(`${theme.id ?? "unknown theme"} is missing ${key}`);
    }
  }
  if (!/^preset-nature-[a-z0-9-]+$/.test(theme.id)) {
    throw new Error(`Invalid nature theme ID: ${theme.id}`);
  }
  if (ids.has(theme.id)) {
    throw new Error(`Duplicate nature theme ID: ${theme.id}`);
  }
  ids.add(theme.id);
  if (!["light", "dark"].includes(theme.appearance)) {
    throw new Error(`Invalid appearance for ${theme.id}: ${theme.appearance}`);
  }
  if (theme.safeArea !== "left") {
    throw new Error(`Nature theme must use a left safe area: ${theme.id}`);
  }
  if (
    typeof theme.focusX !== "number" ||
    typeof theme.focusY !== "number" ||
    theme.focusX < 0 ||
    theme.focusX > 1 ||
    theme.focusY < 0 ||
    theme.focusY > 1
  ) {
    throw new Error(`Invalid focus point for ${theme.id}`);
  }
  if (!/^#[0-9a-f]{6}$/i.test(theme.accent)) {
    throw new Error(`Invalid accent for ${theme.id}: ${theme.accent}`);
  }

  const themeDir = path.join(presetsRoot, theme.id);
  const themePath = path.join(themeDir, "theme.json");
  const imagePath = path.join(themeDir, "background.jpg");
  if (!fs.existsSync(themePath) || !fs.existsSync(imagePath)) {
    throw new Error(`Incomplete theme package: ${theme.id}`);
  }
  const document = JSON.parse(fs.readFileSync(themePath, "utf8"));
  if (
    document.schemaVersion !== 1 ||
    document.id !== theme.id ||
    document.image !== "background.jpg" ||
    document.appearance !== theme.appearance ||
    document.art?.safeArea !== theme.safeArea ||
    document.art?.focusX !== theme.focusX ||
    document.art?.focusY !== theme.focusY ||
    document.palette?.accent?.toLowerCase() !== theme.accent.toLowerCase()
  ) {
    throw new Error(`Manifest/theme.json mismatch: ${theme.id}`);
  }

  const key = theme.id
    .replace(/^preset-/, "")
    .replace(/-([a-z0-9])/g, (_, letter) => letter.toUpperCase());
  if (localizationKeys.has(key)) {
    throw new Error(`Duplicate localization key: ${key}`);
  }
  localizationKeys.add(key);
  theme.localizationKey = key;
}

function mutateLatest(filePath, update, attempts = 8) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const before = fs.readFileSync(filePath, "utf8");
    const after = update(before);
    if (after === before) {
      return false;
    }
    const latest = fs.readFileSync(filePath, "utf8");
    if (latest !== before) {
      continue;
    }
    fs.writeFileSync(filePath, after, "utf8");
    return true;
  }
  throw new Error(`Concurrent edits did not settle for ${filePath}`);
}

const builtInsPath = path.join(desktop, "src", "dreamSkinBuiltIns.ts");
mutateLatest(builtInsPath, (source) => {
  const marker = "] as const satisfies readonly BuiltInDreamSkinTheme[];";
  const insertAt = source.indexOf(marker);
  if (insertAt < 0) {
    throw new Error("Cannot find TypeScript built-in theme insertion point");
  }
  const entries = themes
    .filter((theme) => !source.includes(`id: "${theme.id}"`))
    .map(
      (theme) => `  {
    id: "${theme.id}",
    englishName: ${JSON.stringify(theme.nameEn)},
    nameKey: "dreamSkin.theme.${theme.localizationKey}.name",
    descriptionKey: "dreamSkin.theme.${theme.localizationKey}.description",
    tone: "${theme.tone}",
    appearance: "${theme.appearance}",
  },
`,
    )
    .join("");
  return `${source.slice(0, insertAt)}${entries}${source.slice(insertAt)}`;
});

const rustPath = path.join(desktop, "src-tauri", "src", "dream_skin_native", "types.rs");
mutateLatest(rustPath, (source) => {
  const arrayPattern =
    /(?:pub\(crate\) )?const BUILT_IN_THEME_IDS: \[&str; \d+\] = \[(?<body>[\s\S]*?)\n\];/;
  const match = source.match(arrayPattern);
  if (!match?.groups) {
    throw new Error("Cannot find Rust built-in theme array");
  }
  const currentIds = [...match.groups.body.matchAll(/"([^"]+)"/g)].map(
    (idMatch) => idMatch[1],
  );
  for (const theme of themes) {
    if (!currentIds.includes(theme.id)) {
      currentIds.push(theme.id);
    }
  }
  if (new Set(currentIds).size !== currentIds.length) {
    throw new Error("Rust built-in theme array contains duplicate IDs");
  }
  const replacement = `const BUILT_IN_THEME_IDS: [&str; ${currentIds.length}] = [
${currentIds.map((id) => `    "${id}",`).join("\n")}
];`;
  return source.replace(arrayPattern, replacement);
});

const i18nPath = path.join(desktop, "src", "i18n.ts");
mutateLatest(i18nPath, (source) => {
  let cleaned = source;
  const misplacedZhMarker = "\n  zh: {";
  const misplacedZhStart = cleaned.indexOf(misplacedZhMarker);
  if (misplacedZhStart < 0) {
    throw new Error("Cannot find Chinese locale boundary");
  }
  const misplacedEnglishCloseMatches = [
    ...cleaned.slice(0, misplacedZhStart).matchAll(/\r?\n  },/g),
  ];
  const misplacedEnglishClose = misplacedEnglishCloseMatches.at(-1);
  const misplacedEnglishCloseAt = misplacedEnglishClose?.index ?? -1;
  if (misplacedEnglishCloseAt < 0) {
    throw new Error("Cannot find English locale boundary");
  }
  const misplacedEnglishCloseEnd =
    misplacedEnglishCloseAt + misplacedEnglishClose[0].length;
  const misplacedGap = cleaned.slice(
    misplacedEnglishCloseEnd,
    misplacedZhStart,
  );
  const misplacedPropertyPattern =
    /[ \t]*"dreamSkin\.theme\.[^"]+\.(?:name|description)": [^\r\n]+,\r?\n?/g;
  const misplacedProperties = [
    ...misplacedGap.matchAll(misplacedPropertyPattern),
  ].map((match) => match[0].trim());
  const misplacedRemainder = misplacedGap
    .replace(misplacedPropertyPattern, "")
    .trim();
  if (misplacedRemainder) {
    throw new Error(
      "Unexpected non-theme content exists between the English and Chinese locales",
    );
  }
  if (misplacedProperties.length > 0) {
    const englishBody = cleaned.slice(0, misplacedEnglishCloseAt);
    const uniqueProperties = misplacedProperties.filter((property) => {
      const key = property.match(/^"([^"]+)"/)?.[1];
      return key && !englishBody.includes(`"${key}"`);
    });
    const propertyBlock = uniqueProperties
      .map((property) => `    ${property}`)
      .join("\n");
    cleaned =
      `${englishBody}\n${propertyBlock}` +
      `${cleaned.slice(misplacedEnglishCloseAt, misplacedEnglishCloseEnd)}` +
      `${cleaned.slice(misplacedZhStart)}`;
  }

  for (const theme of themes) {
    for (const suffix of ["name", "description"]) {
      const property = `dreamSkin.theme.${theme.localizationKey}.${suffix}`;
      const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      cleaned = cleaned.replace(
        new RegExp(`[ \\t]*"${escaped}": [^\\r\\n]+,`, "g"),
        "",
      );
    }
  }

  const zhMarker = "\n  zh: {";
  let zhStart = cleaned.indexOf(zhMarker);
  if (zhStart < 0) {
    throw new Error("Cannot find Chinese locale boundary");
  }
  let englishCloseMatches = [
    ...cleaned.slice(0, zhStart).matchAll(/\r?\n  },/g),
  ];
  let englishClose = englishCloseMatches.at(-1);
  let englishCloseAt = englishClose?.index ?? -1;
  if (englishCloseAt < 0) {
    throw new Error("Cannot find English locale insertion point");
  }
  const englishBody = cleaned
    .slice(0, englishCloseAt)
    .replace(/[ \t\r\n]+$/, "");
  cleaned = `${englishBody}\n  },\n  zh: {${cleaned.slice(zhStart + zhMarker.length)}`;
  zhStart = cleaned.indexOf(zhMarker);

  const englishEntries = themes
    .map(
      (theme) =>
        `    "dreamSkin.theme.${theme.localizationKey}.name": ${JSON.stringify(theme.nameEn)},\n` +
        `    "dreamSkin.theme.${theme.localizationKey}.description": ${JSON.stringify(theme.descriptionEn)},\n`,
    )
    .join("");
  englishCloseMatches = [
    ...cleaned.slice(0, zhStart).matchAll(/\r?\n  },/g),
  ];
  englishClose = englishCloseMatches.at(-1);
  englishCloseAt = englishClose?.index ?? -1;
  if (englishCloseAt < 0) {
    throw new Error("Cannot find English locale insertion point");
  }
  const englishInsertAt =
    englishCloseAt + (cleaned.startsWith("\r\n", englishCloseAt) ? 2 : 1);
  let updated = `${cleaned.slice(0, englishInsertAt)}${englishEntries}${cleaned.slice(englishInsertAt)}`;

  let localeCloseMatches = [
    ...updated.matchAll(/\r?\n  },\r?\n} as const;/g),
  ];
  let finalLocaleClose = localeCloseMatches.at(-1);
  let zhEnd = finalLocaleClose?.index ?? -1;
  if (zhEnd < 0) {
    throw new Error("Cannot find Chinese locale insertion point");
  }
  updated = `${updated.slice(0, zhEnd).replace(/[ \t\r\n]+$/, "")}${updated.slice(zhEnd)}`;
  localeCloseMatches = [
    ...updated.matchAll(/\r?\n  },\r?\n} as const;/g),
  ];
  finalLocaleClose = localeCloseMatches.at(-1);
  zhEnd = finalLocaleClose?.index ?? -1;
  const chineseEntries = themes
    .map(
      (theme) =>
        `    "dreamSkin.theme.${theme.localizationKey}.name": ${JSON.stringify(theme.nameZh)},\n` +
        `    "dreamSkin.theme.${theme.localizationKey}.description": ${JSON.stringify(theme.descriptionZh)},\n`,
    )
    .join("");
  const chineseInsertAt =
    zhEnd + (updated.startsWith("\r\n", zhEnd) ? 2 : 1);
  updated = `${updated.slice(0, chineseInsertAt)}${chineseEntries}${updated.slice(chineseInsertAt)}`;
  return updated;
});

const sourcesPath = path.join(presetsRoot, "SOURCES.json");
mutateLatest(sourcesPath, (source) => {
  const document = JSON.parse(source);
  document.updatedAt = "2026-07-29";
  document.naturePromptPolicy = {
    scope: "Entries whose category starts with nature-.",
    style:
      "Premium photorealistic cinematic landscape photography with believable geology, weather, water, flora, and atmospheric depth.",
    composition:
      "Wide 16:9 desktop theme with the left 40% kept calm and low-detail for UI, while the natural focal subject stays on the right third.",
    avoid:
      "No people, third-party characters, readable text, logo, watermark, border, UI mockup, recognizable private property, or implausible fantasy object.",
  };
  for (const theme of themes) {
    const existing = document.themes.find((entry) => entry.id === theme.id);
    const provenance = {
      id: theme.id,
      category: theme.category,
      rightsStatus: "projectOriginal",
      nameEn: theme.nameEn,
      nameZh: theme.nameZh,
      promptSummary: theme.promptSummary,
    };
    if (existing) {
      const comparable = {
        id: existing.id,
        category: existing.category,
        rightsStatus: existing.rightsStatus,
        nameEn: existing.nameEn,
        nameZh: existing.nameZh,
        promptSummary: existing.promptSummary,
      };
      if (JSON.stringify(comparable) !== JSON.stringify(provenance)) {
        throw new Error(`Conflicting SOURCES entry: ${theme.id}`);
      }
    } else {
      document.themes.push(provenance);
    }
  }
  return `${JSON.stringify(document, null, 2)}\n`;
});

console.log(
  `Integrated ${themes.length} nature themes from ${manifestNames.length} manifests.`,
);
