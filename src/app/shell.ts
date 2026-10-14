import { Component, signal, inject, OnInit } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet, NavigationEnd, Scroll } from '@angular/router';
import { ViewportScroller } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  styleUrl: './shell.scss',
  template: `<header class="site-header">
      <a class="brand" routerLink="/overview">股票觀察與模擬交易</a
      ><button
        class="menu"
        (click)="expanded.set(!expanded())"
        [attr.aria-expanded]="expanded()"
        aria-controls="main-nav"
      >
        {{ expanded() ? '收合導覽' : '功能選單' }}
      </button>
      <nav id="main-nav" [class.open]="expanded()" aria-label="主要導覽">
        @for (item of items; track item.path) {
          <a [routerLink]="item.path" routerLinkActive="active" ariaCurrentWhenActive="page">{{
            item.name
          }}</a>
        }
      </nav>
    </header>
    <div class="route-status" role="status">{{ loading() ? '正在切換頁面…' : '' }}</div>
    <router-outlet />`,
})
export class Shell implements OnInit {

  readonly expanded = signal(false);
  readonly loading = signal(false);
  private router = inject(Router);
  private viewport = inject(ViewportScroller);
  readonly items = [
    { path: '/overview', name: '總覽' },
    { path: '/market', name: '市場動向' },
    { path: '/screener', name: '選股中心' },
    { path: '/alerts', name: '提醒中心' },
    { path: '/stock/2330', name: '個股分析' },
    { path: '/trades', name: '持倉與交易' },
    { path: '/settings', name: '設定' },
  ];
  constructor() {
    this.viewport.setHistoryScrollRestoration('manual');
    this.router.events.pipe(takeUntilDestroyed()).subscribe((e) => {
      // List pages restore after their data renders; URL synchronization must not reset them.
      if (e instanceof Scroll && !['/screener','/market','/alerts'].some(path => this.router.url.split('?')[0] === path)) {
        this.viewport.scrollToPosition(e.position ?? [0,0]);
      }
      if (e instanceof NavigationEnd) {
        const symbol=/^\/stock\/(\d{4,6})/.exec(e.urlAfterRedirects)?.[1];if(symbol){const item=this.items.find(i=>i.name==='個股分析');if(item)item.path='/stock/'+symbol;}
        this.expanded.set(false);
        this.loading.set(false);
        document.title =
          (this.items.find((i) => e.urlAfterRedirects.startsWith(i.path))?.name || '個股分析') +
          '｜股票觀察';
      } else if (e.constructor.name === 'NavigationStart') this.loading.set(true);
      else if (['NavigationCancel', 'NavigationError'].includes(e.constructor.name))
        this.loading.set(false);
    });
  }
  ngOnInit(): void {
    const old = location.hash.slice(1),
      paths: Record<string, string> = {
        'alert-center': '/alerts',
        'market-chart': '/stock/2330',
        'strategy-board': '/stock/2330',
        'holdings-center': '/trades',
        'fill-history-title': '/trades',
        'risk-analysis': '/overview',
        'workspace-settings': '/settings',
      };
    if (paths[old]) void this.router.navigateByUrl(paths[old], { replaceUrl: true });
  }
}
