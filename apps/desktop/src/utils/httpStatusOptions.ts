import type { Language } from "../i18n";

interface HttpStatusDefinition {
  code: number;
  name: string;
  descriptionEn: string;
  descriptionZh: string;
}

const HTTP_STATUS_DEFINITIONS: HttpStatusDefinition[] = [
  { code: 100, name: "Continue", descriptionEn: "Continue sending the request body.", descriptionZh: "可以继续发送请求正文。" },
  { code: 101, name: "Switching Protocols", descriptionEn: "The server is switching protocols.", descriptionZh: "服务器正在切换通信协议。" },
  { code: 102, name: "Processing", descriptionEn: "The WebDAV request is still processing.", descriptionZh: "WebDAV 请求仍在处理中。" },
  { code: 103, name: "Early Hints", descriptionEn: "Preliminary headers sent before the final response.", descriptionZh: "最终响应前发送的预备响应头。" },
  { code: 200, name: "OK", descriptionEn: "The request completed successfully.", descriptionZh: "请求已成功完成。" },
  { code: 201, name: "Created", descriptionEn: "A new resource was created.", descriptionZh: "已成功创建新资源。" },
  { code: 202, name: "Accepted", descriptionEn: "The request was accepted for later processing.", descriptionZh: "请求已接受，将稍后处理。" },
  { code: 203, name: "Non-Authoritative Information", descriptionEn: "Returned metadata was modified by an intermediary.", descriptionZh: "返回的元数据被中间节点修改。" },
  { code: 204, name: "No Content", descriptionEn: "The request succeeded with no response body.", descriptionZh: "请求成功，但没有响应正文。" },
  { code: 205, name: "Reset Content", descriptionEn: "Reset the document view after success.", descriptionZh: "请求成功后应重置当前文档视图。" },
  { code: 206, name: "Partial Content", descriptionEn: "Only the requested byte range was returned.", descriptionZh: "仅返回请求指定的部分内容。" },
  { code: 207, name: "Multi-Status", descriptionEn: "A WebDAV response containing multiple results.", descriptionZh: "WebDAV 响应包含多个独立结果。" },
  { code: 208, name: "Already Reported", descriptionEn: "A WebDAV member was already reported.", descriptionZh: "WebDAV 成员已在前文报告。" },
  { code: 226, name: "IM Used", descriptionEn: "The response applies instance manipulations.", descriptionZh: "响应应用了实例增量处理。" },
  { code: 300, name: "Multiple Choices", descriptionEn: "Multiple representations or destinations are available.", descriptionZh: "存在多个可选表示或目标。" },
  { code: 301, name: "Moved Permanently", descriptionEn: "The resource moved to a permanent URL.", descriptionZh: "资源已永久移动到新地址。" },
  { code: 302, name: "Found", descriptionEn: "The resource is temporarily available elsewhere.", descriptionZh: "资源暂时位于其他地址。" },
  { code: 303, name: "See Other", descriptionEn: "Retrieve the result with a GET request elsewhere.", descriptionZh: "应通过 GET 请求访问其他地址获取结果。" },
  { code: 304, name: "Not Modified", descriptionEn: "The cached representation is still valid.", descriptionZh: "缓存的资源版本仍然有效。" },
  { code: 305, name: "Use Proxy", descriptionEn: "Deprecated response requiring a proxy.", descriptionZh: "已弃用，表示需要通过代理访问。" },
  { code: 306, name: "Unused", descriptionEn: "Reserved and no longer used.", descriptionZh: "保留状态码，当前不再使用。" },
  { code: 307, name: "Temporary Redirect", descriptionEn: "Temporary redirect that preserves the request method.", descriptionZh: "临时重定向，并保留原请求方法。" },
  { code: 308, name: "Permanent Redirect", descriptionEn: "Permanent redirect that preserves the request method.", descriptionZh: "永久重定向，并保留原请求方法。" },
  { code: 400, name: "Bad Request", descriptionEn: "The request syntax or parameters are invalid.", descriptionZh: "请求语法或参数无效。" },
  { code: 401, name: "Unauthorized", descriptionEn: "Authentication is missing, expired, or invalid.", descriptionZh: "身份凭证缺失、过期或无效。" },
  { code: 402, name: "Payment Required", descriptionEn: "Payment, subscription, or quota access is required.", descriptionZh: "需要付款、订阅或额度权限。" },
  { code: 403, name: "Forbidden", descriptionEn: "The server refuses to authorize the request.", descriptionZh: "服务器拒绝授权当前请求。" },
  { code: 404, name: "Not Found", descriptionEn: "The requested resource was not found.", descriptionZh: "未找到请求的资源。" },
  { code: 405, name: "Method Not Allowed", descriptionEn: "The resource does not support this HTTP method.", descriptionZh: "资源不支持当前 HTTP 方法。" },
  { code: 406, name: "Not Acceptable", descriptionEn: "No acceptable response representation is available.", descriptionZh: "无法提供客户端可接受的响应格式。" },
  { code: 407, name: "Proxy Authentication Required", descriptionEn: "The proxy requires authentication.", descriptionZh: "代理服务器要求身份验证。" },
  { code: 408, name: "Request Timeout", descriptionEn: "The server timed out waiting for the request.", descriptionZh: "服务器等待请求时超时。" },
  { code: 409, name: "Conflict", descriptionEn: "The request conflicts with the current resource state.", descriptionZh: "请求与资源当前状态冲突。" },
  { code: 410, name: "Gone", descriptionEn: "The resource was permanently removed.", descriptionZh: "资源已被永久移除。" },
  { code: 411, name: "Length Required", descriptionEn: "A Content-Length header is required.", descriptionZh: "请求必须提供 Content-Length。" },
  { code: 412, name: "Precondition Failed", descriptionEn: "A request precondition evaluated to false.", descriptionZh: "请求的前置条件未满足。" },
  { code: 413, name: "Content Too Large", descriptionEn: "The request body exceeds the server limit.", descriptionZh: "请求正文超过服务器限制。" },
  { code: 414, name: "URI Too Long", descriptionEn: "The request URI exceeds the server limit.", descriptionZh: "请求 URI 超过服务器限制。" },
  { code: 415, name: "Unsupported Media Type", descriptionEn: "The request media type is not supported.", descriptionZh: "服务器不支持请求的媒体类型。" },
  { code: 416, name: "Range Not Satisfiable", descriptionEn: "The requested content range cannot be served.", descriptionZh: "无法满足请求指定的内容范围。" },
  { code: 417, name: "Expectation Failed", descriptionEn: "The server cannot meet the Expect header.", descriptionZh: "服务器无法满足 Expect 请求头。" },
  { code: 418, name: "I'm a Teapot", descriptionEn: "Reserved teapot response from the HTTP specification.", descriptionZh: "HTTP 规范保留的“茶壶”响应。" },
  { code: 421, name: "Misdirected Request", descriptionEn: "The request was sent to the wrong server.", descriptionZh: "请求被发送到了错误的服务器。" },
  { code: 422, name: "Unprocessable Content", descriptionEn: "The syntax is valid but the content cannot be processed.", descriptionZh: "语法有效，但请求内容无法处理。" },
  { code: 423, name: "Locked", descriptionEn: "The WebDAV resource is locked.", descriptionZh: "WebDAV 资源当前已锁定。" },
  { code: 424, name: "Failed Dependency", descriptionEn: "A dependent WebDAV operation failed.", descriptionZh: "依赖的 WebDAV 操作失败。" },
  { code: 425, name: "Too Early", descriptionEn: "The server rejects a potentially replayed request.", descriptionZh: "服务器拒绝可能被重放的过早请求。" },
  { code: 426, name: "Upgrade Required", descriptionEn: "The client must switch to another protocol.", descriptionZh: "客户端必须升级或切换协议。" },
  { code: 428, name: "Precondition Required", descriptionEn: "The server requires a conditional request.", descriptionZh: "服务器要求使用条件请求。" },
  { code: 429, name: "Too Many Requests", descriptionEn: "The client exceeded a rate limit.", descriptionZh: "客户端触发了请求频率限制。" },
  { code: 431, name: "Request Header Fields Too Large", descriptionEn: "The request headers are too large.", descriptionZh: "请求头字段过大。" },
  { code: 451, name: "Unavailable For Legal Reasons", descriptionEn: "Legal restrictions block the resource.", descriptionZh: "资源因法律限制而不可用。" },
  { code: 500, name: "Internal Server Error", descriptionEn: "The server encountered an unexpected failure.", descriptionZh: "服务器发生未预期的内部错误。" },
  { code: 501, name: "Not Implemented", descriptionEn: "The server does not implement this capability.", descriptionZh: "服务器未实现请求所需能力。" },
  { code: 502, name: "Bad Gateway", descriptionEn: "A gateway received an invalid upstream response.", descriptionZh: "网关收到无效的上游响应。" },
  { code: 503, name: "Service Unavailable", descriptionEn: "The service is temporarily unavailable.", descriptionZh: "服务当前暂时不可用。" },
  { code: 504, name: "Gateway Timeout", descriptionEn: "A gateway timed out waiting for upstream.", descriptionZh: "网关等待上游响应时超时。" },
  { code: 505, name: "HTTP Version Not Supported", descriptionEn: "The HTTP version is not supported.", descriptionZh: "服务器不支持当前 HTTP 版本。" },
  { code: 506, name: "Variant Also Negotiates", descriptionEn: "Content negotiation has a circular configuration.", descriptionZh: "内容协商配置形成循环。" },
  { code: 507, name: "Insufficient Storage", descriptionEn: "The WebDAV server lacks storage space.", descriptionZh: "WebDAV 服务器存储空间不足。" },
  { code: 508, name: "Loop Detected", descriptionEn: "The WebDAV server detected an operation loop.", descriptionZh: "WebDAV 服务器检测到操作循环。" },
  { code: 510, name: "Not Extended", descriptionEn: "Further request extensions are required.", descriptionZh: "请求需要进一步扩展才能完成。" },
  { code: 511, name: "Network Authentication Required", descriptionEn: "The network requires authentication before access.", descriptionZh: "访问网络前需要完成网络身份验证。" },
];

export interface HttpStatusOption {
  value: number;
  label: string;
  description: string;
  searchText: string;
}

export function httpStatusOptions(language: Language): HttpStatusOption[] {
  return HTTP_STATUS_DEFINITIONS.map((status) => {
    const description = language === "zh" ? status.descriptionZh : status.descriptionEn;
    const label = `${status.code} ${status.name}`;
    return {
      value: status.code,
      label,
      description,
      searchText: `${label} ${description}`.toLowerCase(),
    };
  });
}
