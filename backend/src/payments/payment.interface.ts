import type { Stablecoin } from '../database/schema/index.js';

/** Контракт — frontend/src/shared/api/payments/schemas.ts */
export interface PaymentRequestView {
  code: string;
  memberId: string;
  memberName: string;
  amount: number;
  token: Stablecoin;
  url: string;
  solanaPayUrl: string;
}

/** Запрос в списке «Отправленные» — его видит только тот, кто запрашивал */
export interface SentPaymentRequest extends PaymentRequestView {
  status: 'open' | 'paid' | 'expired';
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
  /** Транзакция, которой запрос оплачен — для ссылки в обозреватель */
  signature: string | null;
}

/** Публичная страница запроса: её открывают по ссылке, без входа */
export interface PaymentRequestPreview {
  code: string;
  fromName: string;
  fromAddress: string;
  toName: string;
  groupName: string;
  amount: number;
  token: Stablecoin;
  message: string;
  solanaPayUrl: string;
  expiresAt: string;
  status: 'open' | 'paid';
  paidAt: string | null;
  signature: string | null;
}
