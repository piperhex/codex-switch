# 三方模型推理强度默认值

核对日期：2026-09-08。规则保存在 `apps/desktop/src/modelReasoningDefaults.json`，由前端和 Rust 共用。
仅在缺少设置时填充默认值；已保存的用户选择不与默认值合并，也不按默认能力表过滤。
刷新期间用户暂时清空的选择也会保留，保存时仍需至少选择一个档位。

下表列出有实际区别的模式，不重复列出映射到同一模式的兼容别名。
`none` 表示关闭思考；仅支持思考开关或始终思考的模型，用应用现有的 `high` 表示开启思考，
不表示原厂一定接受字面上的 `reasoning_effort=high`。实际请求参数由所选 Provider 的接口决定。

| 模型 | 自动分配的选项 | 依据 |
| --- | --- | --- |
| deepseek-v4-flash-0731、deepseek-v4-pro-0813 | none、low、high、max | [DeepSeek 思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)；medium、xhigh 均映射到 high。 |
| glm-5、glm-5.1 | none、high | [智谱深度思考](https://docs.bigmodel.cn/cn/guide/capabilities/thinking)；原生接口的强度调节从 GLM-5.2 开始。 |
| glm-5.2 | none、high、max | [智谱深度思考](https://docs.bigmodel.cn/cn/guide/capabilities/thinking)；low/medium 映射到 high，xhigh 映射到 max。 |
| glm-5.3、glm-5.3-flash | low、high、max | [GLM-5.3 模型卡](https://huggingface.co/zai-org/GLM-5.3)、[Flash 模型卡](https://huggingface.co/zai-org/GLM-5.3-Flash)；[百炼接口](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)明确不允许关闭思考。 |
| kimi-k2.5、kimi-k2.6 | none、high | [K2.5 模型卡](https://huggingface.co/moonshotai/Kimi-K2.5)、[K2.6 模型卡](https://huggingface.co/moonshotai/Kimi-K2.6)；支持 Thinking/Instant 模式。 |
| kimi-k2.7-code | high | [K2.7 Code 模型卡](https://huggingface.co/moonshotai/Kimi-K2.7-Code)；始终开启思考。 |
| longcat-2.0 | none、high | [LongCat 接口](https://longcat.ai/platform/docs/zh/api/chat)；thinking.type 为 enabled/disabled。 |
| mimo-v2.5-pro | none、high | [MiMo 接口](https://mimo.mi.com/docs/en-US/api/chat/anthropic-api)；thinking.type 为 enabled/disabled。 |
| minimax-m2.5、minimax-m2.7 | high | [MiniMax 接口](https://platform.minimax.io/docs/api-reference/text-anthropic-api)；M2.x 无法关闭思考，没有公布独立强度档位。 |
| qwen3.7-flash、qwen3.7-max | none、high | [百炼深度思考](https://help.aliyun.com/zh/model-studio/deep-thinking)；支持混合思考，可另外用 thinking_budget 控制长度。 |
| qwen3.8-27b、qwen3.8-flash、qwen3.8-max | none、low、medium、xhigh | [百炼接口](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)、[27B 模型卡](https://huggingface.co/Qwen/Qwen3.8-27B)；high/max 映射到 xhigh，minimal 映射到 low。 |
| seed-2.1-pro、seed-2.1-turbo | none、low、medium、high | [火山方舟深度思考](https://www.volcengine.com/docs/82379/1449737)；none/minimal 关闭思考，xhigh/max 映射到 high。 |

## Provider 差异与匹配范围

GLM-5/5.1 使用智谱原生能力作为通用默认值。[百炼托管接口](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)
为这两个型号额外提供 high/max，使用该接口时可以手动添加 max，后续刷新会保留。
模型发现接口目前只读取模型 ID，不能从 ID 判断转发商是否增加、限制或重映射了推理参数。

匹配忽略大小写和首尾空格，支持 `厂商/模型名`；不对未核实的版本号猜测能力。
未知型号沿用原有默认规则。已保存的旧配置无法可靠区分“旧默认值”和“用户手动值”，因此一律保留。
模型目录的默认选中档位必须属于可选列表：优先 high，否则使用列表最后一项。
