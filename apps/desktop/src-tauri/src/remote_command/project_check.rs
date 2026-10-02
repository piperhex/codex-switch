//! Fixed project checks share bounded output, process-tree cleanup and timeouts with remote diagnostics.
use super::{
    executor, platform,
    protocol::{CommandRequest, Shell},
    Result,
};
use std::path::Path;

#[derive(Clone, Copy)]
pub(crate) enum ProjectCommand {
    NpmBuild,
    NpmLint,
    NpmTest,
    CargoBuild,
    CargoLint,
    CargoTest,
    GoBuild,
    GoLint,
    GoTest,
}

impl ProjectCommand {
    pub(crate) fn npm(kind: &str) -> Self {
        match kind {
            "build" => Self::NpmBuild,
            "lint" => Self::NpmLint,
            _ => Self::NpmTest,
        }
    }
    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::NpmBuild => "npm run build",
            Self::NpmLint => "npm run lint",
            Self::NpmTest => "npm run test",
            Self::CargoBuild => "cargo build",
            Self::CargoLint => "cargo clippy",
            Self::CargoTest => "cargo test",
            Self::GoBuild => "go build ./...",
            Self::GoLint => "go vet ./...",
            Self::GoTest => "go test ./...",
        }
    }
}

pub(crate) struct CheckOutput {
    pub exit_code: Option<i32>,
    pub output: String,
}

/// No command text is accepted from IPC; callers choose one of the fixed project actions above.
pub(crate) async fn run(cwd: &Path, command: ProjectCommand) -> Result<CheckOutput> {
    let request = CommandRequest {
        command: platform::project_script(command.label()),
        cwd: Some(cwd.to_string_lossy().into_owned()),
        shell: Shell::Auto,
        timeout_seconds: 1800,
    };
    let result = executor::execute_prevalidated(request, || true).await?;
    let mut output = format!("{}\n{}", result.stdout, result.stderr);
    if result.truncated {
        output.push_str("\n输出较长，已省略后续内容。");
    }
    if result.timed_out {
        output.push_str("\n验证超过 30 分钟，已停止。请在电脑上检查。");
    }
    Ok(CheckOutput {
        exit_code: if result.timed_out {
            None
        } else {
            result.exit_code
        },
        output,
    })
}
