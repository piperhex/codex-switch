//! Local Android device fixture. Never use production chat grants in this process.
use csw_chat_connectivity::{Config, Connection, Event};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config: Config = serde_json::from_str(&std::env::var("DEVICE_FIXTURE_CONFIG")?)?;
    let connection = Connection::start(config)?;
    while let Some(event) = connection.receive().await {
        match event {
            Event::Data { text } => {
                println!("echo bytes={}", text.len());
                connection.send(text).await?;
            }
            Event::Closed => break,
            status => println!("{}", serde_json::to_string(&status)?),
        }
    }
    Ok(())
}
