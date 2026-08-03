import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktop = path.join(root, "apps", "desktop");
const presetsRoot = path.join(desktop, "src-tauri", "resources", "dream-skin", "presets");

const rawThemes = [
  ["neon-orbital-citadel", "Neon Orbital Citadel", "霓虹轨道城塞", "A neon orbital citadel above a cobalt planet.", "dark", "orbital"],
  ["cryo-moon-harbor", "Cryo Moon Harbor", "冰月港", "A frozen moon harbor lit by cyan docking beacons.", "dark", "planetary"],
  ["quantum-desert-relay", "Quantum Desert Relay", "量子荒漠中继站", "A quantum relay rising from a silent alien desert.", "dark", "frontier"],
  ["bioluminescent-star-garden", "Bioluminescent Star Garden", "星海荧光花园", "A bioluminescent garden blooming beneath the stars.", "dark", "biotech"],
  ["void-sail-observatory", "Void Sail Observatory", "虚空帆天文台", "A solar-sail observatory poised at the edge of darkness.", "dark", "orbital"],
  ["titan-methane-foundry", "Titan Methane Foundry", "土卫六甲烷铸造厂", "An amber methane foundry beneath Titan's haze.", "dark", "industrial"],
  ["aurora-dyson-bloom", "Aurora Dyson Bloom", "极光戴森花", "A flower-like Dyson array opening around a young star.", "dark", "megastructure"],
  ["mars-glass-canyon", "Mars Glass Canyon", "火星玻璃峡谷", "A glass habitat spanning a wind-carved Martian canyon.", "dark", "planetary"],
  ["pulsar-archive", "Pulsar Archive", "脉冲星档案馆", "A deep-space archive synchronized to a blue pulsar.", "dark", "cosmic"],
  ["europa-subsea-beacon", "Europa Subsea Beacon", "木卫二深海信标", "A research beacon glowing beneath Europa's ice.", "dark", "oceanic"],
  ["cybernetic-monsoon-city", "Cybernetic Monsoon City", "赛博季风城", "A rain-washed cybernetic city under violet monsoon clouds.", "dark", "cyber-city"],
  ["solar-wind-monastery", "Solar Wind Monastery", "太阳风修道院", "A serene monastery collecting ribbons of solar wind.", "dark", "spiritual"],
  ["antimatter-cathedral", "Antimatter Cathedral", "反物质圣殿", "A monumental antimatter chamber with sacred geometry.", "dark", "cosmic"],
  ["cobalt-warp-gate", "Cobalt Warp Gate", "钴蓝跃迁门", "A cobalt warp gate awakening above a remote outpost.", "dark", "megastructure"],
  ["lunar-rice-terrace", "Lunar Rice Terrace", "月海稻田", "Luminous lunar rice terraces beneath a pale Earth.", "light", "solarpunk"],
  ["singularity-lighthouse", "Singularity Lighthouse", "奇点灯塔", "A lone lighthouse guiding ships around a black hole.", "dark", "cosmic"],
  ["comet-caravan", "Comet Caravan", "彗星商队", "A caravan of small craft surfing a comet's luminous tail.", "dark", "frontier"],
  ["exoplanet-cloud-port", "Exoplanet Cloud Port", "系外云港", "A floating port above an exoplanet's endless cloud sea.", "light", "planetary"],
  ["nebula-forge", "Nebula Forge", "星云熔炉", "A stellar forge shaping metal inside a crimson nebula.", "dark", "industrial"],
  ["dark-matter-orchard", "Dark Matter Orchard", "暗物质果园", "An impossible orchard tended in a dark-matter field.", "dark", "cosmic"],
  ["chrome-forest-sentinel", "Chrome Forest Sentinel", "铬林守望者", "A gentle chrome sentinel watching an artificial forest.", "dark", "robotic"],
  ["porcelain-android-dawn", "Porcelain Android Dawn", "瓷白仿生人黎明", "A porcelain android greeting dawn on a quiet station.", "light", "robotic"],
  ["mech-jellyfish-trench", "Mech Jellyfish Trench", "机械水母海沟", "Mechanical jellyfish exploring a cobalt ocean trench.", "dark", "robotic"],
  ["repair-drone-sanctuary", "Repair Drone Sanctuary", "维修无人机圣所", "Tiny repair drones resting in a warm machine sanctuary.", "dark", "robotic"],
  ["quantum-fox-companion", "Quantum Fox Companion", "量子狐伴侣", "An original fox-shaped quantum companion on a starship deck.", "dark", "robotic"],
  ["starship-drydock-zero", "Starship Drydock Zero", "零号星舰船坞", "A colossal starship suspended inside an orbital drydock.", "dark", "starship"],
  ["ion-sail-regatta", "Ion Sail Regatta", "离子帆竞赛", "Luminous ion sails racing across a turquoise gas giant.", "dark", "starship"],
  ["generation-ship-atrium", "Generation Ship Atrium", "世代飞船中庭", "A vast green atrium at the heart of a generation ship.", "light", "starship"],
  ["stealth-corvette-eclipse", "Stealth Corvette Eclipse", "隐形护卫舰日蚀", "A matte-black corvette crossing a ringed eclipse.", "dark", "starship"],
  ["asteroid-mining-barge", "Asteroid Mining Barge", "小行星采矿驳船", "An industrial mining barge working a luminous asteroid.", "dark", "industrial"],
  ["crystal-spore-valley", "Crystal Spore Valley", "晶孢谷", "Crystal spores drifting through an alien twilight valley.", "dark", "xenobiology"],
  ["floating-coral-moon", "Floating Coral Moon", "浮珊瑚月", "Floating coral islands orbiting a warm ocean moon.", "light", "xenobiology"],
  ["plasma-whale-migration", "Plasma Whale Migration", "等离子鲸迁徙", "Vast original plasma whales migrating through a nebula.", "dark", "xenobiology"],
  ["silicon-bamboo-grove", "Silicon Bamboo Grove", "硅竹林", "A shimmering silicon bamboo grove beneath twin suns.", "light", "xenobiology"],
  ["gravity-lily-lagoon", "Gravity Lily Lagoon", "重力睡莲湖", "Giant gravity lilies floating above an alien lagoon.", "light", "xenobiology"],
  ["chrono-station-echo", "Chrono Station Echo", "回声时间站", "A time station repeating itself along a frozen horizon.", "dark", "temporal"],
  ["retrocausal-library", "Retrocausal Library", "逆因果图书馆", "An impossible library where light arrives before its source.", "dark", "temporal"],
  ["last-minute-of-earth", "Last Minute of Earth", "地球最后一分钟", "A quiet orbital view of Earth under a stopped cosmic clock.", "dark", "temporal"],
  ["temporal-tea-house", "Temporal Tea House", "时序茶馆", "A peaceful futuristic tea house suspended between eras.", "light", "temporal"],
  ["aeon-clockwork-plain", "Aeon Clockwork Plain", "亿万年钟表原野", "Ancient clockwork mechanisms crossing an endless alien plain.", "dark", "temporal"],
  ["neutrino-lab-night", "Neutrino Lab Night", "中微子实验室之夜", "A subterranean neutrino detector glowing in the night.", "dark", "laboratory"],
  ["holographic-botany-deck", "Holographic Botany Deck", "全息植物甲板", "A starship botany deck filled with holographic plants.", "dark", "laboratory"],
  ["fusion-core-sanctum", "Fusion Core Sanctum", "聚变核心圣室", "A pristine fusion core suspended in a circular chamber.", "dark", "laboratory"],
  ["xenobiology-greenhouse", "Xenobiology Greenhouse", "异星生物温室", "A research greenhouse cultivating gentle alien flora.", "light", "laboratory"],
  ["quantum-computing-vault", "Quantum Computing Vault", "量子计算穹窖", "A cryogenic quantum vault beneath violet light.", "dark", "laboratory"],
  ["clean-energy-megacity", "Clean Energy Megacity", "清洁能源巨城", "A hopeful megacity powered by sun, wind, and fusion.", "light", "utopian"],
  ["ocean-skybridge", "Ocean Skybridge", "海洋天桥", "An elegant skybridge linking ocean arcologies at sunrise.", "light", "utopian"],
  ["orbital-agriculture-ring", "Orbital Agriculture Ring", "轨道农业环", "A green agricultural ring encircling a blue planet.", "light", "utopian"],
  ["lunar-library-plaza", "Lunar Library Plaza", "月球图书馆广场", "A quiet lunar library plaza beneath the Earth.", "light", "utopian"],
  ["terraformed-venus-garden", "Terraformed Venus Garden", "金星改造花园", "A garden city flourishing on a cooled, terraformed Venus.", "light", "utopian"],
  ["acid-rain-data-bazaar", "Acid Rain Data Bazaar", "酸雨数据集市", "A shadowy data bazaar under corrosive green rain.", "dark", "dystopian"],
  ["abandoned-moon-metro", "Abandoned Moon Metro", "废弃月球地铁", "An abandoned lunar metro reclaimed by frost and silence.", "dark", "dystopian"],
  ["red-signal-quarantine", "Red Signal Quarantine", "红色信号隔离区", "A remote quarantine station under a single red beacon.", "dark", "dystopian"],
  ["ashfall-server-farm", "Ashfall Server Farm", "落灰服务器农场", "A server farm glowing through ashfall on a dying world.", "dark", "dystopian"],
  ["blackout-megacity", "Blackout Megacity", "断电巨城", "A powerless megacity with one surviving blue district.", "dark", "dystopian"],
  ["photosynthetic-tower", "Photosynthetic Tower", "光合塔", "A living tower harvesting sunlight above a green city.", "light", "solarpunk"],
  ["sunlit-robot-village", "Sunlit Robot Village", "阳光机器人村", "Friendly original robots tending a sunlit future village.", "light", "solarpunk"],
  ["algae-canal-district", "Algae Canal District", "藻类运河区", "A calm canal district powered by luminous algae.", "light", "solarpunk"],
  ["wind-harvester-steppe", "Wind Harvester Steppe", "风能采集草原", "Graceful wind harvesters crossing a golden future steppe.", "light", "solarpunk"],
  ["seedship-nursery", "Seedship Nursery", "种子飞船育苗舱", "A warm seedship nursery preserving Earth's plants.", "light", "solarpunk"],
  ["atomic-age-space-lounge", "Atomic Age Space Lounge", "原子时代太空酒廊", "A polished retrofuturist lounge overlooking Saturn.", "dark", "retrofuture"],
  ["cassette-cosmos-console", "Cassette Cosmos Console", "磁带宇宙控制台", "An analog space console with tactile cassette mechanisms.", "dark", "retrofuture"],
  ["analog-mission-control", "Analog Mission Control", "模拟任务控制中心", "A warm analog mission control room facing the stars.", "dark", "retrofuture"],
  ["chrome-rocket-motel", "Chrome Rocket Motel", "铬火箭汽车旅馆", "A chrome rocket motel beneath a lavender alien sky.", "dark", "retrofuture"],
  ["vacuum-tube-star-map", "Vacuum Tube Star Map", "电子管星图", "A glowing star map built from vacuum tubes and brass.", "dark", "retrofuture"],
  ["event-horizon-ribbons", "Event Horizon Ribbons", "事件视界光带", "Abstract ribbons of light wrapping an event horizon.", "dark", "abstract"],
  ["gravitational-wave-sea", "Gravitational Wave Sea", "引力波之海", "A cosmic sea shaped by passing gravitational waves.", "dark", "abstract"],
  ["quantum-foam-cavern", "Quantum Foam Cavern", "量子泡沫洞窟", "A luminous cavern visualizing the texture of spacetime.", "dark", "abstract"],
  ["photon-prism-temple", "Photon Prism Temple", "光子棱镜神殿", "A geometric prism temple splitting stellar light.", "dark", "abstract"],
  ["entangled-light-garden", "Entangled Light Garden", "纠缠光花园", "Paired flowers of entangled light across a dark garden.", "dark", "abstract"],
  ["orbital-rescue-wing", "Orbital Rescue Wing", "轨道救援联队", "Rescue craft approaching a damaged orbital habitat.", "dark", "rescue"],
  ["frontier-peacekeeper-outpost", "Frontier Peacekeeper Outpost", "边疆维和前哨", "A calm frontier outpost watching a distant settlement.", "dark", "rescue"],
  ["asteroid-defense-grid", "Asteroid Defense Grid", "小行星防御网", "A planetary defense grid redirecting incoming asteroids.", "dark", "rescue"],
  ["humanitarian-mech-convoy", "Humanitarian Mech Convoy", "人道机甲车队", "Utility mechs carrying relief supplies across an alien plain.", "light", "rescue"],
  ["deep-space-searchlight", "Deep Space Searchlight", "深空搜救灯", "A powerful searchlight scanning a silent debris field.", "dark", "rescue"],
  ["jade-orbit-palace", "Jade Orbit Palace", "玉衡轨道宫", "A jade-and-gold orbital palace inspired by Chinese architecture.", "dark", "chinese-scifi"],
  ["neon-changan-station", "Neon Chang'an Station", "霓虹长安站", "A grand future station blending Chang'an geometry and neon.", "dark", "chinese-scifi"],
  ["celestial-silk-road", "Celestial Silk Road", "天际丝路", "Merchant starships following a luminous celestial trade route.", "dark", "chinese-scifi"],
  ["moon-rabbit-rover", "Moon Rabbit Rover", "月兔探测车", "An original rabbit-shaped rover crossing a tranquil lunar plain.", "light", "chinese-scifi"],
  ["red-lantern-starport", "Red Lantern Starport", "红灯笼星港", "A festive starport glowing with abstract red orbital lanterns.", "dark", "chinese-scifi"],
  ["abyssal-data-center", "Abyssal Data Center", "深渊数据中心", "A pressure-hardened data center in the midnight ocean.", "dark", "oceanic"],
  ["submarine-city-dawn", "Submarine City Dawn", "潜海城黎明", "A transparent submarine city greeting blue ocean dawn.", "light", "oceanic"],
  ["hydrothermal-research-rig", "Hydrothermal Research Rig", "热液研究平台", "A research rig studying radiant hydrothermal vents.", "dark", "oceanic"],
  ["ocean-planet-arcology", "Ocean Planet Arcology", "海洋行星生态城", "A self-sufficient arcology floating on a global ocean.", "light", "oceanic"],
  ["tidal-energy-cathedral", "Tidal Energy Cathedral", "潮汐能源圣殿", "A monumental tidal generator beneath turquoise waves.", "dark", "oceanic"],
  ["polar-aurora-array", "Polar Aurora Array", "极地极光阵列", "A scientific antenna array beneath sweeping auroras.", "dark", "arctic"],
  ["icebound-robot-caravan", "Icebound Robot Caravan", "冰原机器人商队", "Original utility robots crossing a luminous ice plain.", "dark", "arctic"],
  ["cryogenic-seed-vault", "Cryogenic Seed Vault", "低温种子库", "A futuristic seed vault embedded in a blue glacier.", "dark", "arctic"],
  ["glacier-quantum-lab", "Glacier Quantum Lab", "冰川量子实验室", "A crystalline quantum laboratory inside ancient ice.", "dark", "arctic"],
  ["snowfield-sky-elevator", "Snowfield Sky Elevator", "雪原太空电梯", "A sky elevator rising from a quiet polar snowfield.", "light", "arctic"],
  ["first-contact-horizon", "First Contact Horizon", "初次接触地平线", "Two distant civilizations meeting at a luminous horizon.", "dark", "mystery"],
  ["alien-megastructure-dusk", "Alien Megastructure Dusk", "异星巨构黄昏", "An unknowable alien megastructure emerging at dusk.", "dark", "mystery"],
  ["silent-radio-telescope", "Silent Radio Telescope", "寂静射电望远镜", "A lone radio telescope listening beneath an impossible sky.", "dark", "mystery"],
  ["ancient-probe-awakening", "Ancient Probe Awakening", "远古探测器苏醒", "An ancient interstellar probe awakening under starlight.", "dark", "mystery"],
  ["interstellar-ruin-garden", "Interstellar Ruin Garden", "星际遗迹花园", "Alien flowers growing through a forgotten starship ruin.", "dark", "mystery"],
  ["spaceship-window-cafe", "Spaceship Window Café", "飞船舷窗咖啡馆", "A cozy café beside a starship window and drifting nebula.", "dark", "cozy"],
  ["moonbase-reading-nook", "Moonbase Reading Nook", "月球基地阅读角", "A warm reading nook overlooking the lunar night.", "dark", "cozy"],
  ["robot-workshop-evening", "Robot Workshop Evening", "机器人修理铺夜晚", "A cozy evening workshop for small original service robots.", "dark", "cozy"],
  ["orbital-rainy-bedroom", "Orbital Rainy Bedroom", "轨道雨夜卧室", "A quiet orbital bedroom with simulated rain on the glass.", "dark", "cozy"],
  ["starlight-noodle-stall", "Starlight Noodle Stall", "星光面摊", "A tiny futuristic noodle stall beneath a crowded starfield.", "dark", "cozy"],
];

