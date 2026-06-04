// Canada's 13 provinces + territories. Single source of truth for the province
// code list — used by the dealers DB enum (`ca_province`), the dealer form
// schema/select, and the sales-tax-rate seed (0065). Client-safe: no server
// imports, so the shared dealer form schema/component can use it.

export const CA_PROVINCE_CODES = [
  'AB',
  'BC',
  'MB',
  'NB',
  'NL',
  'NS',
  'NT',
  'NU',
  'ON',
  'PE',
  'QC',
  'SK',
  'YT',
] as const;

export type CaProvinceCode = (typeof CA_PROVINCE_CODES)[number];

export const CA_PROVINCE_NAMES: Record<CaProvinceCode, string> = {
  AB: 'Alberta',
  BC: 'British Columbia',
  MB: 'Manitoba',
  NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
  ON: 'Ontario',
  PE: 'Prince Edward Island',
  QC: 'Quebec',
  SK: 'Saskatchewan',
  YT: 'Yukon',
};

/** `[{ code, name }]` in list order — for rendering a province `<select>`. */
export const CA_PROVINCES = CA_PROVINCE_CODES.map((code) => ({
  code,
  name: CA_PROVINCE_NAMES[code],
}));
