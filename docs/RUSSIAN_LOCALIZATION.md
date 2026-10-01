# Russian localization

Desktop and web support Russian in the existing language selector (Русский). On first launch, Russian system/browser locales select Russian automatically; a saved language choice takes precedence. Other system locales retain the previous default.

Coverage includes desktop navigation, accounts, providers, token usage, settings, themes, plugins, conversation controls, permissions, scheduled tasks, terminal actions, configuration labels, tray actions and the user agreement. Web uses the shared Russian interface dictionary and Russian component-library locales.

Conversation messages, code, file paths, model identifiers and configuration values remain unchanged. Translation dictionaries are bundled with the application; no external translation service is used at runtime. English and Chinese remain available. Native Android/iOS screens and the admin interface are outside this change.

## Maintenance

- Desktop keys: apps/desktop/src/i18n/ru/.
- Shared GUI/web source strings: shared/i18n/ru/.
- User agreement: shared/legal/ru.ts.
- Use guiText only for application copy, never user or assistant content.
- Run npm run check and npm test -w @codex-switch/desktop. The Russian dictionary tests check interpolation placeholders and untranslated Chinese copy.
