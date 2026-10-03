fn usage_field_missing(usage: &Value, flag: &str) -> bool {
    usage.get(flag).and_then(Value::as_bool) == Some(true)
}

fn token_usage_values_from_usage(usage: &Value) -> TokenUsageValues {
    let input_tokens = first_usage_number(usage, &[&["input_tokens"], &["prompt_tokens"]])
        .map(|input| input.saturating_add(anthropic_cached_input_tokens(usage)))
        .filter(|_| !usage_field_missing(usage, MISSING_INPUT_TOKENS_FLAG));
    let output_tokens = first_usage_number(usage, &[&["output_tokens"], &["completion_tokens"]])
        .filter(|_| !usage_field_missing(usage, MISSING_OUTPUT_TOKENS_FLAG));
    let reasoning_tokens = first_usage_number(
        usage,
        &[
            &["output_tokens_details", "reasoning_tokens"],
            &["completion_tokens_details", "reasoning_tokens"],
            &["reasoning_tokens"],
        ],
    );
    let cached_tokens = first_usage_number(
        usage,
        &[
            &["input_tokens_details", "cached_tokens"],
            &["prompt_tokens_details", "cached_tokens"],
            &["cache_read_input_tokens"],
            &["cached_tokens"],
            &["prompt_cache_hit_tokens"],
        ],
    );
    let total_tokens = first_usage_number(usage, &[&["total_tokens"]]).or_else(|| {
        input_tokens
            .zip(output_tokens)
            .map(|(input, output)| input + output)
    });

    TokenUsageValues {
        input_tokens,
        output_tokens,
        reasoning_tokens,
        cached_tokens,
        total_tokens,
    }
}

fn first_usage_number(usage: &Value, paths: &[&[&str]]) -> Option<u64> {
    paths
        .iter()
        .find_map(|path| usage_number_at_path(usage, path))
}

fn usage_number_at_path(value: &Value, path: &[&str]) -> Option<u64> {
    let mut current = value;
    for segment in path {
        current = current.get(*segment)?;
    }
    current
        .as_u64()
        .or_else(|| current.as_i64().and_then(|value| u64::try_from(value).ok()))
}

// Messages counts uncached input separately; the internal ledger always stores total input.
fn anthropic_cached_input_tokens(usage: &Value) -> u64 {
    if usage.get("cache_read_input_tokens").is_none() {
        return 0;
    }
    ["cache_read_input_tokens", "cache_creation_input_tokens"]
        .iter()
        .filter_map(|field| usage.get(*field).and_then(Value::as_u64))
        .fold(0, u64::saturating_add)
}
