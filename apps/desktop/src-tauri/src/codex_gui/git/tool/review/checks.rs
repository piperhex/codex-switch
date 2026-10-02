use super::{revision, store, GitError, Result};
use crate::remote_command::project_check::{self, ProjectCommand};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

const MAX_PACKAGE_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Kind {
    Build,
    Lint,
    Test,
}
impl Kind {
    pub(super) fn name(self) -> &'static str {
        match self {
            Self::Build => "build",
            Self::Lint => "lint",
            Self::Test => "test",
        }
    }
}

#[derive(Serialize)]
pub(crate) struct Plan {
    kind: Kind,
    command: &'static str,
    #[serde(skip)]
    runner: ProjectCommand,
}

impl Plan {
    fn new((kind, runner): (Kind, ProjectCommand)) -> Self {
        Self {
            kind,
            command: runner.label(),
            runner,
        }
    }
}

pub(super) fn discover(cwd: &Path) -> Result<Vec<Plan>> {
    let package = cwd.join("package.json");
    if package.is_file() {
        return npm_plans(&package);
    }
    let commands = if cwd.join("Cargo.toml").is_file() {
        vec![
            (Kind::Build, ProjectCommand::CargoBuild),
            (Kind::Lint, ProjectCommand::CargoLint),
            (Kind::Test, ProjectCommand::CargoTest),
        ]
    } else if cwd.join("go.mod").is_file() {
        vec![
            (Kind::Build, ProjectCommand::GoBuild),
            (Kind::Lint, ProjectCommand::GoLint),
            (Kind::Test, ProjectCommand::GoTest),
        ]
    } else {
        Vec::new()
    };
    Ok(commands.into_iter().map(Plan::new).collect())
}

fn npm_plans(package: &Path) -> Result<Vec<Plan>> {
    use std::io::Read;
    let mut bytes = Vec::new();
    fs::File::open(package)
        .map_err(|_| GitError::File)?
        .take(MAX_PACKAGE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| GitError::File)?;
    if bytes.len() as u64 > MAX_PACKAGE_BYTES {
        return Err(GitError::File);
    }
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| GitError::File)?;
    Ok([Kind::Build, Kind::Lint, Kind::Test]
        .into_iter()
        .filter(|kind| {
            value["scripts"][kind.name()]
                .as_str()
                .is_some_and(|text| !text.trim().is_empty())
        })
        .map(|kind| Plan::new((kind, ProjectCommand::npm(kind.name()))))
        .collect())
}

pub(super) struct Start<'a> {
    pub kind: Kind,
    pub expected: &'a str,
}

pub(super) fn start(
    cwd: &Path,
    root: &Path,
    storage: &Path,
    input: Start<'_>,
) -> Result<store::Check> {
    let Start { kind, expected } = input;
    let version = revision::read(root)?;
    if version.id != expected {
        return Err(GitError::ReviewChanged);
    }
    if store::read(storage)?
        .iter()
        .any(|check| check.status == store::Status::Running)
    {
        return Err(GitError::ReviewBusy);
    }
    let plan = discover(cwd)?
        .into_iter()
        .find(|plan| plan.kind == kind)
        .ok_or(GitError::ReviewCommand)?;
    let check = store::Check {
        kind,
        command: plan.command.to_owned(),
        status: store::Status::Running,
        revision: version.id,
        finished_revision: None,
        started_at: store::now(),
        finished_at: None,
        exit_code: None,
        output: String::new(),
    };
    store::save(storage, &check)?;
    let job = Job {
        cwd: cwd.to_owned(),
        root: root.to_owned(),
        storage: storage.to_owned(),
        receipt: check.clone(),
    };
    tauri::async_runtime::spawn(job.run(plan.runner));
    Ok(check)
}

struct Job {
    cwd: PathBuf,
    root: PathBuf,
    storage: PathBuf,
    receipt: store::Check,
}

impl Job {
    async fn run(self, runner: ProjectCommand) {
        let Self {
            cwd,
            root,
            storage,
            mut receipt,
        } = self;
        let result = project_check::run(&cwd, runner).await;
        match result {
            Ok(output) => {
                receipt.exit_code = output.exit_code;
                receipt.output = output.output;
                receipt.status = if output.exit_code == Some(0) {
                    store::Status::Passed
                } else {
                    store::Status::Failed
                };
            }
            Err(_) => {
                receipt.status = store::Status::Failed;
                receipt.output = "验证未完成，请检查电脑环境后重试。".into();
            }
        }
        let saved =
            tauri::async_runtime::spawn_blocking(move || finish(&root, &storage, receipt)).await;
        if !matches!(saved, Ok(Ok(()))) {
            eprintln!("Could not save a project check receipt");
        }
    }
}

fn finish(root: &Path, storage: &Path, mut check: store::Check) -> Result<()> {
    check.finished_at = Some(store::now());
    match revision::read(root) {
        Ok(version) => check.finished_revision = Some(version.id),
        Err(_) => {
            check.status = store::Status::Interrupted;
            check
                .output
                .push_str("\n无法核实验证后的代码版本，请重新验证。");
        }
    }
    store::save(storage, &check)
}
