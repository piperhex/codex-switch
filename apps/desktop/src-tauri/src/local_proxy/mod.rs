pub(crate) mod auto_reset;
pub(crate) mod concurrent_quota;

include!("constants.rs");
include!("types.rs");
include!("state_core.rs");
include!("state_sessions.rs");
include!("conversation_attachments.rs");
include!("conversation_multipart.rs");
include!("conversation_response.rs");
include!("commands_status.rs");
include!("lifecycle.rs");
include!("settings.rs");
include!("auto_reset_commands.rs");
include!("system_prompt_filter.rs");
include!("system_prompt_injection.rs");
include!("server.rs");
include!("active_forwarding.rs");
include!("retry.rs");
include!("routing_auto.rs");
include!("routing_target.rs");
include!("image_account_pool.rs");
include!("capture.rs");
include!("usage_context.rs");
include!("diagnostics_helpers.rs");
include!("token_usage.rs");
include!("token_usage_db.rs");
include!("forwarding.rs");
include!("anthropic_bridge.rs");
include!("anthropic_forwarding.rs");
include!("anthropic_request.rs");
include!("models.rs");
include!("chat_bridge.rs");
include!("auth_http.rs");
include!("conversion.rs");
include!("tools.rs");
include!("streaming.rs");
include!("sse.rs");

#[cfg(test)]
mod tests {
    include!("tests/part_01.rs");
    include!("tests/part_02.rs");
    include!("tests/part_03.rs");
    include!("tests/part_04.rs");
    include!("tests/part_05.rs");
    include!("tests/part_06.rs");
    include!("tests/part_07.rs");
    include!("tests/part_08.rs");
    include!("tests/part_09.rs");
    include!("tests/conversation.rs");
    include!("tests/image_usage.rs");
}
