import { useState } from "react";
import { BasicSettingsCards } from "./settings/BasicSettingsCards";
import { CloudSettingsCard, WebProxySettingsCard } from "./settings/ConnectionSettingsCards";
import { LocalSettingsCards } from "./settings/LocalSettingsCards";
import type { SettingsPageProps } from "./settings/types";
import { UsageSettingsCards } from "./settings/UsageSettingsCards";

export function SettingsPage(settings: SettingsPageProps) {
  const [bubbleStyleModalOpen, setBubbleStyleModalOpen] = useState(false);

  return (
    <div className="settings-page">
      <BasicSettingsCards
        bubbleStyleModalOpen={bubbleStyleModalOpen}
        onBubbleStyleModalOpenChange={setBubbleStyleModalOpen}
        settings={settings}
      />
      <UsageSettingsCards settings={settings} />
      <WebProxySettingsCard settings={settings} />
      <LocalSettingsCards settings={settings} />
      <CloudSettingsCard settings={settings} />
    </div>
  );
}
