import { userAgreementEn } from './en';
import { userAgreementZh } from './zh';
import type { AgreementLanguage } from './types';

export const AGREEMENT_VERSION = '2026-09-25';
export const getUserAgreement = (language: AgreementLanguage) => language === 'en' ? userAgreementEn : userAgreementZh;

export const agreementCopy = {
  zh: {
    prefix: '我已阅读并同意', link: '《用户协议》', checkbox: '我已阅读并同意用户协议',
    title: '请阅读并同意用户协议', login: '继续登录即表示你已阅读并同意《用户协议》。',
    register: '继续注册即表示你已阅读并同意《用户协议》。',
    confirmLogin: '同意并登录', confirmRegister: '同意并注册', cancel: '暂不同意', close: '关闭协议',
  },
  en: {
    prefix: 'I have read and agree to the', link: 'User Agreement',
    checkbox: 'I have read and agree to the User Agreement',
    title: 'Review the User Agreement', login: 'By continuing to sign in, you confirm that you have read and agree '
      + 'to the User Agreement.', register: 'By continuing to register, you confirm that you have read and agree '
      + 'to the User Agreement.', confirmLogin: 'Agree and sign in', confirmRegister: 'Agree and register',
    cancel: 'Not now', close: 'Close agreement',
  },
} as const;
