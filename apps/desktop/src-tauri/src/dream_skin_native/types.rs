use std::{
    collections::{HashMap, HashSet},
    fs,
    io::ErrorKind,
    net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use image::{ImageFormat, ImageReader};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use sysinfo::{ProcessesToUpdate, System};
use tauri::{AppHandle, Manager};
use tungstenite::{client, Message, WebSocket};
use url::Url;
use uuid::Uuid;

#[cfg(any(target_os = "windows", target_os = "macos"))]
use std::process::Command;

use crate::dream_skin::{
    state_root, DreamSkinImportOptions, DreamSkinStatus, DreamSkinThemeSummary,
};

const NATIVE_RUNTIME_VERSION: &str = "2.0.0";
const SKIN_VERSION: &str = "1.2.2";
const DEFAULT_CDP_PORT: u16 = 9335;
const CDP_COMMAND_TIMEOUT: Duration = Duration::from_secs(10);
const CODEX_RENDERER_START_TIMEOUT: Duration = Duration::from_secs(30);
const DREAM_SKIN_START_VERIFICATION_TIMEOUT: Duration = Duration::from_secs(90);
const MAX_ART_BYTES: u64 = 16 * 1024 * 1024;
const MAX_ART_DIMENSION: u32 = 16_384;
const MAX_ART_PIXELS: u64 = 50_000_000;
pub(crate) const BUILT_IN_THEME_IDS: [&str; 173] = [
    "preset-gothic-void-crusade",
    "preset-rose-reverie",
    "preset-fortune-at-work",
    "preset-coral-horizon",
    "preset-sage-daylight",
    "preset-spark-studio",
    "preset-cosmic-violet",
    "preset-aqua-resonance",
    "preset-midnight-gold",
    "preset-celadon-sword-lord",
    "preset-bamboo-flute-scholar",
    "preset-crimson-cloud-general",
    "preset-white-fox-scholar",
    "preset-jade-dragon-prince",
    "preset-lantern-night-guard",
    "preset-snow-crane-swordsman",
    "preset-lotus-spring-healer",
    "preset-tea-mountain-youth",
    "preset-dunhuang-lotus-dancer",
    "preset-white-fox-maiden",
    "preset-bamboo-qin-muse",
    "preset-campus-cardigan-girl",
    "preset-bookstore-spring-girl",
    "preset-cafe-strawberry-girl",
    "preset-film-camera-girl",
    "preset-ultraman-tiga-sky",
    "preset-ultraman-zero-cosmos",
    "preset-ultraman-mebius-dawn",
    "preset-ultraman-z-starlight",
    "preset-doraemon-anywhere-door",
    "preset-doraemon-bamboo-copter",
    "preset-doraemon-time-machine",
    "preset-doraemon-nobita-night",
    "preset-tom-jerry-kitchen-chase",
    "preset-tom-jerry-piano-duet",
    "preset-tom-jerry-garden-picnic",
    "preset-tom-jerry-starry-night",
    "preset-spongebob-patrick-jellyfish",
    "preset-spongebob-patrick-pineapple",
    "preset-spongebob-patrick-krusty-krab",
    "preset-spongebob-patrick-starry-sea",
    "preset-boonie-bears-forest-day",
    "preset-boonie-bears-snow-adventure",
    "preset-boonie-bears-treehouse",
    "preset-boonie-bears-spring-picnic",
    "preset-pleasant-goat-grassland",
    "preset-pleasant-goat-wolffy-chase",
    "preset-pleasant-goat-lantern-night",
    "preset-pleasant-goat-friends-picnic",
    "preset-qin-moon-tianming-shaoyu",
    "preset-qin-moon-gai-nie",
    "preset-qin-moon-wei-zhuang",
    "preset-qin-moon-shaosiming",
    "preset-tom-jerry-attic-treasure",
    "preset-tom-jerry-beach-sandcastle",
    "preset-tom-jerry-magic-theater",
    "preset-tom-jerry-rainy-window-truce",
    "preset-tom-jerry-winter-ice-skating",
    "preset-tom-jerry-train-compartment",
    "preset-tom-jerry-candy-workshop",
    "preset-tom-jerry-museum-midnight",
    "preset-tom-jerry-moonlit-carnival",
    "preset-tom-jerry-autumn-leaf-race",
    "preset-doraemon-gadget-workshop",
    "preset-doraemon-cloud-kingdom",
    "preset-doraemon-moon-rabbit-picnic",
    "preset-doraemon-ocean-submarine",
    "preset-doraemon-snowman-festival",
    "preset-doraemon-dinosaur-valley",
    "preset-doraemon-space-train",
    "preset-doraemon-sakura-classroom",
    "preset-doraemon-desert-time-portal",
    "preset-doraemon-miniature-city",
    "preset-spongebob-seashell-carousel",
    "preset-spongebob-coral-library",
    "preset-spongebob-beach-band",
    "preset-spongebob-snail-birthday",
    "preset-spongebob-kelp-garden",
    "preset-spongebob-moon-jelly-cafe",
    "preset-spongebob-coral-art-studio",
    "preset-spongebob-rainbow-reef",
    "preset-spongebob-pearl-observatory",
    "preset-spongebob-pirate-parade",
    "preset-ultraman-dyna-nebula",
    "preset-ultraman-gaia-earth",
    "preset-ultraman-nexus-crimson",
    "preset-ultraman-orb-galaxy",
    "preset-ultraman-geed-city-night",
    "preset-ultraman-taiga-sunrise",
    "preset-ultraman-trigger-ruins",
    "preset-ultraman-decker-ocean",
    "preset-ultraman-blazar-thunder",
    "preset-ultraman-ace-meteor",
    "preset-lotso-strawberry-bedroom",
    "preset-lotso-cake-shop",
    "preset-lotso-cherry-picnic",
    "preset-lotso-cloud-swing",
    "preset-lotso-seaside-sundae",
    "preset-lotso-winter-cocoa",
    "preset-lotso-flower-greenhouse",
    "preset-lotso-moonlit-dream",
    "preset-lotso-rainbow-candy",
    "preset-lotso-autumn-knit",
    "preset-teletubbies-sunrise-meadow",
    "preset-teletubbies-rainbow-puddles",
    "preset-teletubbies-snowy-hill",
    "preset-teletubbies-bubble-dance",
    "preset-teletubbies-flower-train",
    "preset-teletubbies-moon-lantern",
    "preset-teletubbies-kite-day",
    "preset-teletubbies-picnic-blanket",
    "preset-teletubbies-seaside-shells",
    "preset-teletubbies-star-sleepover",
    "preset-little-carp-dragon-gate",
    "preset-little-carp-lotus-meimei",
    "preset-little-carp-volcano-courage",
    "preset-little-carp-moon-river-turtle",
    "preset-little-carp-rainbow-waterfall",
    "preset-little-carp-coral-palace",
    "preset-little-carp-bamboo-stream",
    "preset-little-carp-snow-pearl",
    "preset-little-carp-lantern-village",
    "preset-little-carp-star-lake-promise",
    "preset-cute-girl-strawberry-pajama",
    "preset-cute-girl-lavender-cat-cafe",
    "preset-cute-girl-mint-seaside-bicycle",
    "preset-cute-girl-peach-book-nook",
    "preset-cute-girl-moon-rabbit-dream",
    "preset-cute-girl-cherry-soda-arcade",
    "preset-cute-girl-cream-bakery",
    "preset-cute-girl-sky-music-room",
    "preset-cute-girl-hydrangea-rain",
    "preset-cute-girl-snow-fox-cocoa",
    "preset-boonie-bears-honey-workshop",
    "preset-boonie-bears-river-rafting",
    "preset-boonie-bears-sunflower-farm",
    "preset-boonie-bears-moon-campground",
    "preset-boonie-bears-autumn-train",
    "preset-boonie-bears-seaside-rescue",
    "preset-boonie-bears-bamboo-festival",
    "preset-boonie-bears-crystal-cave",
    "preset-boonie-bears-fruit-orchard",
    "preset-boonie-bears-rainy-cabin",
    "preset-pleasant-goat-science-fair",
    "preset-pleasant-goat-candy-carnival",
    "preset-pleasant-goat-seaside-volleyball",
    "preset-pleasant-goat-moon-castle",
    "preset-pleasant-goat-winter-hotpot",
    "preset-pleasant-goat-rainbow-sports",
    "preset-pleasant-goat-music-festival",
    "preset-pleasant-goat-cloud-airplane",
    "preset-pleasant-goat-fruit-harvest",
    "preset-pleasant-goat-detective-mystery",
    "preset-hongmao-lantu-rainbow-cliff",
    "preset-hongmao-lantu-bamboo-sword-dance",
    "preset-hongmao-lantu-ice-palace-lanterns",
    "preset-hongmao-lantu-seven-heroes-sunrise",
    "preset-hongmao-lantu-moonlit-waterfall",
    "preset-big-ear-tutu-rainbow-kindergarten",
    "preset-big-ear-tutu-dumpling-night",
    "preset-big-ear-tutu-seaside-bubbles",
    "preset-big-ear-tutu-snowy-neighborhood",
    "preset-big-ear-tutu-starry-rooftop",
    "preset-sanmao-spring-newspaper-lane",
    "preset-sanmao-riverside-paper-boat",
    "preset-sanmao-warm-noodle-stall",
    "preset-sanmao-lantern-wish",
    "preset-sanmao-seaside-kite",
    "preset-xiaofugui-imperial-kitchen-dawn",
    "preset-xiaofugui-lotus-feast",
    "preset-xiaofugui-lantern-market-snacks",
    "preset-xiaofugui-snowy-hotpot",
    "preset-xiaofugui-peach-blossom-picnic",
];
const RETIRED_THEME_IDS: [&str; 1] = ["preset-arina-hashimoto"];

static OPERATION_LOCK: Mutex<()> = Mutex::new(());
static MONITOR: OnceLock<Arc<MonitorControl>> = OnceLock::new();
static RUNTIME_LAUNCHING: AtomicBool = AtomicBool::new(false);

#[derive(Clone)]
struct RuntimePaths {
    bundled_root: PathBuf,
}

struct MonitorControl {
    paths: Mutex<Option<RuntimePaths>>,
    wake: Condvar,
}

struct RuntimeLaunchGuard;

#[derive(Clone, Copy, PartialEq, Eq)]
enum SkinVerificationMode {
    Background,
    Required,
}

impl RuntimeLaunchGuard {
    fn acquire() -> Self {
        RUNTIME_LAUNCHING.store(true, Ordering::Release);
        Self
    }
}

impl Drop for RuntimeLaunchGuard {
    fn drop(&mut self) {
        RUNTIME_LAUNCHING.store(false, Ordering::Release);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeSessionState {
    schema_version: u32,
    runtime_version: String,
    session: String,
    port: Option<u16>,
    codex_executable: Option<String>,
}

impl Default for NativeSessionState {
    fn default() -> Self {
        Self {
            schema_version: 1,
            runtime_version: NATIVE_RUNTIME_VERSION.to_string(),
            session: "ready".to_string(),
            port: None,
            codex_executable: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallationMarker {
    schema_version: u32,
    runtime: String,
    version: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CdpTarget {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    url: String,
    web_socket_debugger_url: String,
}

#[derive(Clone)]
struct LoadedPayload {
    source: String,
    revision: String,
}

struct LoadedTheme {
    document: Value,
    image_path: PathBuf,
    image_bytes: Vec<u8>,
    mime: &'static str,
}

#[derive(Clone)]
struct CodexInstall {
    executable: PathBuf,
    #[cfg(target_os = "windows")]
    app_user_model_id: Option<String>,
}

#[cfg(target_os = "windows")]
type VersionedCodexInstall = ((u16, u16, u16, u16), CodexInstall);

#[derive(Clone)]
struct InjectedTarget {
    revision: String,
    early_script_id: Option<String>,
}
