#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct LaunchOptions {
    pub(crate) headless: bool,
    pub(crate) port: Option<u16>,
}

impl LaunchOptions {
    pub(crate) fn parse<I, S>(args: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let args = args.into_iter().map(Into::into).collect::<Vec<_>>();
        let mut headless = false;
        let mut port = None;
        let mut index = 0;

        while index < args.len() {
            let argument = &args[index];
            if argument == "--headless" {
                headless = true;
            } else if argument == "--port" {
                if port.is_some() {
                    return Err("--port may only be specified once".to_string());
                }
                index += 1;
                let value = args
                    .get(index)
                    .ok_or_else(|| "--port requires a value".to_string())?;
                port = Some(parse_port(value)?);
            } else if let Some(value) = argument.strip_prefix("--port=") {
                if port.is_some() {
                    return Err("--port may only be specified once".to_string());
                }
                port = Some(parse_port(value)?);
            }
            index += 1;
        }

        if headless && port.is_none() {
            return Err("--headless requires --port=<1-65535>".to_string());
        }
        if !headless && port.is_some() {
            return Err("--port can only be used together with --headless".to_string());
        }

        Ok(Self { headless, port })
    }

    pub(crate) fn from_environment() -> Result<Self, String> {
        Self::parse(std::env::args_os().map(|argument| argument.to_string_lossy().into_owned()))
    }
}

fn parse_port(value: &str) -> Result<u16, String> {
    let port = value.parse::<u16>().map_err(|_| {
        format!("Invalid --port value '{value}'; expected an integer from 1 to 65535")
    })?;
    if port == 0 {
        return Err("--port must be between 1 and 65535".to_string());
    }
    Ok(port)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_launch_is_the_default() {
        assert_eq!(
            LaunchOptions::parse(["codex-switch"]).unwrap(),
            LaunchOptions {
                headless: false,
                port: None,
            }
        );
    }

    #[test]
    fn headless_launch_accepts_both_port_syntaxes() {
        assert_eq!(
            LaunchOptions::parse(["codex-switch", "--headless", "--port=18080"]).unwrap(),
            LaunchOptions {
                headless: true,
                port: Some(18_080),
            }
        );
        assert_eq!(
            LaunchOptions::parse(["codex-switch", "--port", "18081", "--headless"]).unwrap(),
            LaunchOptions {
                headless: true,
                port: Some(18_081),
            }
        );
    }

    #[test]
    fn headless_launch_requires_a_valid_port() {
        assert!(LaunchOptions::parse(["codex-switch", "--headless"]).is_err());
        assert!(LaunchOptions::parse(["codex-switch", "--headless", "--port=0"]).is_err());
        assert!(LaunchOptions::parse(["codex-switch", "--headless", "--port=65536"]).is_err());
        assert!(LaunchOptions::parse(["codex-switch", "--port=18080"]).is_err());
    }

    #[test]
    fn unrelated_arguments_are_ignored() {
        assert_eq!(
            LaunchOptions::parse(["codex-switch", "--some-platform-flag"]).unwrap(),
            LaunchOptions {
                headless: false,
                port: None,
            }
        );
    }
}
