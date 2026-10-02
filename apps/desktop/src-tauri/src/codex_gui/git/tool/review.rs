//! Project checks are explicit user actions; their receipts are bound to content, never assistant claims.
use super::super::{directory, repository, GitError, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

mod checks;
mod github;
mod revision;
mod store;
#[cfg(test)]
mod tests;

#[derive(Deserialize)]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum Action {
    Snapshot,
    Run {
        check: checks::Kind,
        revision: String,
    },
    PullRequest,
    CreatePullRequest {
        revision: String,
        title: String,
        body: String,
        base: String,
    },
}

#[derive(Serialize)]
#[serde(untagged)]
pub(crate) enum Response {
    Snapshot(Snapshot),
    Check(store::Check),
    PullRequest(Option<github::PullRequest>),
}

#[derive(Serialize)]
pub(crate) struct Snapshot {
    revision: revision::Revision,
    commands: Vec<checks::Plan>,
    checks: Vec<store::Check>,
}

pub(super) fn execute(cwd: &str, data: &Path, request: Action) -> Result<Response> {
    let cwd = directory(cwd)?;
    let root = repository(&cwd)?;
    let storage = store::location(data, &cwd)?;
    match request {
        Action::Snapshot => Ok(Response::Snapshot(Snapshot {
            revision: revision::read(&root)?,
            commands: checks::discover(&cwd)?,
            checks: store::read(&storage)?,
        })),
        Action::Run { check, revision } => checks::start(
            &cwd,
            &root,
            &storage,
            checks::Start {
                kind: check,
                expected: &revision,
            },
        )
        .map(Response::Check),
        Action::PullRequest => github::read(&root).map(Response::PullRequest),
        Action::CreatePullRequest {
            revision,
            title,
            body,
            base,
        } => github::create(
            &root,
            github::Create {
                revision,
                title,
                body,
                base,
            },
        )
        .map(Response::PullRequest),
    }
}
