use super::super::protocol::Shell;
use super::*;

fn request(windows: &str, unix: &str) -> CommandRequest {
    CommandRequest {
        command: if cfg!(windows) { windows } else { unix }.into(),
        cwd: None,
        shell: Shell::Auto,
        timeout_seconds: 10,
    }
}

#[tokio::test]
async fn captures_unicode_both_streams_and_nonzero_exit() {
    let request = request(
        "Write-Output '诊断成功'; [Console]::Error.WriteLine('error'); exit 7",
        "printf '诊断成功\\n'; printf 'error\\n' >&2; exit 7",
    );
    let result = execute(request, || true).await.unwrap();
    assert!(result.stdout.contains("诊断成功"));
    assert!(result.stderr.contains("error"));
    assert_eq!(result.exit_code, Some(7));
    assert!(!result.timed_out);
}

#[tokio::test]
async fn output_is_bounded_without_deadlocking_the_child() {
    let request = request("[Console]::Write('x' * 200000)", "head -c 200000 /dev/zero");
    let result = execute(request, || true).await.unwrap();
    assert_eq!(result.stdout.len(), MAX_OUTPUT_BYTES);
    assert!(result.truncated);
    assert_eq!(result.exit_code, Some(0));
}

#[tokio::test]
async fn timeout_and_revocation_stop_execution() {
    let mut timed = request(
        "Write-Output 'started'; Start-Sleep -Seconds 20",
        "echo started; sleep 20",
    );
    timed.timeout_seconds = 1;
    let result = execute(timed, || true).await.unwrap();
    assert!(result.timed_out);
    assert!(result.stdout.contains("started"));
    assert!(result.duration_ms < 8000);
    let began = Instant::now();
    let result = execute(request("Start-Sleep -Seconds 20", "sleep 20"), || {
        began.elapsed() < Duration::from_millis(500)
    })
    .await;
    assert!(matches!(result, Err(RemoteError::Cancelled)));
    assert!(began.elapsed() < Duration::from_secs(8));
}

#[tokio::test]
async fn rejects_relative_working_directory_and_missing_authorization() {
    let mut invalid = request("Get-Location", "pwd");
    invalid.cwd = Some("relative".into());
    assert!(matches!(
        execute(invalid, || true).await,
        Err(RemoteError::InvalidRequest)
    ));
    assert!(matches!(
        execute(request("whoami", "whoami"), || false).await,
        Err(RemoteError::Cancelled)
    ));
}

#[cfg(windows)]
#[tokio::test]
async fn timeout_also_terminates_shell_descendants() {
    let mut request = request(
        "$p = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') \
         -ArgumentList '-NoProfile -NonInteractive -Command Start-Sleep -Seconds 30' \
         -WindowStyle Hidden -PassThru; Write-Output $p.Id; Start-Sleep -Seconds 30",
        "",
    );
    // Cold PowerShell startup can exceed two seconds on a busy Windows CI runner.
    request.timeout_seconds = 10;
    let result = execute(request, || true).await.unwrap();
    assert!(result.timed_out);
    let pid = sysinfo::Pid::from_u32(
        result
            .stdout
            .trim()
            .parse::<u32>()
            .expect("child process must report its PID before the command times out"),
    );
    let mut system = sysinfo::System::new();
    system.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);
    assert!(
        system.process(pid).is_none(),
        "descendant outlived its remote command"
    );
}
