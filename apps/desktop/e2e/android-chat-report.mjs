import path from 'node:path';

const labels = [
  '安装登录与聊天入口', '连接电脑与历史同步', '发送、流式回复与键盘布局', '处理中补充消息与停止',
  '允许审批', '拒绝审批', '回答补充问题', '新建独立聊天', '归档与恢复', '断线重新同步且不重复发送',
  '切换 Tab、进入后台和回到前台',
];

export function markdownReport(report, output) {
  const device = report.device ?? {};
  const lines = ['# Android 模拟器聊天回归', '', `结果：**${report.passed ? '全部通过' : '未通过'}**`, '',
    `设备：${device.model ?? '未知'}，Android ${device.android ?? '未知'} / API ${device.api ?? '未知'}。`,
    `开始：${report.startedAt}；结束：${report.finishedAt}。`, '',
    '范围：实际 Android APK、真实原生界面与加密传输，连接本机 PC/admin 测试端，不请求真实模型。',
    '本地测试结果不代表不同公网 NAT 下的 P2P 直连验收。',
    `测试期间记录到 ${report.fixture?.relayFrames ?? '未知数量的'} 个加密中转帧。`, '',
    `APK SHA-256：\`${device.sha256 ?? '未获得'}\``, '',
    '| 场景 | 结果 | 耗时（含自动化操作） | 证据 |', '| --- | --- | --- | --- |'];
  for (const item of report.cases) {
    const label = labels[Number(item.name.slice(0, 2)) - 1] ?? item.name;
    const image = path.join(output, `${item.name}${item.passed ? '' : '-failed'}.png`).replaceAll('\\', '/');
    const duration = (item.durationMs / 1000).toFixed(1);
    lines.push(`| ${label} | ${item.passed ? '通过' : '失败'} | ${duration} 秒 | [截图](${image}) |`);
  }
  lines.push('', `详细数据：[report.json](${path.join(output, 'report.json').replaceAll('\\', '/')})`,
    `运行日志：[logcat.txt](${path.join(output, 'logcat.txt').replaceAll('\\', '/')})`, '');
  if (report.error) lines.push(`失败原因：${report.error}`, '');
  return lines.join('\n');
}
