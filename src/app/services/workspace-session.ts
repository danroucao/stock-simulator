import { Injectable } from '@angular/core';
@Injectable({ providedIn: 'root' })
export class WorkspaceSession {
  raw: string | null = null;
  baseline: string | null = null;
  stored: string | null = null;
}
