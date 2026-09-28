use super::*;

#[test]
fn validates_tool_arguments_and_default_shell_timeout() {
    let request = tool_request(&json!({"name":"remote_execute", "arguments":{
        "deviceId":"df73d734-9cda-43ba-9e27-9d496af3fd05", "command":"whoami"
    }}))
    .unwrap();
    let ToolRequest::Execute { request } = request else {
        panic!("expected execute")
    };
    assert_eq!(request.command.timeout_seconds, 30);
    assert!(matches!(
        request.command.shell,
        super::super::protocol::Shell::Auto
    ));
    let round_trip = serde_json::to_value(ToolRequest::Execute { request }).unwrap();
    assert!(serde_json::from_value::<ToolRequest>(round_trip).is_ok());
    for arguments in [
        json!({"deviceId":"../bad", "command":"whoami"}),
        json!({"deviceId":"df73d734-9cda-43ba-9e27-9d496af3fd05", "command":""}),
        json!({"deviceId":"df73d734-9cda-43ba-9e27-9d496af3fd05", "command":"x", "timeoutSeconds":61}),
        json!({"deviceId":"df73d734-9cda-43ba-9e27-9d496af3fd05", "command":"x", "shell":"cmd"}),
        json!({"deviceId":"df73d734-9cda-43ba-9e27-9d496af3fd05", "command":"x", "extra":true}),
    ] {
        assert!(tool_request(&json!({"name":"remote_execute", "arguments":arguments})).is_err());
    }
    assert!(
        tool_request(&json!({"name":"remote_list_computers", "arguments":{"token":"x"}})).is_err()
    );
}

#[test]
fn command_errors_and_timeouts_are_mcp_errors() {
    assert_eq!(tool_result(Err(RemoteError::Disabled))["isError"], true);
    for data in [json!({"exitCode":1}), json!({"timedOut":true})] {
        assert_eq!(
            tool_result(Ok(json!({"result":{"data":data}})))["isError"],
            true
        );
    }
    assert_eq!(
        tool_result(Ok(json!({"result":{"error":"offline"}})))["isError"],
        true
    );
    assert_eq!(
        tool_result(Ok(json!({"result":{"data":{"exitCode":0}}})))["isError"],
        false
    );
    let tools: Value = serde_json::from_str(TOOLS).unwrap();
    assert_eq!(tools["tools"].as_array().unwrap().len(), 2);
}
