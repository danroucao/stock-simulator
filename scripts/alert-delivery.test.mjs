import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertDelivery } from './alert-delivery.mjs';
test('lightweight index preserves events and snapshots while isolating eligible history by version',()=>{
 const feed={rules:{version:'test'},marketDate:'2026-10-08',scannedAt:'2026-10-08T12:00:00Z',events:[{id:'event',range:{lower:47,upper:52}}],stocks:[{symbol:'2330',eligible:true,history:[{date:'2026-10-08',close:50}]},{symbol:'6182',eligible:false,history:[]}]};
 const result=alertDelivery(feed);assert.deepEqual(result.index.events,feed.events);assert.deepEqual(result.index.stocks[0].history,[]);assert.deepEqual(result.histories.stocks['2330'],feed.stocks[0].history);assert.equal(result.histories.version,result.index.historyVersion);assert.equal(result.histories.stocks['6182'],undefined);assert.equal(feed.stocks[0].history.length,1);
 assert.notEqual(alertDelivery({...feed,scannedAt:'2026-10-08T13:00:00Z'}).index.historyVersion,result.index.historyVersion);
});
