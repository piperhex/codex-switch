import { Input, InputNumber, Modal, Select } from "antd";
import type { Translate } from "../../i18n";
import type { DreamSkinImportOptions } from "../../types";
import { APPEARANCE_OPTIONS, SAFE_AREA_OPTIONS, TASK_MODE_OPTIONS } from "./constants";

type Props = {
  busy: string | null;
  importDialog: {
    open: boolean;
    options: DreamSkinImportOptions;
    setOpen: (open: boolean) => void;
    setOptions: (update: (current: DreamSkinImportOptions) => DreamSkinImportOptions) => void;
    submit: () => Promise<void>;
  };
  isBusy: boolean;
  saveDialog: {
    name: string;
    open: boolean;
    setName: (name: string) => void;
    setOpen: (open: boolean) => void;
    submit: () => Promise<void>;
  };
  t: Translate;
};

export function DreamSkinDialogs({ busy, importDialog, isBusy, saveDialog, t }: Props) {
  const { options, setOptions } = importDialog;
  return <>
    <Modal title={t("dreamSkin.import.modalTitle")} open={importDialog.open}
      confirmLoading={busy === "import"} okText={t("dreamSkin.import.apply")} cancelText={t("table.cancel")}
      onOk={() => void importDialog.submit()} okButtonProps={{ disabled: !options.name.trim() }}
      onCancel={() => !isBusy && importDialog.setOpen(false)}>
      <div className="dream-import-form">
        <p>{t("dreamSkin.import.modalDescription")}</p>
        <label htmlFor="dream-skin-name">{t("dreamSkin.import.name")}</label>
        <Input id="dream-skin-name" maxLength={80} value={options.name}
          onChange={(event) => setOptions((current) => ({ ...current, name: event.target.value }))} />
        <div className="dream-import-fields">
          <ImportSelect label={t("dreamSkin.import.appearance")} value={options.appearance}
            options={APPEARANCE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
            onChange={(appearance) => setOptions((current) => ({
              ...current, appearance: appearance as DreamSkinImportOptions["appearance"],
            }))} />
          <ImportSelect label={t("dreamSkin.import.safeArea")} value={options.safeArea}
            options={SAFE_AREA_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
            onChange={(safeArea) => setOptions((current) => ({
              ...current, safeArea: safeArea as DreamSkinImportOptions["safeArea"],
            }))} />
          <ImportSelect label={t("dreamSkin.import.taskMode")} value={options.taskMode}
            options={TASK_MODE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
            onChange={(taskMode) => setOptions((current) => ({
              ...current, taskMode: taskMode as DreamSkinImportOptions["taskMode"],
            }))} />
          <FocusInput label={t("dreamSkin.import.focusX")} value={options.focusX}
            placeholder={t("dreamSkin.option.auto")}
            onChange={(focusX) => setOptions((current) => ({ ...current, focusX }))} />
          <FocusInput label={t("dreamSkin.import.focusY")} value={options.focusY}
            placeholder={t("dreamSkin.option.auto")}
            onChange={(focusY) => setOptions((current) => ({ ...current, focusY }))} />
        </div>
        <small>{t("dreamSkin.import.requirements")}</small>
      </div>
    </Modal>
    <Modal title={t("dreamSkin.save.modalTitle")} open={saveDialog.open} confirmLoading={busy === "save"}
      okText={t("dreamSkin.save.action")} cancelText={t("table.cancel")}
      onOk={() => void saveDialog.submit()} okButtonProps={{ disabled: !saveDialog.name.trim() }}
      onCancel={() => !isBusy && saveDialog.setOpen(false)}>
      <div className="dream-save-form"><p>{t("dreamSkin.save.description")}</p>
        <label htmlFor="dream-skin-save-name">{t("dreamSkin.import.name")}</label>
        <Input id="dream-skin-save-name" value={saveDialog.name} maxLength={80}
          onChange={(event) => saveDialog.setName(event.target.value)}
          onPressEnter={() => void saveDialog.submit()} /></div>
    </Modal>
  </>;
}

type SelectOption = { value: string; label: string };

function ImportSelect(props: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}) {
  return <label><span>{props.label}</span><Select value={props.value}
    onChange={props.onChange} options={props.options} /></label>;
}

function FocusInput(props: {
  label: string;
  value: number | null | undefined;
  placeholder: string;
  onChange: (value: number | null) => void;
}) {
  return <label><span>{props.label}</span><InputNumber min={0} max={1} step={0.01}
    placeholder={props.placeholder} value={props.value} onChange={props.onChange} /></label>;
}
