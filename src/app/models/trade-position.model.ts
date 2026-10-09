export interface ReminderSource {symbol:string; eventId?:string; ruleVersion?:string; rangeId?:string; date:string;}
export type OrderType = '現股多單' | '空單' | '融資' | '融券';

export interface TradePosition {
  reminderSource?:ReminderSource;
  entryFeePaid?: number;
  entryTaxPaid?: number;
  id: string;
  symbol: string;
  type: OrderType;
  shares: number;
  entryPrice: number;
  targetPrice: number;
  note: string;
  tradeDate?: string;
  stopLossPrice?: number;
}

export type TradePositionInput = Omit<TradePosition, 'id'>;

export interface PositionGroup {
  symbol: string;
  positions: TradePosition[];
  shares: number;
  cost: number;
  profit: number;
}

export interface PositionInlineChange {
  id: string;
  field: 'note' | 'targetPrice' | 'stopLossPrice';
  value: string | number;
}

export type PresetOrderAction = 'buy' | 'sell';

export interface PresetFill {
  id: string;
  orderId: string;
  symbol: string;
  type: OrderType;
  action: PresetOrderAction;
  date: string;
  price: number;
  shares: number;
  plannedPrice: number;
  remainingShares: number;
  recordedAt: string;
  note: string;
}

export interface PresetOrder {
  reminderSource?:ReminderSource;
  note?: string;
  id: string;
  symbol: string;
  type: OrderType;
  action?: PresetOrderAction;
  shares: number;
  entryPrice: number;
  exitPrice?: number;
  validDays: number;
  createdAt: string;
  expiryDate?: string;
  shareUnit?: 'boardLot' | 'oddLot';
  stopLossPrice?: number;
}

export interface ClosedTrade extends TradePosition {
  costBreakdown?: TradeCostBreakdown;
  costAssumptions?: { feeRate: number; minimumFee: number; taxRate: number; financingLoanRatio: number; feeDiscount: number; financingRate: number; borrowRate: number; holdingDays: number; recordedAt: string };
  exitPrice: number;
  exitDate: string;
  realizedProfit: number;
}

export interface TradeCostBreakdown {
  buyFee: number;
  sellFee: number;
  transactionTax: number;
  financingCost: number;
  borrowCost: number;
  total: number;
}

export interface BacktestResult {
  observations: number;
  totalReturn: number;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number;
  endingEquity: number;
}

export interface OrderScenario {
  type: OrderType;
  entryPrice: number;
  exitPrice: number;
  projectedProfit: number;
  adverseProfit: number;
  returnRate: number;
  label: string;
}
