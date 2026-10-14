import { isTradingDate } from './trading-calendar';
export type IntradaySession='preopen'|'open'|'closed'|'nontrading';
export function intradaySession(now=new Date()):{state:IntradaySession;date:string;label:string}{
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(part=>[part.type,part.value]));
 const date=`${parts['year']}-${parts['month']}-${parts['day']}`,minutes=Number(parts['hour'])*60+Number(parts['minute']);
 if(!isTradingDate(date))return {state:'nontrading',date,label:'今日非交易日，盤中更新暫停'};
 if(minutes<9*60)return {state:'preopen',date,label:'尚未開盤，盤中更新將於 09:00 開放'};
 if(minutes<=13*60+35)return {state:'open',date,label:'盤中延遲快照'};
 return {state:'closed',date,label:'今日已收盤，等待正式日線結果'};
}
