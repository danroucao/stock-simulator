import { mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export function alertDelivery(feed) {
  const version = `${feed.rules.version}:${feed.marketDate || 'none'}:${feed.scannedAt || 'none'}`;
  return {
    index: { ...feed, historyVersion:version, stocks:feed.stocks.map(stock=>({...stock,history:[]})) },
    histories: { schemaVersion:1, version, stocks:Object.fromEntries(feed.stocks.filter(stock=>stock.eligible && stock.history.length).map(stock=>[stock.symbol,stock.history])) },
  };
}
export async function writeAlertDelivery(output, feed) {
  const { index, histories }=alertDelivery(feed), directory=dirname(output);
  await mkdir(directory,{recursive:true});
  for(const [path,value] of [[output,feed],[join(directory,'history.json'),histories],[join(directory,'index.json'),index]]) {
    await writeFile(path+'.tmp',JSON.stringify(value));await rename(path+'.tmp',path);
  }
}
