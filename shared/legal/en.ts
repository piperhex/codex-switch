import type { UserAgreement } from './types';

export const userAgreementEn: UserAgreement = {
  title: 'Codex Switch User Agreement',
  updated: 'Updated: September 25, 2026',
  introduction: 'Please read this agreement before signing in or registering, '
    + 'especially the sections with bold headings. '
    + 'You can read the full text before deciding whether to agree.',
  sections: [
    {
      title: '1. Scope and acceptance',
      paragraphs: [
        'This agreement covers account management, cloud sync and remote connections in the desktop, mobile and web '
          + 'apps. The service provider is the operator of the server you connect to. '
          + 'Open-source maintainers are not necessarily '
          + 'the operators of independently hosted servers.',
        'Selecting the checkbox and signing in or registering, or choosing “Agree and sign in” '
          + 'or “Agree and register”, means you have read and accept this agreement. '
          + 'Opening a page, reading the agreement or dismissing a prompt '
          + 'does not mean acceptance. You may cancel if you disagree.',
        'Before using another server, check its operator, contact details, service terms and privacy notice. '
          + 'Its operator must explain any additional terms. '
          + 'This agreement does not replace their disclosure obligations.',
      ],
    },
    {
      title: '2. Accounts and eligibility',
      paragraphs: [
        'Use an email address you are entitled to use. Protect passwords, verification codes, credentials and devices. '
          + 'Only add or manage accounts and resources you own or are authorized to use. Do not steal identities '
          + 'or transfer access without permission.',
        'If an account is compromised or a device is lost, change your password, sign out affected devices and contact '
          + 'the server operator. Minors should use the service with a guardian’s guidance and consent. Do not use it '
          + 'independently if you cannot understand and take responsibility for the consequences.',
      ],
    },
    {
      title: '3. Features and third-party services',
      important: true,
      paragraphs: [
        'Features vary by version, device, network and server settings. Usage, quota and device status may be delayed; '
          + 'the relevant service’s final records apply. Prices, duration and refund terms for paid services must be '
          + 'disclosed separately before purchase.',
        'Codex Switch is an independent tool, not an official product of OpenAI or other model providers. '
          + 'Third-party accounts, models and plugins have their own terms and privacy policies. This tool does not '
          + 'grant extra quota, guarantee account availability or permit bypassing third-party restrictions.',
      ],
    },
    {
      title: '4. Cloud sync and remote actions',
      important: true,
      paragraphs: [
        'Sync may send selected account details, access credentials, settings or authenticator secrets to your server. '
          + 'Choose a trusted server and sync only what you need. Signing out or uninstalling does not automatically '
          + 'delete server data.',
        'Remote chat, terminals, files and assistant tasks may read or change files, run commands, '
          + 'or access authorized '
          + 'apps and websites on a connected computer. Check the device, scope and permissions, and back up important '
          + 'data before consequential actions.',
        'Model output may be inaccurate and automated actions may have unintended results. Verify advice and important '
          + 'actions. Signing in does not authorize arbitrary remote actions or grant all device permissions.',
      ],
    },
    {
      title: '5. Data and personal information',
      important: true,
      paragraphs: [
        'Sign-in, sync and connections require the client and server to process email, credentials, '
          + 'device identifiers, '
          + 'connection status and submitted data. Version, activity and necessary operational or error information '
          + 'may also be used to maintain and troubleshoot the service.',
        'Chat, files, screenshots, browser tasks and other assistant features may send related content to configured '
          + 'model providers or other services. Avoid unnecessary personal information, confidential material and '
          + 'unauthorized content. Review recipients’ data practices.',
        'Use settings to manage sync, connections and system permissions. Contact your server operator to request '
          + 'access, correction, deletion, withdrawal of relevant consent or account closure. For data held by a '
          + 'third party, also contact that party.',
        'Operators must separately disclose their identity, contact details, processing purposes and methods, data '
          + 'categories, retention periods and rights channels. Separate consent or additional authorization must '
          + 'be obtained where required by law; accepting this agreement does not replace it.',
      ],
    },
    {
      title: '6. Acceptable use and content rights',
      paragraphs: [
        'Do not use the service for unlawful activities, privacy or intellectual property violations, malware, '
          + 'credential theft, attacks or abusive requests that disrupt other users. Follow applicable law and '
          + 'the reasonable rules of connected services.',
        'You retain your lawful rights in submitted content and must have permission to provide it. Operators may '
          + 'process it only as needed for the service and within lawful authorization. This agreement does not '
          + 'transfer ownership of your content. Open-source licenses continue to govern the code; third-party '
          + 'trademarks and works belong to their respective owners.',
      ],
    },
    {
      title: '7. Changes, interruptions and responsibility',
      important: true,
      paragraphs: [
        'Maintenance, network failures, third-party changes or events beyond reasonable control may interrupt service. '
          + 'Operators should provide reasonable notice and remedies and remain responsible under applicable law. '
          + 'Keep backups; do not rely on this service as your only storage or recovery method.',
        'Restrictions for unlawful conduct or serious breaches should be proportionate, with reasons and a contact '
          + 'or appeal channel where legally permitted. Nothing here excludes liability that cannot lawfully be '
          + 'excluded or reduces your statutory consumer or personal information rights.',
      ],
    },
    {
      title: '8. Leaving and agreement updates',
      paragraphs: [
        'You may stop using the service, sign out or disconnect devices. Ask the actual operator for account closure '
          + 'and cloud data deletion. Legally required records follow applicable retention rules; other data should '
          + 'be retained only as long as necessary for its purpose.',
        'Updates will show a revised date. Material changes affecting important rights should be brought to your '
          + 'attention, with renewed consent where required. Silence alone does not constitute acceptance.',
      ],
    },
    {
      title: '9. Contact and disputes',
      paragraphs: [
        'For service, account or data requests, contact your server operator first. For open-source software issues, '
          + 'contact maintainers at https://github.com/piperhex/codex-switch/issues. Never post passwords, codes, '
          + 'keys or sensitive personal information in public reports.',
        'Parties may first try to resolve disputes through discussion, then seek remedies from a competent authority '
          + 'under applicable law. Mandatory law prevails. An invalid clause does not invalidate other lawful clauses.',
      ],
    },
  ],
};
