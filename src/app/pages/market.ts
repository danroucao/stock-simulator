import { Component, computed, inject, afterNextRender, Injector } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MarketStore } from '../services/market-store';
@Component({
  selector: 'app-market',
  imports: [DecimalPipe, RouterLink],
  styleUrl: './market-pages.scss',
  template: ` <section class="market-page">
    <header>
      <div>
        <h1>市場動向</h1>
        <p>觀察普通股交易集中在哪些官方產業。</p>
      </div>
      <button (click)="store.load()" [disabled]="store.loading()">
        {{ store.loading() ? '讀取中…' : '重新讀取' }}
      </button>
    </header>
    @if(store.freshness()){<p class="notice" role="status">{{store.freshness()}}</p>}@if (store.error()) {
      <p class="notice" role="alert">{{ store.error() }}</p>
    }
    @if (store.feed(); as feed) {
      <p class="status-line">
        行情 {{ feed.date }} · 收盤後更新 · 上市有效 {{ feed.coverage.twse }} 檔／上櫃有效
        {{ feed.coverage.tpex }} 檔 · 分類截至 {{ feed.classificationDate }}
      </p>
      @if (feed.status === 'error') {
        <p class="notice" role="alert">最近掃描失敗，保留原資料日期：{{ feed.message }}</p>
      }
      <p>
        當日占比以本次具有效成交金額的上市＋上櫃普通股總額為分母；ETF
        不納入。成交熱度不是資金淨流入／淨流出，也不是買進評分。
      </p>
      @if (feed.coverage.twse + feed.coverage.tpex < feed.coverage.total) {
        <p class="notice">
          本次為部分涵蓋：{{
            feed.coverage.total - feed.coverage.twse - feed.coverage.tpex
          }}
          檔當日成交資料缺漏。各產業詳列涵蓋率，歷史比較可能不可用。
        </p>
      }
      <div class="summary-grid">
        <div>
          <span>今日交易最集中</span>
          <h2>{{ concentrated()?.industry || '資料不足' }}</h2>
          <p>{{ concentrated()?.share | number: '1.1-1' }}%</p>
        </div>
        <div>
          <span>熱度增加最多</span>
          <h2>{{ increased()?.industry || '尚無可比較資料' }}</h2>
          @if (increased()) {
            <p>+{{ increased()!.changePoints | number: '1.2-2' }} 百分點</p>
          }
        </div>
        <div>
          <span>熱度減少最多</span>
          <h2>{{ decreased()?.industry || '尚無可比較資料' }}</h2>
          @if (decreased()) {
            <p>{{ decreased()!.changePoints | number: '1.2-2' }} 百分點</p>
          }
        </div>
      </div>
      <div class="filters">
        <label
          >排序<select [value]="sort()" (change)="sort.set($any($event.target).value)">
            <option value="turnover">成交金額</option>
            <option value="increase">熱度增加</option>
            <option value="decrease">熱度減少</option>
          </select></label
        >
      </div>
      <div class="heat-bars" aria-label="產業成交占比橫條圖">
        @for (industry of rows(); track industry.industry) {
          <div class="heat-row">
            <a routerLink="/screener" [queryParams]="{ industry: industry.industry }">{{
              industry.industry
            }}</a>
            <div><div class="bar" [style.width.%]="industry.share"></div></div>
            <span>{{ industry.share | number: '1.1-1' }}%</span>
          </div>
        }
      </div>
      <div class="results">
        <table>
          <thead>
            <tr>
              <th>產業</th>
              <th>成交金額／占比</th>
              <th>前 20 日平均／變化</th>
              <th>漲跌家數／涵蓋</th>
              <th>交易集中度</th>
            </tr>
          </thead>
          <tbody>
            @for (i of rows(); track i.industry) {
              <tr>
                <td>
                  <a routerLink="/screener" [queryParams]="{ industry: i.industry }">{{
                    i.industry
                  }}</a>
                </td>
                <td>
                  <span>{{ i.turnover / 100000000 | number: '1.2-2' }} 億元</span
                  ><span>{{ i.share | number: '1.2-2' }}%</span>
                </td>
                <td>
                  @if (i.changePoints === null) {
                    <span>不可比較</span><small>{{ i.comparisonReason }}</small>
                  } @else {
                    <span>近期平均 {{ i.averageShare | number: '1.2-2' }}%</span
                    ><strong
                      >{{ i.changePoints > 0 ? '+' : ''
                      }}{{ i.changePoints | number: '1.2-2' }} 百分點</strong
                    ><small>{{
                      i.changePoints > 0
                        ? '成交占比高於近期平均，交易熱度增加。'
                        : i.changePoints < 0
                          ? '成交占比低於近期平均，交易熱度減少。'
                          : '成交占比與近期平均相近。'
                    }}</small>
                  }
                </td>
                <td>
                  <span>上漲 {{ i.up }} · 下跌 {{ i.down }} · 平盤 {{ i.flat }}</span
                  ><span>比較價未知 {{ i.unknown }}</span
                  ><small>有效成交 {{ i.valid }}／{{ i.total }} 檔</small>
                </td>
                <td>
                  <span
                    >前三大占
                    {{
                      i.concentration === null ? '未知' : (i.concentration | number: '1.1-1') + '%'
                    }}</span
                  >
                  @for (stock of i.top; track stock.symbol) {
                    <a [routerLink]="['/stock', stock.symbol]" [queryParams]="{ from: 'market' }"
                      >{{ stock.symbol }} {{ stock.name }} ·
                      {{ stock.turnover / 100000000 | number: '1.2-2' }} 億</a
                    >
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <details>
        <summary>計算與資料限制</summary>
        <p>
          當日占比＝產業成交金額／同範圍總成交金額。近期平均為前 20
          個交易日每日占比的平均，不含當日；變化以百分點表示。缺漏與分類不一致時不顯示增減。前三大依有效當日金額排序；漲跌優先使用官方比較價。技術指標不可用的股票仍參與有效成交統計。
        </p>
        <p>
          熱度下降不代表股價下跌，熱度增加不代表值得買入。第一版只有官方產業；不猜測 AI
          等跨產業題材。
        </p>
      </details>
    } @else {
      <p role="status">
        {{ store.loading() ? '正在載入市場交易資訊…' : '市場交易資料尚未取得，可重新讀取。' }}
      </p>
    }
    <details>
      <summary>法人資訊</summary>
      <p>本輪尚未加入外資、投信、自營商買賣超。未來會獨立呈現，不與成交熱度混算。</p>
    </details>
  </section>`,
})
export class MarketPage {
  private readonly onHide=()=>{this.store.marketScroll=window.scrollY;try{sessionStorage.setItem('stock-market-view-v1',JSON.stringify({sort:this.sort(),scroll:this.store.marketScroll}));}catch{}};
  readonly store = inject(MarketStore);
  readonly sort = this.store.heatSort;
  private injector = inject(Injector);
  readonly rows = computed(() =>
    [...(this.store.feed()?.industryHeat || [])].sort((a, b) =>
      this.sort() === 'turnover'
        ? b.turnover - a.turnover
        : a.changePoints === null
          ? b.changePoints === null
            ? a.industry.localeCompare(b.industry)
            : 1
          : b.changePoints === null
            ? -1
            : (a.changePoints - b.changePoints) * (this.sort() === 'increase' ? -1 : 1),
    ),
  );
  readonly concentrated = computed(
    () => [...(this.store.feed()?.industryHeat || [])].sort((a, b) => b.turnover - a.turnover)[0],
  );
  readonly increased = computed(
    () =>
      [...(this.store.feed()?.industryHeat || [])]
        .filter((i) => i.changePoints !== null && i.changePoints > 0)
        .sort((a, b) => b.changePoints! - a.changePoints!)[0],
  );
  readonly decreased = computed(
    () =>
      [...(this.store.feed()?.industryHeat || [])]
        .filter((i) => i.changePoints !== null && i.changePoints < 0)
        .sort((a, b) => a.changePoints! - b.changePoints!)[0],
  );
  constructor() {
    try{const view=JSON.parse(sessionStorage.getItem('stock-market-view-v1')||'null');if(view&&['turnover','increase','decrease'].includes(view.sort)){this.sort.set(view.sort);this.store.marketScroll=Math.max(0,view.scroll||0);}}catch{}
    window.addEventListener('pagehide',this.onHide);
    void this.store.load();
    afterNextRender(() => window.scrollTo(0, this.store.marketScroll), { injector: this.injector });
  }
  ngOnDestroy(): void {
    this.onHide();window.removeEventListener('pagehide',this.onHide);
  }
}
