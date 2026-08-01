export type OrderType = '現股多單' | '空單' | '融資' | '融券';

export interface TradePosition {
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

export interface PresetOrder {
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
