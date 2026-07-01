import { ChevronRight, ExternalLink, FileInput, KeyRound, LayoutGrid, ShieldCheck, X } from "lucide-react";

export function LoginModal({ onClose, onStart, onImport }: {
  onClose: () => void;
  onStart: (embedded: boolean) => void;
  onImport: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="关闭添加账户窗口" onClick={onClose}><X size={19} /></button>
        <div className="modal-icon"><KeyRound size={25} /></div>
        <h2>添加 Codex 账户</h2>
        <p>使用 ChatGPT 完成授权，凭据会直接保存在本机，不经过前端页面。</p>
        <button type="button" className="login-choice featured" onClick={() => onStart(true)}>
          <span className="choice-icon"><LayoutGrid size={20} /></span>
          <span><b>在应用内登录</b><small>打开独立安全窗口完成 ChatGPT 授权</small></span><ChevronRight size={19} />
        </button>
        <button type="button" className="login-choice" onClick={() => onStart(false)}>
          <span className="choice-icon"><ExternalLink size={20} /></span>
          <span><b>使用默认浏览器</b><small>遇到企业 SSO 或内嵌限制时推荐</small></span><ChevronRight size={19} />
        </button>
        <div className="modal-divider"><span>或者</span></div>
        <button type="button" className="import-choice" onClick={onImport}><FileInput size={17} />导入已有 auth.json</button>
        <div className="safety-note"><ShieldCheck size={16} />Token 不会显示在界面或写入日志</div>
      </section>
    </div>
  );
}
