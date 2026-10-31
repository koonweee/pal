import { ApplicationError } from '../application/contracts/errors.js';
import type { SecureValues } from './login-fields.js';

export interface PaymentCard {
  cardholderName?: string;
  number?: string;
  expMonth?: string;
  expYear?: string;
  securityCode?: string;
  brand?: string;
}
export interface CardSubmission extends PaymentCard {
  accountId?: string;
  save?: boolean;
  label?: string;
}
export function cardValues(input: PaymentCard): SecureValues {
  const fail = () => {
    throw new ApplicationError(
      'invalid_input',
      'Check the card details and try again',
    );
  };
  const card = Object.fromEntries(
    ['cardholderName', 'number', 'expMonth', 'expYear', 'securityCode'].map(
      (key) => {
        const value = input[key as keyof PaymentCard];
        return [
          key,
          typeof value === 'string' && value.trim() ? value.trim() : undefined,
        ];
      },
    ),
  ) as PaymentCard;
  if (card.number !== undefined) {
    card.number = card.number.replace(/[ -]/g, '');
    if (!/^\d{12,19}$/.test(card.number)) fail();
    let sum = 0;
    card.number
      .split('')
      .reverse()
      .forEach((digit, index) => {
        let n = Number(digit);
        if (index % 2) {
          n *= 2;
          if (n > 9) n -= 9;
        }
        sum += n;
      });
    if (sum % 10) fail();
  }
  if (card.expMonth !== undefined) {
    if (
      !/^\d{1,2}$/.test(card.expMonth) ||
      Number(card.expMonth) < 1 ||
      Number(card.expMonth) > 12
    )
      fail();
    card.expMonth = card.expMonth.padStart(2, '0');
  }
  if (card.expYear !== undefined) {
    if (!/^(\d{2}|\d{4})$/.test(card.expYear)) fail();
    if (card.expYear.length === 2) card.expYear = '20' + card.expYear;
  }
  if (card.securityCode !== undefined && !/^\d{3,4}$/.test(card.securityCode))
    fail();
  return {
    cardholderName: card.cardholderName,
    number: card.number,
    expMonth: card.expMonth,
    expYear: card.expYear,
    securityCode: card.securityCode,
    ...(card.expMonth && card.expYear
      ? { expiry: card.expMonth + '/' + card.expYear.slice(-2) }
      : {}),
  };
}
