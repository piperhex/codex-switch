export const imageEditorStyles = String.raw`
:root { color-scheme: light; --surface: #f1f3f6; --panel: #fafbfd; --ink: #24292d;
  --muted: #858a92; --green: #168653; --selected: #e5f8ef; --outline: #54c99d; }
* { box-sizing: border-box; }
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
body { display: flex; flex-direction: column; background: var(--surface); color: var(--ink);
  font: 14px/1.4 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; }
button, input, textarea { font: inherit; }
button { display: inline-flex; justify-content: center; align-items: center; gap: 7px; min-height: 44px;
  padding: 8px 12px; border: 0; border-radius: 12px; color: inherit; background: transparent;
  touch-action: manipulation; cursor: pointer; }
button:disabled { opacity: .35; cursor: default; }
button:focus-visible, input:focus-visible, textarea:focus-visible {
  outline: 2px solid var(--green); outline-offset: 2px;
}
button svg { width: 22px; height: 22px; flex-shrink: 0; }
[hidden] { display: none !important; }
header { flex-shrink: 0; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center;
  gap: 10px; padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
    10px max(16px, env(safe-area-inset-left)); }
header button { font-size: 16px; }
/* Leave room for the host close button, which works even if the editor cannot start. */
body[data-browser-editor] header { padding-right: max(60px, env(safe-area-inset-right)); }
#cancel { justify-self: start; color: #596068; background: #e9ecf0; }
#done, .primary { color: #fff; background: var(--green); }
#done { justify-self: end; }
.heading { text-align: center; min-width: 0; }
h1 { margin: 0; font-size: 19px; font-weight: 650; letter-spacing: .04em; }
.heading p { margin: 2px 0 0; font-size: 12px; color: #737981; }
#stage { flex: 1; min-height: 0; min-width: 0; display: flex; align-items: center; justify-content: center;
  overflow: hidden; padding: 12px 24px 18px; }
#canvas { display: block; touch-action: none; border-radius: 13px; box-shadow: 0 6px 15px #28313c12;
  cursor: crosshair; }
footer { flex-shrink: 0; display: flex; flex-direction: column; gap: 18px; min-width: 0;
  padding: 16px max(16px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom))
    max(16px, env(safe-area-inset-left)); background: var(--panel); border-radius: 26px 26px 0 0; }
#tools { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 6px; }
.tool { min-width: 0; min-height: 66px; flex-direction: column; gap: 7px; padding: 9px 2px;
  background: var(--surface); border: 1px solid transparent; font-size: 12px; }
.tool svg { width: 25px; height: 25px; }
.tool span { max-width: 100%; overflow-wrap: anywhere; }
.tool[aria-pressed="true"] { background: var(--selected); color: #197252; border-color: var(--outline);
  box-shadow: inset 0 0 0 1px #54c99d22; }
#colors { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px;
  background: var(--surface); padding: 3px 6px; border-radius: 30px; }
.color { width: 100%; min-width: 0; min-height: 44px; padding: 4px; }
.swatch { width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0; position: relative;
  box-shadow: 0 1px 4px #00000009; }
.color[aria-pressed="true"] .swatch::after { content: ''; position: absolute; inset: -5px;
  border: 1.5px solid #28a777; border-radius: 50%; }
.rainbow { background: conic-gradient(#ff5050, #ffdc33, #31cf65, #28b8f6, #8b4af4, #ff4abd, #ff5050); }
.width-row { display: flex; align-items: center; gap: 10px; }
.width-label { flex-shrink: 0; font-size: 13px; font-weight: 550; }
#widths { flex: 1; min-width: 0; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr));
  border-radius: 28px; background: var(--surface); padding: 2px; }
.width { min-width: 0; padding: 4px; min-height: 44px; }
.width span { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px;
  border: 1.5px solid transparent; border-radius: 50%; }
.width i { display: block; width: var(--dot); height: var(--dot); border-radius: 50%; background: #50545a; }
.width[aria-pressed="true"] span { border-color: #28a777; background: #f7fffb; }
.bottom { display: flex; align-items: center; gap: 6px; margin-top: 8px; border-top: 1px solid #edf0f4;
  padding-top: 10px; }
.history { display: flex; flex-shrink: 0; }
.bottom button { padding: 6px 3px; color: #757c84; font-size: 13px; }
.bottom button svg { width: 20px; height: 20px; }
#notice { flex: 1; max-width: 400px; min-width: 0; margin: 0 auto; font-size: 11px;
  text-align: center; color: var(--muted); overflow-wrap: anywhere; }
dialog { width: calc(100% - 32px); max-width: 400px; max-height: calc(100% - 24px); overflow: auto;
  border: 0; padding: 20px; border-radius: 20px; color: var(--ink); background: var(--panel);
  box-shadow: 0 16px 64px #202a3833; }
dialog::backdrop { background: #202a3844; }
dialog h2 { margin: 0 0 14px; font-size: 18px; }
dialog textarea, #color-value { width: 100%; padding: 10px; border: 1px solid #dce1e7; border-radius: 10px;
  color: var(--ink); background: #fff; user-select: text; }
dialog textarea { resize: vertical; min-height: 88px; max-height: 180px; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }
.color-preview { height: 36px; border-radius: 10px; margin-bottom: 14px; background: #ef4444; }
.color-channel { display: flex; align-items: center; gap: 12px; margin: 12px 0; }
.color-channel input { flex: 1; min-width: 0; accent-color: var(--green); }
@media (min-width: 720px), (min-width: 560px) and (max-height: 500px) {
  body { display: grid; grid-template-columns: minmax(0, 1fr) 300px; grid-template-rows: auto minmax(0, 1fr); }
  header { grid-column: 1 / -1; padding: 18px 24px; }
  #stage { padding: 12px 24px 24px; }
  footer { min-height: 0; margin: 0 16px 16px 0; padding: 20px 14px 14px; border-radius: 22px;
    overflow-y: auto; gap: 22px; }
  #tools { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .tool { min-height: 74px; font-size: 13px; }
  .bottom { flex-wrap: wrap; justify-content: space-between; margin-top: auto; }
  #notice { flex: 0 0 100%; order: 1; padding-top: 6px; }
  .bottom button { padding: 6px; }
}
@media (max-height: 700px) and (max-width: 719px) {
  header { padding-top: 8px; padding-bottom: 4px; }
  #stage { padding: 8px 16px 12px; }
  footer { gap: 10px; padding-top: 12px; }
  .tool { min-height: 56px; gap: 4px; padding-block: 6px; }
  .tool svg { width: 22px; height: 22px; }
  .bottom { margin-top: 0; padding-top: 4px; }
}
@media (max-height: 500px) and (min-width: 560px) {
  header { padding: 8px 16px; }
  footer { gap: 8px; padding: 10px; margin-bottom: 8px; }
  #tools { gap: 5px; }
  .tool { flex-direction: row; min-height: 40px; gap: 5px; padding: 4px; font-size: 11px; }
  .tool svg { width: 20px; height: 20px; }
  .bottom { padding-top: 4px; }
}
@media (max-width: 359px) {
  header { gap: 5px; padding-inline: 10px; }
  header button { font-size: 14px; padding-inline: 8px; }
  h1 { font-size: 17px; }
  .heading p { font-size: 11px; }
  footer { padding-inline: 10px; }
  #tools { gap: 4px; }
  .tool { font-size: 11px; }
}
`;