const themes = rawThemes.map(([slug, englishName, nameZh, summary, appearance, tone]) => {
  const key = slug.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  return {
    id: `preset-${slug}`,
    key,
    englishName,
    nameZh,
    summary,
    appearance,
    tone,
    descriptionEn: `${summary} Original science-fiction art with a calm left UI area.`,
    descriptionZh: `${nameZh}主题以原创科幻场景营造沉浸氛围，左侧保留安静清晰的界面区域。`,
  };
});

if (themes.length !== 100) {
  throw new Error(`Expected 100 themes, got ${themes.length}`);
}

for (const theme of themes) {
  const dir = path.join(presetsRoot, theme.id);
  for (const filename of ["background.jpg", "theme.json"]) {
    if (!fs.existsSync(path.join(dir, filename))) {
      throw new Error(`Missing ${theme.id}/${filename}`);
    }
  }
}

const builtInsPath = path.join(desktop, "src", "dreamSkinBuiltIns.ts");
let builtIns = fs.readFileSync(builtInsPath, "utf8");
const builtInInsertAt = builtIns.indexOf("] as const satisfies readonly BuiltInDreamSkinTheme[];");
if (builtInInsertAt < 0) throw new Error("Cannot find built-in theme insertion point");
const builtInEntries = themes
  .filter((theme) => !builtIns.includes(`id: "${theme.id}"`))
  .map(
    (theme) => `  {
    id: "${theme.id}",
    englishName: ${JSON.stringify(theme.englishName)},
    nameKey: "dreamSkin.theme.${theme.key}.name",
    descriptionKey: "dreamSkin.theme.${theme.key}.description",
    tone: "${theme.tone}",
    appearance: "${theme.appearance}",
  },
`,
  )
  .join("");
