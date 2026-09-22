export const markdown = '# 文件预览\n\n日期：2026-09-22。\n\n## 修改内容\n\n'
  + '- 支持 **Markdown 渲染**和 `行内代码`。\n- 支持复制完整原文。\n\n'
  + '| 方法与路径 | HTTP 状态 | 核对结果 |\n| --- | --- | --- |\n'
  + '| GET /wms/ctu-point/loading-points | 200 | 通过 |\n\n'
  + '> 手机和电脑都可以查看。\n\n```ts\nconst ready = true;\n```\n\n'
  + '[说明](https://example.com)\n\n<script>window.previewScriptRan = true</script>\n';

export const longMarkdown = markdown + '\n- 保留原始格式和完整内容。\n'.repeat(1000) + '\n最后一行\n';
