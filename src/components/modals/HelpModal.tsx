import { CalendarClock, CircleHelp, Clock3, RefreshCw, RotateCcw, ShieldCheck, UserRound, X } from "lucide-react";

export function HelpModal({ onClose, version }: { onClose: () => void; version: string }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-modal-title"
        onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="关闭使用帮助" onClick={onClose}><X size={19} /></button>
        <div className="modal-icon"><CircleHelp size={25} /></div>
        <h2 id="help-modal-title">使用帮助</h2>
        <p>Codex Auth Manager 用于在本机安全地管理多个 Codex 账户。</p>
        <div className="help-features">
          <div><UserRound size={18} /><span><b>多账户管理</b><small>登录 ChatGPT 或导入已有 auth.json，集中保存多个账户。</small></span></div>
          <div><RotateCcw size={18} /><span><b>快速切换</b><small>切换账户时自动同步当前 Codex 使用的 auth.json。</small></span></div>
          <div><RefreshCw size={18} /><span><b>用量查看</b><small>查看 5 小时与 1 周配额，支持单个或全部账户刷新。</small></span></div>
          <div><Clock3 size={18} /><span><b>自动刷新</b><small>可在设置中开启、关闭并调整全局用量刷新间隔。</small></span></div>
          <div><CalendarClock size={18} /><span><b>重置卡信息</b><small>展开账户行即可查看重置卡的发放和过期时间。</small></span></div>
          <div><ShieldCheck size={18} /><span><b>本地安全存储</b><small>令牌保留在 Rust 后端，不会显示在界面或写入日志。</small></span></div>
        </div>
        <div className="help-version"><span>Codex Auth Manager</span><b>v{version}</b></div>
      </section>
    </div>
  );
}