builtIns = `${builtIns.slice(0, builtInInsertAt)}${builtInEntries}${builtIns.slice(builtInInsertAt)}`;
fs.writeFileSync(builtInsPath, builtIns, "utf8");

const rustPath = path.join(desktop, "src-tauri", "src", "dream_skin_native.rs");
let rust = fs.readFileSync(rustPath, "utf8");
const arrayPattern = /(?:pub\(crate\) )?const BUILT_IN_THEME_IDS: \[&str; \d+\] = \[(?<body>[\s\S]*?)\n\];/;
const arrayMatch = rust.match(arrayPattern);
if (!arrayMatch?.groups) throw new Error("Cannot find Rust built-in theme array");
const ids = [...arrayMatch.groups.body.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
for (const theme of themes) if (!ids.includes(theme.id)) ids.push(theme.id);
const rustArray = `const BUILT_IN_THEME_IDS: [&str; ${ids.length}] = [\n${ids.map((id) => `    "${id}",`).join("\n")}\n];`;
rust = rust.replace(arrayPattern, rustArray);
fs.writeFileSync(rustPath, rust, "utf8");

const i18nPath = path.join(desktop, "src", "i18n.ts");
let i18n = fs.readFileSync(i18nPath, "utf8");
const removeTranslationLine = (text, line) =>
  text
    .replaceAll(`${line}\r\n`, "\r\n")
    .replaceAll(`${line}\n`, "\n")
    .replaceAll(line, "");
for (const theme of themes) {
  for (const [suffix, value] of [
    ["name", theme.englishName],
    ["description", theme.descriptionEn],
    ["name", theme.nameZh],
    ["description", theme.descriptionZh],
  ]) {
    const line = `    "dreamSkin.theme.${theme.key}.${suffix}": ${JSON.stringify(value)},`;
    i18n = removeTranslationLine(i18n, line);
  }
}
i18n = i18n
  .replace(/(\r?\n  },)(?:\r?\n[ \t]*)+(\r?\n  zh: \{)/, "$1$2")
  .replace(/(?:\r?\n[ \t]*)+(\r?\n  },\r?\n} as const;)/, "$1");
