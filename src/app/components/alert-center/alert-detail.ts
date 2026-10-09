import { Component, computed, inject, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { AlertSelection, AlertStore } from '../../services/alert-store';

@Component({selector:'app-alert-detail',imports:[DecimalPipe],styleUrl:'./alert-center.scss',template:`
  <section class="alert-center" aria-labelledby="alert-detail-title">
    <header><div><span class="eyebrow">提醒來源 · {{ selection().event?.date || selection().stock.eventDate }}</span><h2 id="alert-detail-title">{{ selection().stock.symbol }} {{ selection().stock.name }} · {{ selection().event?.status || selection().stock.status }}</h2><p>{{ selection().event?.reason || selection().stock.reason }}</p></div><button type="button" [attr.aria-pressed]="store.following(selection().stock.symbol)" (click)="store.toggle(selection().stock)">{{ store.following(selection().stock.symbol) ? '★ 取消追蹤' : '☆ 加入追蹤' }}</button></header>
    @if (store.storageError()) { <p class="notice" role="alert">{{ store.storageError() }}</p> }
    <p>最新狀態：{{ selection().stock.status }} · 收盤 {{ selection().stock.close | number:'1.0-2' }} 元 · 行情 {{ selection().stock.date }}</p>
    @if (snapshot()) { <p>觸發依據快照：{{ snapshot()!.lower | number:'1.0-2' }}～{{ snapshot()!.upper | number:'1.0-2' }} 元，辨識於 {{ snapshot()!.date }}。原始快照保留；圖上區間換算至最新行情的價格基準。</p> }
    <svg viewBox="0 0 760 240" role="img" [attr.aria-label]="selection().stock.symbol + ' 還原收盤走勢與保存區間'" style="width:100%;max-height:280px;background:#10233b;border-radius:12px">
      @if (chart().lower !== undefined) { <rect x="40" [attr.y]="chart().upperY" width="680" [attr.height]="chart().lowerY-chart().upperY" fill="#7fd1ff" opacity=".12"/><line x1="40" x2="720" [attr.y1]="chart().upperY" [attr.y2]="chart().upperY" stroke="#7fd1ff" stroke-dasharray="5 4"/><line x1="40" x2="720" [attr.y1]="chart().lowerY" [attr.y2]="chart().lowerY" stroke="#7fd1ff" stroke-dasharray="5 4"/><text x="45" [attr.y]="chart().upperY-5" fill="#bce8ff" font-size="12">區間上緣 {{ chart().upper | number:'1.0-2' }}</text><text x="45" [attr.y]="chart().lowerY+16" fill="#bce8ff" font-size="12">區間下緣 {{ chart().lower | number:'1.0-2' }}</text> }
      <path [attr.d]="chart().path" fill="none" stroke="#66d5c0" stroke-width="2"/>
      @if (chart().eventX !== undefined) { <line [attr.x1]="chart().eventX" [attr.x2]="chart().eventX" y1="25" y2="210" stroke="#ffcf80" stroke-dasharray="3 4"/><text [attr.x]="chart().eventX! > 580 ? chart().eventX!-100 : chart().eventX!+5" y="18" fill="#ffcf80" font-size="12">事件 {{ selection().event?.date || selection().stock.eventDate }}</text> }
      <text x="40" y="232" fill="#a9bdd5" font-size="12">{{ selection().stock.history[0]?.date }}</text><text x="720" y="232" text-anchor="end" fill="#a9bdd5" font-size="12">{{ selection().stock.date }}</text>
    </svg>
    @if (snapshot() && chart().lower === undefined) { <p class="notice">區間辨識日已超出這次歷史資料範圍，無法換算價格基準。請以上方原始快照判讀。</p> }
    <p class="note">此圖與區間皆使用還原行情，統一換算至 {{ selection().stock.date }} 的價格基準；下方既有 K 線為原始行情。事件標記若超出最近 100 個交易日則不顯示。</p>
    @if (selection().stock.eligible) { <div class="update-grid"><div><span>均線偏離</span><strong>近 5 日均價比近 60 日{{ selection().stock.deviation < 0 ? '低' : '高' }} {{ abs(selection().stock.deviation) | number:'1.1-1' }}%</strong></div><div><span>中期趨勢</span><strong>{{ selection().stock.smaDirection }}</strong></div><div><span>最新成交量／前 20 日均量</span><strong>{{ selection().stock.volumeRatio | number:'1.2-2' }} 倍</strong></div></div> } @else { <p class="notice">{{ selection().stock.exclusion }}；目前無有效指標，先核對行情再建立模擬交易。</p> }
    @if (selection().event?.volumeRatio !== undefined) { <p>觸發當日量比：{{ selection().event!.volumeRatio | number:'1.2-2' }} 倍。{{ selection().event!.volumeRatio! >= 1.5 ? '達初始量能觀察門檻，仍不保證突破成功。' : '未達初始 1.5 倍量能觀察門檻。' }}</p> }
    <details class="rules"><summary>進階：公式與區間版本</summary><p>SMA5 {{ selection().stock.sma5 | number:'1.2-2' }} 元；SMA60 {{ selection().stock.sma60 | number:'1.2-2' }} 元。R = SMA5／SMA60 = {{ selection().stock.ratio | number:'1.3-3' }}；偏離率 = (R−1) × 100%。SMA60 方向相對 10 個交易日前計算。</p><p>區間版本 {{ snapshot()?.version || store.feed()?.rules?.version }}。偏離僅是均價差異，不是估值、買賣建議或投資評分。</p></details>
    <div class="actions"><button type="button" (click)="simulate.emit()">建立模擬交易</button><button type="button" (click)="back.emit()">返回提醒中心</button></div><p class="note">只帶入股票及提醒來源；價格、數量、停損請在既有表單自行確認，再建立模擬記錄。</p>
  </section>
`})
export class AlertDetail {
  readonly selection = input.required<AlertSelection>();
  readonly simulate = output<void>(); readonly back = output<void>();
  readonly store = inject(AlertStore);
  readonly abs = Math.abs;
  readonly snapshot = computed(()=>this.selection().event?.range || this.selection().stock.range);
  readonly chart = computed(()=>{
    const {stock,event} = this.selection(), bars = stock.history, range = this.snapshot();
    const anchor = bars.find(b=>b.date===range?.date);
    const factor = range && anchor ? anchor.close/range.anchorClose : undefined;
    const lower = factor !== undefined ? range!.lower*factor : undefined, upper = factor !== undefined ? range!.upper*factor : undefined;
    const min = Math.min(...bars.map(b=>b.close),lower ?? Infinity), max = Math.max(...bars.map(b=>b.close),upper ?? -Infinity);
    const span = Math.max(max-min,1), y = (price:number)=>205-(price-min)/span*170;
    const x = (i:number)=>40+i/Math.max(bars.length-1,1)*680;
    const index = bars.findIndex(b=>b.date===(event?.date || stock.eventDate));
    return {lower,upper,lowerY:lower===undefined ? 0 : y(lower),upperY:upper===undefined ? 0 : y(upper),eventX:index<0 ? undefined : x(index),
      path:bars.map((b,i)=>`${i ? 'L':'M'} ${x(i)} ${y(b.close)}`).join(' ')};
  });
}
