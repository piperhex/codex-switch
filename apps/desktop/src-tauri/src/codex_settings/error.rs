use std::{error::Error, fmt};

use super::models::ConfigDiagnostic;

#[derive(Debug)]
pub(super) enum ConfigError {
    HomeUnavailable,
    Read,
    Write,
    Busy,
    Conflict,
    TooLarge,
    InvalidPath,
    InvalidValue,
    InvalidToml(ConfigDiagnostic),
    UnrepresentableValue,
}

impl fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::HomeUnavailable => "暂时无法找到 Codex 配置目录，请检查设置。",
            Self::Read => "无法读取配置，请检查文件是否可访问后重试。",
            Self::Write => "配置未能保存，请检查文件是否可写后重试。",
            Self::Busy => "配置暂时无法编辑，请稍后重试。",
            Self::Conflict => "配置已在其他位置更新，请重新加载后再编辑。",
            Self::TooLarge => "配置文件过大，暂时无法在此编辑。",
            Self::InvalidPath => "无法修改此配置项，请重新加载后重试。",
            Self::InvalidValue => "此配置值无法保存，请检查填写的内容。",
            Self::InvalidToml(diagnostic) => return diagnostic.fmt(formatter),
            Self::UnrepresentableValue => "此配置包含特殊格式的值，请使用文件编辑器修改。",
        };
        formatter.write_str(message)
    }
}

impl fmt::Display for ConfigDiagnostic {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match (self.line, self.column) {
            (Some(line), Some(column)) => {
                write!(formatter, "第 {line} 行，第 {column} 列：{}", self.message)
            }
            _ => formatter.write_str(&self.message),
        }
    }
}

impl Error for ConfigError {}

impl ConfigError {
    pub(super) fn diagnostic(&self) -> ConfigDiagnostic {
        match self {
            Self::InvalidToml(diagnostic) => diagnostic.clone(),
            _ => ConfigDiagnostic {
                message: self.to_string(),
                line: None,
                column: None,
            },
        }
    }
}