const zhMarker = "  zh: {";
const enCloseMatch = i18n.match(/\r?\n  },\r?\n  zh: \{/);
const enCloseAt = enCloseMatch?.index ?? -1;
if (enCloseAt < 0) throw new Error("Cannot find en locale insertion point");
const enEol = enCloseMatch[0].startsWith("\r\n") ? "\r\n" : "\n";
const enEntries = themes
  .map(
    (theme) =>
      `    "dreamSkin.theme.${theme.key}.name": ${JSON.stringify(theme.englishName)},${enEol}` +
      `    "dreamSkin.theme.${theme.key}.description": ${JSON.stringify(theme.descriptionEn)},${enEol}`,
  )
  .join("");
const enInsertAt = enCloseAt + enEol.length;
i18n = `${i18n.slice(0, enInsertAt)}${enEntries}${i18n.slice(enInsertAt)}`;
const localeCloseMatch = [...i18n.matchAll(/\r?\n  },\r?\n} as const;/g)].at(-1);
const zhEnd = localeCloseMatch?.index ?? -1;
if (zhEnd < 0) throw new Error("Cannot find zh locale insertion point");
const zhEol = localeCloseMatch[0].startsWith("\r\n") ? "\r\n" : "\n";
const zhEntries = themes
  .map(
    (theme) =>
      `    "dreamSkin.theme.${theme.key}.name": ${JSON.stringify(theme.nameZh)},${zhEol}` +
      `    "dreamSkin.theme.${theme.key}.description": ${JSON.stringify(theme.descriptionZh)},${zhEol}`,
  )
  .join("");
