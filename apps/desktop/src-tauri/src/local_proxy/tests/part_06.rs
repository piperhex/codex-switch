    #[test]
    fn responses_chat_bridge_roundtrips_tool_search_and_namespace_tools() {
        let body = json!({
            "model": "deepseek-chat",
            "input": "open the site",
            "tools": [
                { "type": "tool_search" },
                {
                    "type": "namespace",
                    "name": "chrome",
                    "tools": [{
                        "type": "function",
                        "name": "open_url",
                        "description": "Open a URL",
                        "parameters": {
                            "type": "object",
                            "properties": { "url": { "type": "string" } },
                            "required": ["url"]
                        }
                    }]
                }
            ],
            "tool_choice": { "type": "tool_search" }
        });
        let context = build_codex_tool_context_from_request(&body);
        let chat = responses_to_chat_completions_with_context(&body, &context, None);
        let tools = chat["tools"].as_array().unwrap();

        assert!(tools
            .iter()
            .any(|tool| tool.pointer("/function/name") == Some(&json!("tool_search"))));
        assert!(tools
            .iter()
            .any(|tool| tool.pointer("/function/name") == Some(&json!("chrome__open_url"))));
        assert_eq!(chat["tool_choice"]["function"]["name"], "tool_search");

        let response = chat_to_responses_json(
            &json!({
                "id": "chatcmpl_tools",
                "model": "deepseek-chat",
                "choices": [{
                    "message": {
                        "role": "assistant",
                        "tool_calls": [
                            {
                                "id": "call_search",
                                "type": "function",
                                "function": {
                                    "name": "tool_search",
                                    "arguments": "{\"query\":\"chrome\"}"
                                }
                            },
                            {
                                "id": "call_chrome",
                                "type": "function",
                                "function": {
                                    "name": "chrome__open_url",
                                    "arguments": "{\"url\":\"https://example.com\"}"
                                }
                            }
                        ]
                    },
                    "finish_reason": "tool_calls"
                }]
            }),
            &context,
            None,
        );

        assert_eq!(response["output"][0]["type"], "tool_search_call");
        assert_eq!(response["output"][0]["arguments"]["query"], "chrome");
        assert_eq!(response["output"][1]["type"], "function_call");
        assert_eq!(response["output"][1]["namespace"], "chrome");
        assert_eq!(response["output"][1]["name"], "open_url");
    }

    #[test]
    fn responses_chat_bridge_preserves_service_tier() {
        let body = json!({
            "model": "gpt-5.6-sol",
            "input": "ping",
            "service_tier": "priority"
        });

        let chat = responses_to_chat_completions(&body);

        assert_eq!(chat["service_tier"], "priority");
    }

    #[test]
    fn buffered_kimi_tool_call_restores_reasoning_content() {
        let session = uuid::Uuid::new_v4().to_string();
        let scope = chat_bridge_continuation::ContinuationScope::new("kimi", &session);
        let context = CodexToolContext::default();
        let response = chat_to_responses_json(
            &json!({
                "id": "chatcmpl-kimi",
                "model": "kimi-k3",
                "choices": [{ "message": {
                    "role": "assistant",
                    "content": null,
                    "reasoning_content": "private Kimi continuation",
                    "tool_calls": [{
                        "id": "call-kimi",
                        "type": "function",
                        "function": { "name": "run", "arguments": "{}" }
                    }]
                }}]
            }),
            &context,
            Some(&scope),
        );
        let mut input = response["output"].as_array().unwrap().clone();
        input.push(json!({
            "type": "function_call_output",
            "call_id": "call-kimi",
            "output": "ok"
        }));
        let body = json!({ "model": "kimi-k3", "input": input });

        let chat = responses_to_chat_completions_with_context(&body, &context, Some(&scope));

        assert_eq!(
            chat["messages"][0]["reasoning_content"],
            "private Kimi continuation"
        );
        assert_eq!(chat["messages"][0]["tool_calls"][0]["id"], "call-kimi");
        assert_eq!(chat["messages"][1]["tool_call_id"], "call-kimi");
    }

    #[test]
    fn buffered_gemini_parallel_calls_restore_only_their_own_signatures() {
        let session = uuid::Uuid::new_v4().to_string();
        let scope = chat_bridge_continuation::ContinuationScope::new("gemini", &session);
        let context = CodexToolContext::default();
        let response = chat_to_responses_json(
            &json!({
                "id": "chatcmpl-gemini",
                "model": "gemini-3.7-flash",
                "choices": [{ "message": {
                    "role": "assistant",
                    "tool_calls": [
                        {
                            "id": "call-paris",
                            "type": "function",
                            "extra_content": {
                                "google": { "thought_signature": "signature-paris" }
                            },
                            "function": { "name": "weather", "arguments": "{}" }
                        },
                        {
                            "id": "call-london",
                            "type": "function",
                            "function": { "name": "weather", "arguments": "{}" }
                        }
                    ]
                }}]
            }),
            &context,
            Some(&scope),
        );
        let body = json!({ "model": "gemini-3.7-flash", "input": response["output"] });

        let chat = responses_to_chat_completions_with_context(&body, &context, Some(&scope));

        let calls = chat["messages"][0]["tool_calls"].as_array().unwrap();
        assert_eq!(
            calls[0]["extra_content"]["google"]["thought_signature"],
            "signature-paris"
        );
        assert!(calls[1].get("extra_content").is_none());
    }

    #[test]
    fn streaming_kimi_tool_call_restores_reasoning_content() {
        let session = uuid::Uuid::new_v4().to_string();
        let scope = chat_bridge_continuation::ContinuationScope::new("kimi", &session);
        let sse = concat!(
            "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"private stream\"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[",
            "{\"index\":0,\"id\":\"call-stream\",",
            "\"function\":{\"name\":\"run\",\"arguments\":\"{}\"}}]}}]}\n\n",
            "data: [DONE]\n\n"
        );
        let mut reader = ChatSseReader::new(
            BufReader::new(Cursor::new(sse.as_bytes().to_vec())),
            "kimi-k3".to_string(),
            CodexToolContext::default(),
            Some(scope.clone()),
        );
        let mut output = String::new();
        reader.read_to_string(&mut output).unwrap();
        let completed = sse_event(&output, "response.completed");
        let body = json!({
            "model": "kimi-k3",
            "input": completed["response"]["output"]
        });

        let chat = responses_to_chat_completions_with_context(
            &body,
            &CodexToolContext::default(),
            Some(&scope),
        );

        assert_eq!(chat["messages"][0]["reasoning_content"], "private stream");
        assert_eq!(chat["messages"][0]["tool_calls"][0]["id"], "call-stream");
    }

    #[test]
    fn streaming_gemini_parallel_calls_restore_thought_signature() {
        let session = uuid::Uuid::new_v4().to_string();
        let scope = chat_bridge_continuation::ContinuationScope::new("gemini", &session);
        let sse = concat!(
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[",
            "{\"index\":0,\"id\":\"call-a\",\"extra_content\":{\"google\":",
            "{\"thought_signature\":\"signature-a\"}},",
            "\"function\":{\"name\":\"weather\",\"arguments\":\"{}\"}},",
            "{\"index\":1,\"id\":\"call-b\",\"function\":{\"name\":\"weather\",\"arguments\":\"{}\"}}]}}]}\n\n",
            "data: [DONE]\n\n"
        );
        let mut reader = ChatSseReader::new(
            BufReader::new(Cursor::new(sse.as_bytes().to_vec())),
            "gemini-3.7-flash".to_string(),
            CodexToolContext::default(),
            Some(scope.clone()),
        );
        let mut output = String::new();
        reader.read_to_string(&mut output).unwrap();
        let completed = sse_event(&output, "response.completed");
        let body = json!({
            "model": "gemini-3.7-flash",
            "input": completed["response"]["output"]
        });

        let chat = responses_to_chat_completions_with_context(
            &body,
            &CodexToolContext::default(),
            Some(&scope),
        );

        let calls = chat["messages"][0]["tool_calls"].as_array().unwrap();
        assert_eq!(
            calls[0]["extra_content"]["google"]["thought_signature"],
            "signature-a"
        );
        assert!(calls[1].get("extra_content").is_none());
    }

    #[test]
    fn chat_sse_reader_restores_streaming_custom_tool_calls() {
        let body = json!({
            "model": "deepseek-chat",
            "tools": [{
                "type": "custom",
                "name": "apply_patch",
                "format": { "type": "grammar", "syntax": "lark", "definition": "start: /.+/" }
            }]
        });
        let context = build_codex_tool_context_from_request(&body);
        let sse = concat!(
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_patch\",\"type\":\"function\",\"function\":{\"name\":\"apply_patch\",\"arguments\":\"{\\\"input\\\":\\\"*** Begin\"}}]}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\" Patch\\\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n",
            "data: [DONE]\n\n"
        );
        let mut reader = ChatSseReader::new(
            BufReader::new(Cursor::new(sse.as_bytes().to_vec())),
            "deepseek-chat".to_string(),
            context,
            None,
        );
        let mut output = String::new();
        reader.read_to_string(&mut output).unwrap();

        assert!(output.contains("response.custom_tool_call_input.done"));
        assert!(output.contains("\"type\":\"custom_tool_call\""));
        assert!(output.contains("*** Begin Patch"));
    }

    #[test]
    fn chat_sse_reader_emits_incremental_response_events() {
        let sse = concat!(
            "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"thinking\"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\" done\"}}]}\n\n",
            "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":12,\"completion_tokens\":4,\"total_tokens\":16,\"prompt_cache_hit_tokens\":7,\"completion_tokens_details\":{\"reasoning_tokens\":3}}}\n\n",
            "data: [DONE]\n\n"
        );
        let mut reader = ChatSseReader::new(
            BufReader::new(Cursor::new(sse.as_bytes().to_vec())),
            "deepseek-chat".to_string(),
            CodexToolContext::default(),
            None,
        );
        let mut output = String::new();
        reader.read_to_string(&mut output).unwrap();

        assert!(output.contains("response.created"));
        assert!(output.contains("response.output_text.delta"));
        assert!(output.contains(" done"));
        assert_eq!(
            sse_event(&output, "response.reasoning_summary_text.delta")["delta"],
            "thinking"
        );
        assert_eq!(
            sse_event(&output, "response.output_text.delta")["delta"],
            " done"
        );
        assert!(output.contains("response.completed"));
        assert!(output.ends_with("data: [DONE]\n\n"));
        let completed = sse_event(&output, "response.completed");
        assert_eq!(
            completed["response"]["usage"],
            json!({
                "input_tokens": 12,
                "input_tokens_details": { "cached_tokens": 7 },
                "output_tokens": 4,
                "output_tokens_details": { "reasoning_tokens": 3 },
                "total_tokens": 16
            })
        );
    }

    #[test]
    fn buffered_chat_sse_conversion_keeps_reasoning_content() {
        let output = chat_sse_to_responses_sse(
            "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"why\"}}]}\n\n",
            "deepseek-chat",
        );

        assert_eq!(
            sse_event(&output, "response.reasoning_summary_text.delta")["delta"],
            "why"
        );
        assert!(!sse_event(&output, "response.completed")["response"]["output"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|item| item.get("content"))
            .any(|content| content.to_string().contains("why")));
        assert!(output.contains("response.completed"));
    }

    #[test]
    fn chat_bridge_ignores_local_reasoning_items_when_building_chat_history() {
        let body = json!({
            "model": "deepseek-chat",
            "input": [
                {
                    "type": "reasoning",
                    "id": "rs_resp_1787577994",
                    "summary": [{ "type": "summary_text", "text": "private thought" }]
                },
                {
                    "type": "message",
                    "role": "assistant",
                    "content": [{ "type": "output_text", "text": "The weather is sunny." }]
                }
            ]
        });
        let chat = responses_to_chat_completions(&body);

        assert_eq!(chat["messages"].as_array().unwrap().len(), 1);
        assert_eq!(chat["messages"][0]["content"], "The weather is sunny.");
    }

    #[test]
    fn chat_bridge_honors_codex_selected_provider_model() {
        let provider = ProviderProfile {
            id: "deepseek".to_string(),
            kind: ProviderKind::Custom,
            name: "DeepSeek".to_string(),
            group: String::new(),
            base_url: "https://api.deepseek.com/v1".to_string(),
            api_key: "sk-provider-test".to_string(),
            model: "deepseek-chat".to_string(),
            models: vec!["deepseek-chat".to_string(), "deepseek-reasoner".to_string()],
            model_reasoning_efforts: Default::default(),
            model_context_windows: Default::default(),
            model_api_formats: Default::default(),
            image_input_models: Vec::new(),
            image_input_models_configured: false,
            context_window: None,
            model_selection_controlled_by_codex: true,
            fast_mode_enabled: false,
            api_format: ProviderApiFormat::OpenaiChat,
            balance_platform: None,
            balance_query_url: None,
            balance_query_token: None,
            wallet_query_url: None,
            wallet_query_token: None,
            wallet_username: None,
            wallet_password: None,
        };
        let body = json!({ "model": "deepseek-reasoner", "input": "ping" });

        assert_eq!(
            selected_provider_model(&body, &provider),
            "deepseek-reasoner"
        );
    }
