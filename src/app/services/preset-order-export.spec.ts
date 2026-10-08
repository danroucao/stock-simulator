import { buildPresetOrderWorkbook } from './preset-order-export';
import { PresetOrder } from '../models/trade-position.model';

describe('preset order Excel', () => {
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