const zhInsertAt = zhEnd + zhEol.length;
i18n = `${i18n.slice(0, zhInsertAt)}${zhEntries}${i18n.slice(zhInsertAt)}`;
fs.writeFileSync(i18nPath, i18n, "utf8");

const sourcesPath = path.join(presetsRoot, "SOURCES.json");
const sources = JSON.parse(fs.readFileSync(sourcesPath, "utf8"));
for (const theme of themes) {
  if (sources.themes.some((entry) => entry.id === theme.id)) continue;
  sources.themes.push({
    id: theme.id,
    category: `science-fiction-${theme.tone}`,
    rightsStatus: "projectOriginal",
    nameEn: theme.englishName,
    nameZh: theme.nameZh,
    promptSummary: theme.summary,
  });
}
fs.writeFileSync(sourcesPath, `${JSON.stringify(sources, null, 2)}\n`, "utf8");

const integratedBuiltIns = fs.readFileSync(builtInsPath, "utf8");
const integratedRust = fs.readFileSync(rustPath, "utf8");
const integratedI18n = fs.readFileSync(i18nPath, "utf8");
const integratedSources = JSON.parse(fs.readFileSync(sourcesPath, "utf8"));
const countOccurrences = (text, needle) => text.split(needle).length - 1;

for (const theme of themes) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(presetsRoot, theme.id, "theme.json"), "utf8"));
  if (packageJson.id !== theme.id || packageJson.appearance !== theme.appearance) {
    throw new Error(`Package metadata mismatch for ${theme.id}`);
  }
  if (countOccurrences(integratedRust, `"${theme.id}"`) !== 1) {
    throw new Error(`Rust registry mismatch for ${theme.id}`);
  }
  if (!integratedBuiltIns.includes(`id: "${theme.id}"`)) {
    throw new Error(`TypeScript registry missing ${theme.id}`);
  }
  for (const suffix of ["name", "description"]) {
    const key = `"dreamSkin.theme.${theme.key}.${suffix}"`;
    if (countOccurrences(integratedI18n, key) !== 2) {
      throw new Error(`Expected English and Chinese translations for ${key}`);
    }
  }
  if (integratedSources.themes.filter((entry) => entry.id === theme.id).length !== 1) {
    throw new Error(`Provenance mismatch for ${theme.id}`);
  }
}

const rustIds = [...integratedRust.matchAll(/^\s+"(preset-[^"]+)",$/gm)].map((match) => match[1]);
const typescriptIds = [...integratedBuiltIns.matchAll(/^\s+id: "(preset-[^"]+)",$/gm)].map((match) => match[1]);
if (rustIds.length !== ids.length || typescriptIds.length !== ids.length) {
  throw new Error(`Registry count mismatch: Rust ${rustIds.length}, TypeScript ${typescriptIds.length}, expected ${ids.length}`);
}

console.log(
  `Integrated and verified ${themes.length} science-fiction themes; both registries now have ${ids.length} IDs.`,
);
