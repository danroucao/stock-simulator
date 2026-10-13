import { Routes } from '@angular/router';

export const routes: Routes = [
  ...Object.entries({
    'alert-center': 'alerts',
    'market-chart': 'stock/2330',
    'strategy-board': 'stock/2330',
    'holdings-center': 'trades',
    'fill-history-title': 'trades',
    'risk-analysis': 'overview',
    'workspace-settings': 'settings',
  }).map(([path, redirectTo]) => ({ path, redirectTo, pathMatch: 'full' as const })),
  { path: 'market', loadComponent: () => import('./pages/market').then((m) => m.MarketPage) },
  { path: 'screener', loadComponent: () => import('./pages/screener').then((m) => m.Screener) },
  { path: 'alerts', loadComponent: () => import('./pages/alerts').then((m) => m.AlertsPage) },
  {
    path: '',
    loadComponent: () => import('./app').then((m) => m.App),
    children: [
      { path: 'overview', loadComponent: () => import('./pages/empty').then((m) => m.EmptyRoute) },
      {
        path: 'stock/:symbol',
        loadComponent: () => import('./pages/empty').then((m) => m.EmptyRoute),
      },
      { path: 'trades', loadComponent: () => import('./pages/empty').then((m) => m.EmptyRoute) },
      { path: 'settings', loadComponent: () => import('./pages/empty').then((m) => m.EmptyRoute) },
      { path: '', redirectTo: 'overview', pathMatch: 'full' },
    ],
  },
  { path: '**', redirectTo: 'overview' },
];
