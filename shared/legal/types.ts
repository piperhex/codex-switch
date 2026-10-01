export type AgreementLanguage = 'zh' | 'en' | 'ru';
export type AgreementAction = 'login' | 'register';

export interface AgreementSection {
  title: string;
  paragraphs: string[];
  important?: boolean;
}

export interface UserAgreement {
  title: string;
  updated: string;
  introduction: string;
  sections: AgreementSection[];
}
