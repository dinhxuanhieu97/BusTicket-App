import {
  extractBookingCodes, hashWebhookKey, mapSepayTransactionList, parseSepayWebhook, parseVnDateTime, sepayQrUrl, verifyApiKeyHeader,
} from './sepay';

/** Mẫu payload theo tài liệu SePay. */
const sample = {
  id: 92704,
  gateway: 'Vietcombank',
  transactionDate: '2026-11-04 14:02:37',
  accountNumber: '0123499999',
  code: null,
  content: 'NGUYEN VAN A chuyen tien PN7K3D2Q',
  transferType: 'in',
  transferAmount: 2277000,
  accumulated: 19077000,
  subAccount: null,
  referenceCode: 'MBVCB.3278907687',
  description: '',
};

describe('parseSepayWebhook', () => {
  it('normalizes the documented payload', () => {
    expect(parseSepayWebhook(sample)).toEqual({
      providerTxnId: '92704',
      accountNumber: '0123499999',
      direction: 'in',
      amount: 2277000,
      content: 'NGUYEN VAN A chuyen tien PN7K3D2Q',
      referenceCode: 'MBVCB.3278907687',
      code: null,
      transactionAt: new Date('2026-11-04T07:02:37.000Z'),
    });
  });

  it('accepts amounts sent as strings like "19689000.00"', () => {
    expect(parseSepayWebhook({ ...sample, transferAmount: '19689000.00' }).amount).toBe(19_689_000);
  });

  it.each([
    ['fractional amount', { transferAmount: 1000.5 }],
    ['negative amount', { transferAmount: -5 }],
    ['unknown direction', { transferType: 'refund' }],
    ['bad date', { transactionDate: '04/11/2026 14:02' }],
    ['impossible date', { transactionDate: '2026-02-30 10:00:00' }],
    ['bad account', { accountNumber: '12' }],
    ['missing id', { id: undefined }],
  ])('rejects %s', (_name, patch) => {
    expect(() => parseSepayWebhook({ ...sample, ...patch })).toThrow();
  });
});

describe('parseVnDateTime', () => {
  it('treats the time as Vietnam time (UTC+7)', () => {
    expect(parseVnDateTime('2027-01-01 00:00:00').toISOString()).toBe('2026-12-31T17:00:00.000Z');
  });
});

describe('verifyApiKeyHeader', () => {
  const hash = hashWebhookKey('secret-key-123456789012345');

  it('accepts "Apikey <key>" in any case', () => {
    expect(verifyApiKeyHeader('Apikey secret-key-123456789012345', hash)).toBe(true);
    expect(verifyApiKeyHeader('APIKEY secret-key-123456789012345', hash)).toBe(true);
  });

  it.each([undefined, '', 'Bearer secret-key-123456789012345', 'Apikey wrong', 'Apikey', 'secret-key-123456789012345'])(
    'rejects %p',
    (header) => {
      expect(verifyApiKeyHeader(header, hash)).toBe(false);
    },
  );
});

describe('extractBookingCodes', () => {
  it.each([
    ['PN7K3D2Q', ['PN7K3D2Q']],
    ['thanh toan pn7k3d2q', ['PN7K3D2Q']],
    ['NGUYENVANAPN7K3D2Q', ['PN7K3D2Q']],
    ['PN 7K3D 2Q', ['PN7K3D2Q']],
    ['MBVCB.123 PN7K3D2Q-GD 999', ['PN7K3D2Q']],
    ['PN7K3D2Q PN8M4F6R', ['PN7K3D2Q', 'PN8M4F6R']],
    ['PN7K3D2Q PN7K3D2Q', ['PN7K3D2Q']],
    ['no code here', []],
    ['PN7K3D0Q', []], // 0 không nằm trong bảng ký tự mã
  ])('finds codes in %p', (content, expected) => {
    expect(extractBookingCodes(content, 'PN')).toEqual(expected);
  });

  it('also looks at the code SePay detected', () => {
    expect(extractBookingCodes('chuyen khoan', 'PN', 'PN8M4F6R')).toEqual(['PN8M4F6R']);
  });

  it("ignores another operator's codes", () => {
    expect(extractBookingCodes('AB7K3D2Q', 'PN')).toEqual([]);
  });
});

describe('sepayQrUrl', () => {
  it('encodes bank, account, amount and content', () => {
    const url = new URL(sepayQrUrl('MB', '0123499999', 450000, 'PN7K3D2Q'));
    expect(url.origin + url.pathname).toBe('https://qr.sepay.vn/img');
    expect(Object.fromEntries(url.searchParams)).toEqual({ acc: '0123499999', bank: 'MB', amount: '450000', des: 'PN7K3D2Q' });
  });
});

describe('mapSepayTransactionList', () => {
  it('maps incoming rows and skips outgoing or malformed ones', () => {
    const out = mapSepayTransactionList({
      status: 200,
      transactions: [
        { id: '1', transaction_date: '2026-11-04 10:00:00', account_number: '0123499999', amount_in: '450000.00', amount_out: '0.00', transaction_content: 'PN7K3D2Q', reference_number: 'R1', code: null },
        { id: '2', transaction_date: '2026-11-04 10:05:00', account_number: '0123499999', amount_in: '0.00', amount_out: '100000.00', transaction_content: 'rut tien' },
        { id: '3', transaction_date: 'bad', account_number: '0123499999', amount_in: '1000' },
        { nonsense: true },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ providerTxnId: '1', amount: 450000, content: 'PN7K3D2Q', direction: 'in' });
  });

  it('returns nothing for an unexpected shape', () => {
    expect(mapSepayTransactionList(null)).toEqual([]);
    expect(mapSepayTransactionList({ transactions: 'x' })).toEqual([]);
  });
});
