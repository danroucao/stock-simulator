import { buildPresetOrderWorkbook, buildFillHistoryWorkbook } from './preset-order-export';
import { PresetOrder } from '../models/trade-position.model';

describe('preset order Excel', () => {
  it('exports actual fills even after the original order has been fully filled', async () => {
    const book = await buildFillHistoryWorkbook([{ id: 'fill', orderId: 'original', symbol: '6182', type: '現股多單', action: 'buy', date: '2026-10-08', price: 99, shares: 400, plannedPrice: 100, remainingShares: 600, recordedAt: '2026-10-08T02:00:00Z', note: '分批' }], { '6182': '合晶' });
    const sheet = book.getWorksheet('實際成交紀錄')!;
    expect(sheet.getCell('I2').value).toEqual({ formula: 'G2*H2', result: 39600 });
    expect(sheet.getCell('J2').value).toEqual({ formula: 'G2-F2', result: -1 });
    expect(sheet.getCell('L2').value).toBe('original');
    expect((await book.xlsx.writeBuffer()).byteLength).toBeGreaterThan(1000);
  });
  it('keeps multiple same-day prices separate and aggregates buy and sell amounts', async () => {
    const base: PresetOrder = { id: '1', symbol: '6182', type: '現股多單', shares: 1000, entryPrice: 100, createdAt: '2026-10-08', validDays: 5, expiryDate: '2026-10-09' };
    const book = await buildPresetOrderWorkbook([base, { ...base, id: '2', entryPrice: 98 }, { ...base, id: '3', action: 'sell', entryPrice: 110 }], { '6182': '合晶' });
    const detail = book.getWorksheet('預設單明細')!;
    expect(detail.rowCount).toBe(4);
    expect(detail.getCell('H2').value).toBe(98);
    expect(detail.getCell('H3').value).toBe(100);
    expect(detail.getCell('M2').value).toBeNull();
    const summary = book.getWorksheet('布局總覽')!;
    expect(summary.getCell('E2').value).toBe(198000);
    expect(summary.getCell('G2').value).toBe(110000);
    const buffer = await book.xlsx.writeBuffer();
    expect(buffer.byteLength).toBeGreaterThan(1000);
  });
});
