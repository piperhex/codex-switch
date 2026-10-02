import { messages1 } from "./messages1";
import { messages2 } from "./messages2";
import { messages3 } from "./messages3";
import { messages4 } from "./messages4";
import { messages5 } from "./messages5";
import { messages6 } from "./messages6";
import { messages7 } from "./messages7";

export const russian = {
  "settings.chatGptEnhancements.title": "Дополнительные функции ChatGPT",
  "settings.chatGptEnhancements.label": "Включить дополнительные функции",
  "settings.chatGptEnhancements.description": "Действует вне режима прокси. При отключении смена аккаунта "
    + "по-прежнему перезапускает ChatGPT, но обновляет только данные входа, без оформления.",
  "settings.chatGptEnhancements.nextLaunch": "Режим запуска изменится при следующем запуске ChatGPT или смене аккаунта.",
  "settings.chatGptEnhancements.loadError": "Не удалось загрузить настройку. Откройте настройки заново.",
  "settings.chatGptEnhancements.saveError": "Не удалось сохранить настройку. Повторите попытку.",
  "settings.chatGptEnhancements.skinDisabledTitle": "Оформление ChatGPT отключено",
  "settings.chatGptEnhancements.skinDisabledDescription": "Включите дополнительные функции ChatGPT в настройках.",
  ...messages1,
  ...messages2,
  ...messages3,
  ...messages4,
  ...messages5,
  ...messages6,
  ...messages7,
} as const;
