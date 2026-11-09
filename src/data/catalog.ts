import type { CurrencyRecord } from '../db/schema';

/**
 * ISO 4217 currency catalogue with the correct number of minor-unit digits.
 * `exponent` is the authoritative decimal precision for the currency — JPY and
 * KRW have 0, KWD/BHD/OMR/JOD/TND have 3, everything else here has 2.
 */
export const CURRENCY_CATALOG: Omit<CurrencyRecord, 'createdAt'>[] = [
  { code: 'USD', name: 'US Dollar', symbol: '$', exponent: 2, locale: 'en-US', enabled: true },
  { code: 'EUR', name: 'Euro', symbol: '€', exponent: 2, locale: 'de-DE', enabled: true },
  { code: 'GBP', name: 'British Pound', symbol: '£', exponent: 2, locale: 'en-GB', enabled: true },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', exponent: 0, locale: 'ja-JP', enabled: true },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', exponent: 2, locale: 'de-CH', enabled: true },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$', exponent: 2, locale: 'en-CA', enabled: true },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', exponent: 2, locale: 'en-AU', enabled: true },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$', exponent: 2, locale: 'en-NZ', enabled: true },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', exponent: 2, locale: 'zh-CN', enabled: true },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', exponent: 2, locale: 'en-IN', enabled: true },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩', exponent: 0, locale: 'ko-KR', enabled: true },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', exponent: 2, locale: 'en-SG', enabled: true },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$', exponent: 2, locale: 'en-HK', enabled: true },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr', exponent: 2, locale: 'sv-SE', enabled: true },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr', exponent: 2, locale: 'nb-NO', enabled: true },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr', exponent: 2, locale: 'da-DK', enabled: true },
  { code: 'PLN', name: 'Polish Złoty', symbol: 'zł', exponent: 2, locale: 'pl-PL', enabled: true },
  { code: 'CZK', name: 'Czech Koruna', symbol: 'Kč', exponent: 2, locale: 'cs-CZ', enabled: true },
  { code: 'HUF', name: 'Hungarian Forint', symbol: 'Ft', exponent: 2, locale: 'hu-HU', enabled: true },
  { code: 'RON', name: 'Romanian Leu', symbol: 'lei', exponent: 2, locale: 'ro-RO', enabled: true },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', exponent: 2, locale: 'pt-BR', enabled: true },
  { code: 'MXN', name: 'Mexican Peso', symbol: 'MX$', exponent: 2, locale: 'es-MX', enabled: true },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', exponent: 2, locale: 'en-ZA', enabled: true },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺', exponent: 2, locale: 'tr-TR', enabled: true },
  { code: 'ILS', name: 'Israeli New Shekel', symbol: '₪', exponent: 2, locale: 'he-IL', enabled: true },
  { code: 'THB', name: 'Thai Baht', symbol: '฿', exponent: 2, locale: 'th-TH', enabled: true },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM', exponent: 2, locale: 'ms-MY', enabled: true },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', exponent: 2, locale: 'id-ID', enabled: true },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱', exponent: 2, locale: 'en-PH', enabled: true },
  { code: 'AED', name: 'UAE Dirham', symbol: 'AED', exponent: 2, locale: 'en-AE', enabled: true },
  { code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR', exponent: 2, locale: 'ar-SA', enabled: true },
  { code: 'RUB', name: 'Russian Ruble', symbol: '₽', exponent: 2, locale: 'ru-RU', enabled: true },
  { code: 'UAH', name: 'Ukrainian Hryvnia', symbol: '₴', exponent: 2, locale: 'uk-UA', enabled: true },
  { code: 'VND', name: 'Vietnamese Dong', symbol: '₫', exponent: 0, locale: 'vi-VN', enabled: true },
  { code: 'CLP', name: 'Chilean Peso', symbol: 'CLP$', exponent: 0, locale: 'es-CL', enabled: true },
  { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'KD', exponent: 3, locale: 'ar-KW', enabled: true },
  { code: 'BHD', name: 'Bahraini Dinar', symbol: 'BD', exponent: 3, locale: 'ar-BH', enabled: true },
  { code: 'OMR', name: 'Omani Rial', symbol: 'OMR', exponent: 3, locale: 'ar-OM', enabled: true },
  { code: 'JOD', name: 'Jordanian Dinar', symbol: 'JD', exponent: 3, locale: 'ar-JO', enabled: true },
  { code: 'TND', name: 'Tunisian Dinar', symbol: 'DT', exponent: 3, locale: 'ar-TN', enabled: true },
  { code: 'ISK', name: 'Icelandic Króna', symbol: 'kr', exponent: 0, locale: 'is-IS', enabled: true },
  { code: 'COP', name: 'Colombian Peso', symbol: 'COL$', exponent: 2, locale: 'es-CO', enabled: true },
  { code: 'PEN', name: 'Peruvian Sol', symbol: 'S/', exponent: 2, locale: 'es-PE', enabled: true },
  // Guyana. ISO 4217 exponent is 2 (100 cents to the dollar). The ECB does not
  // publish GYD, so its history comes from a separate bundled dataset — see
  // src/data/seed-rates-gyd.json.
  { code: 'GYD', name: 'Guyanese Dollar', symbol: 'G$', exponent: 2, locale: 'en-GY', enabled: true },
];

export const CURRENCY_CODES = CURRENCY_CATALOG.map((currency) => currency.code);

export function currencyMeta(code: string): Omit<CurrencyRecord, 'createdAt'> | undefined {
  return CURRENCY_CATALOG.find((currency) => currency.code === code);
}
