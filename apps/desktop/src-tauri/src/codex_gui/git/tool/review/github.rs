use super::{revision, GitError, Result};
use crate::codex_gui::{git, platform};
use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::Path, time::Duration};

const FIELDS: &str = "number,title,url,headRefOid,state,statusCheckRollup";
const TIMEOUT: Duration = Duration::from_secs(20);
const MAX_TITLE_CHARS: usize = 200;
const MAX_BODY_CHARS: usize = 16_000;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PullRequest {
    number: u64,
    title: String,
    url: String,
    head_ref_oid: String,
    state: String,
    status_check_rollup: Option<Vec<Check>>,
}

#[derive(Deserialize, Serialize)]
pub(crate) struct Check {
    name: Option<String>,
    context: Option<String>,
    status: Option<String>,
    conclusion: Option<String>,
    state: Option<String>,
}

fn gh(root: &Path, args: &[&str]) -> Result<Vec<u8>> {
    tauri::async_runtime::block_on(async {
        let mut command = tokio::process::Command::new("gh");
        command
            .current_dir(root)
            .args(args)
            .kill_on_drop(true)
            .env("GH_PROMPT_DISABLED", "1")
            .env("GH_NO_UPDATE_NOTIFIER", "1")
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(std::process::Stdio::null());
        platform::hide_window(&mut command);
        let result = tokio::time::timeout(TIMEOUT, command.output())
            .await
            .map_err(|_| GitError::ReviewGithub)?
            .map_err(|_| GitError::ReviewGithub)?;
        if !result.status.success() || result.stdout.len() > 1024 * 1024 {
            return Err(GitError::ReviewGithub);
        }
        Ok(result.stdout)
    })
}

pub(super) fn read(root: &Path) -> Result<Option<PullRequest>> {
    let branch = git::output(root, &["symbolic-ref", "--short", "HEAD"])?;
    let bytes = gh(
        root,
        &[
            "pr", "list", "--head", &branch, "--state", "open", "--limit", "1", "--json", FIELDS,
        ],
    )?;
    let mut result: Vec<PullRequest> =
        serde_json::from_slice(&bytes).map_err(|_| GitError::ReviewGithub)?;
    Ok(result.pop())
}

pub(super) struct Create {
    pub revision: String,
    pub title: String,
    pub body: String,
    pub base: String,
}

pub(super) fn create(root: &Path, input: Create) -> Result<Option<PullRequest>> {
    let version = validate(root, &input)?;
    if let Some(existing) = read(root)? {
        return Ok(Some(existing));
    }
    verify_pushed(root, &version)?;
    if revision::read(root)?.id != input.revision {
        return Err(GitError::ReviewChanged);
    }
    let branch = version.branch.ok_or(GitError::Branch)?;
    publish(root, &branch, &input)?;
    read(root)
}

fn validate(root: &Path, input: &Create) -> Result<revision::Revision> {
    let version = revision::read(root)?;
    if version.id != input.revision {
        return Err(GitError::ReviewChanged);
    }
    if version.dirty {
        return Err(GitError::ReviewDirty);
    }
    if version.branch.is_none() {
        return Err(GitError::Branch);
    }
    if input.title.trim().is_empty()
        || input.title.chars().count() > MAX_TITLE_CHARS
        || input.body.chars().count() > MAX_BODY_CHARS
    {
        return Err(GitError::ReviewPrInput);
    }
    if !input.base.is_empty() {
        git::validate_branch(root, &input.base)?;
    }
    Ok(version)
}

fn verify_pushed(root: &Path, version: &revision::Revision) -> Result<()> {
    let branch = version.branch.as_deref().ok_or(GitError::Branch)?;
    let encoded = url::form_urlencoded::byte_serialize(branch.as_bytes()).collect::<String>();
    let endpoint = format!("repos/{{owner}}/{{repo}}/commits/{encoded}");
    let remote = gh(root, &["api", &endpoint, "--jq", ".sha"])?;
    validate_remote_head(&remote, version.head.as_deref())
}

fn validate_remote_head(remote: &[u8], expected: Option<&str>) -> Result<()> {
    if expected.is_none() || std::str::from_utf8(remote).map(str::trim).ok() != expected {
        return Err(GitError::ReviewDirty);
    }
    Ok(())
}

fn publish(root: &Path, branch: &str, input: &Create) -> Result<()> {
    let path = std::env::temp_dir().join(format!("remote-ai-pr-{}.txt", uuid::Uuid::new_v4()));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|_| GitError::ReviewStorage)?;
    let written = file.write_all(input.body.as_bytes());
    drop(file);
    let result = written
        .map_err(|_| GitError::ReviewStorage)
        .and_then(|()| publish_with_body(root, branch, input, &path));
    if fs::remove_file(path).is_err() {
        eprintln!("Could not remove a pull request description file");
    }
    result
}

fn publish_with_body(root: &Path, branch: &str, input: &Create, path: &Path) -> Result<()> {
    // --head prevents gh from pushing or forking implicitly. The user pushes from the existing Git tool first.
    let body_file = platform::execution_path(path);
    let mut args = vec![
        "pr",
        "create",
        "--draft",
        "--head",
        branch,
        "--title",
        input.title.trim(),
        "--body-file",
        &body_file,
    ];
    if !input.base.is_empty() {
        args.extend(["--base", &input.base]);
    }
    gh(root, &args)
        .map(|_| ())
        .map_err(|_| GitError::ReviewPrUnknown)
}

#[cfg(test)]
mod tests {
    use super::super::super::tests::Repo;
    use super::*;

    #[test]
    fn rejects_stale_dirty_or_invalid_drafts_before_contacting_github() {
        let repo = Repo::new(true);
        let mut input = Create {
            revision: "old".into(),
            title: "Fix".into(),
            body: String::new(),
            base: String::new(),
        };
        assert!(matches!(
            create(&repo.0, input_copy(&input)),
            Err(GitError::ReviewChanged)
        ));
        repo.write("one.txt", "updated");
        input.revision = revision::read(&repo.0).unwrap().id;
        assert!(matches!(
            create(&repo.0, input_copy(&input)),
            Err(GitError::ReviewDirty)
        ));
        repo.git(&["checkout", "--", "one.txt"]);
        input.revision = revision::read(&repo.0).unwrap().id;
        input.title = "修".repeat(MAX_TITLE_CHARS);
        assert!(validate(&repo.0, &input).is_ok());
        input.title.push('复');
        assert!(matches!(
            validate(&repo.0, &input),
            Err(GitError::ReviewPrInput)
        ));
        input.title.clear();
        assert!(matches!(
            create(&repo.0, input),
            Err(GitError::ReviewPrInput)
        ));
    }

    fn input_copy(input: &Create) -> Create {
        Create {
            revision: input.revision.clone(),
            title: input.title.clone(),
            body: input.body.clone(),
            base: input.base.clone(),
        }
    }

    #[test]
    fn published_branch_must_match_the_reviewed_commit() {
        assert!(validate_remote_head(b"reviewed\n", Some("reviewed")).is_ok());
        assert!(matches!(
            validate_remote_head(b"old\n", Some("reviewed")),
            Err(GitError::ReviewDirty)
        ));
        assert!(validate_remote_head(b"", None).is_err());
    }
}
