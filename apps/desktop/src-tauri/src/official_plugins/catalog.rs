use super::OfficialPluginItem;
use crate::codex_gui::plugin_client::{PluginClient, PluginError, Result};
use serde::Deserialize;
use serde_json::{json, Value};

const OFFICIAL_MARKETPLACES: &[&str] = &[
    "openai-api-curated",
    "openai-curated",
    "openai-curated-remote",
    "openai-bundled",
    "openai-primary-runtime",
];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Catalog {
    marketplaces: Vec<Marketplace>,
    #[serde(default)]
    marketplace_load_errors: Vec<Value>,
}

#[derive(Deserialize)]
pub(super) struct Marketplace {
    name: String,
    path: Option<String>,
    plugins: Vec<Plugin>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Plugin {
    id: String,
    name: String,
    version: Option<String>,
    local_version: Option<String>,
    pub(super) installed: bool,
    enabled: bool,
    interface: Option<Interface>,
    source: Option<Source>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Source {
    Local {
        path: String,
    },
    #[serde(other)]
    Other,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Interface {
    display_name: Option<String>,
    short_description: Option<String>,
    developer_name: Option<String>,
    category: Option<String>,
    brand_color: Option<String>,
    logo_url: Option<String>,
    composer_icon_url: Option<String>,
    logo: Option<String>,
    composer_icon: Option<String>,
}

pub(super) async fn load(client: &mut PluginClient) -> Result<Catalog> {
    let response = client.request("plugin/list", json!({})).await?;
    let catalog: Catalog = serde_json::from_value(response).map_err(|_| PluginError::Catalog)?;
    // An incomplete catalog must not appear to be a successful empty listing.
    if !catalog.marketplace_load_errors.is_empty() {
        return Err(PluginError::Catalog);
    }
    Ok(catalog)
}

impl Catalog {
    pub(super) fn items(self) -> Vec<OfficialPluginItem> {
        self.marketplaces
            .into_iter()
            .filter(|market| is_official(&market.name))
            .flat_map(|market| market.plugins)
            .map(plugin_item)
            .collect()
    }

    pub(super) fn find(&self, id: &str) -> Result<(&Marketplace, &Plugin)> {
        self.marketplaces
            .iter()
            .filter(|market| is_official(&market.name))
            .find_map(|market| {
                market
                    .plugins
                    .iter()
                    .find(|plugin| plugin.id == id)
                    .map(|plugin| (market, plugin))
            })
            .ok_or(PluginError::Selection)
    }
}

fn is_official(name: &str) -> bool {
    OFFICIAL_MARKETPLACES.contains(&name)
}

pub(super) fn install_params(marketplace: &Marketplace, plugin: &Plugin) -> Value {
    match &marketplace.path {
        Some(path) => json!({"marketplacePath": path, "pluginName": plugin.name}),
        None => json!({"remoteMarketplaceName": marketplace.name, "pluginName": plugin.name}),
    }
}

fn plugin_item(plugin: Plugin) -> OfficialPluginItem {
    let interface = plugin.interface.unwrap_or_default();
    let source = match &plugin.source {
        Some(Source::Local { path }) => Some(path.as_str()),
        _ => None,
    };
    let local_icon = super::icons::local_icon(
        source,
        interface
            .logo
            .as_deref()
            .or(interface.composer_icon.as_deref()),
    );
    OfficialPluginItem {
        id: plugin.id,
        title: interface
            .display_name
            .unwrap_or_else(|| plugin.name.clone()),
        name: plugin.name,
        description: interface.short_description.unwrap_or_default(),
        version: plugin.version.or(plugin.local_version).unwrap_or_default(),
        category: interface.category.unwrap_or_default(),
        developer: interface.developer_name.unwrap_or_else(|| "OpenAI".into()),
        brand_color: interface.brand_color.filter(|color| {
            color.len() == 7
                && color.starts_with('#')
                && color[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
        }),
        icon_url: interface
            .logo_url
            .or(interface.composer_icon_url)
            .filter(|value| {
                url::Url::parse(value)
                    .is_ok_and(|url| url.scheme() == "https" && url.host_str().is_some())
            })
            .or(local_icon),
        installed: plugin.installed,
        enabled: plugin.installed && plugin.enabled,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn catalog() -> Catalog {
        serde_json::from_value(json!({"marketplaces": [
            {"name":"openai-curated","path":null,"plugins":[{
                "id":"demo@openai-curated","name":"demo","installed":true,"enabled":false,
                "version":null,"localVersion":"1.2.3","interface":{"displayName":"Demo"}
            }]},
            {"name":"community","path":null,"plugins":[{
                "id":"other@community","name":"other","installed":false,"enabled":false
            }]}
        ]}))
        .unwrap()
    }

    #[test]
    fn uses_cli_installation_state_and_filters_community_plugins() {
        let items = catalog().items();
        assert_eq!(items.len(), 1);
        assert!(items[0].installed);
        assert!(!items[0].enabled);
        assert_eq!(items[0].version, "1.2.3");
        assert_eq!(items[0].title, "Demo");
    }

    #[test]
    fn only_catalog_entries_can_be_changed_and_paths_come_from_cli() {
        let mut catalog = catalog();
        assert!(catalog.find("other@community").is_err());
        assert!(catalog.find("../demo@openai-curated").is_err());
        let (market, plugin) = catalog.find("demo@openai-curated").unwrap();
        assert_eq!(
            install_params(market, plugin),
            json!({
                "remoteMarketplaceName":"openai-curated","pluginName":"demo"
            })
        );
        catalog.marketplaces[0].path = Some("/selected/home/marketplace.json".into());
        let (market, plugin) = catalog.find("demo@openai-curated").unwrap();
        assert_eq!(
            install_params(market, plugin),
            json!({
                "marketplacePath":"/selected/home/marketplace.json","pluginName":"demo"
            })
        );
    }
}
