import test from 'node:test';
import assert from 'node:assert/strict';
import {residentBudgetFromEnv,residentKindFor} from '../worker/core/resident-budget-policy.ts';
const enabled={RESIDENT_BUDGET_MODE:'split-v1',DAILY_BUDGET_USD:'30'};
test('legacy and explicit OFF preserve the existing ledger contract',()=>{
 for(const mode of [undefined,'','off'])assert.equal(residentBudgetFromEnv({...enabled,RESIDENT_BUDGET_MODE:mode}),undefined);
 assert.throws(()=>residentBudgetFromEnv({...enabled,RESIDENT_BUDGET_MODE:'browser-on'}),/RESIDENT_BUDGET_MODE/);
});
test('trusted split configuration protects the interactive pool and closes the five-day window exactly',()=>{
 const p=residentBudgetFromEnv(enabled);
 assert.equal(p.residentDailyCapUsd,24);assert.equal(p.interactiveDailyCapUsd,6);assert.equal(p.residentHourlyCapUsd,1);
 assert.equal(p.periodCapUsd,150);assert.equal(p.periodStartAt,Date.parse('2026-11-04T00:00:00+09:00'));
 assert.equal(p.periodEndAt-p.periodStartAt,5*86400000);
 assert.equal(residentBudgetFromEnv({...enabled,RESIDENT_MODEL_ENABLED:'false'}).residentEnabled,false);
});
test('invalid or inconsistent server limits fail closed rather than restore an unrestricted fallback',()=>{
 for(const value of ['0','-1','Infinity','not-money'])assert.throws(()=>residentBudgetFromEnv({...enabled,RESIDENT_HOURLY_BUDGET_USD:value}),/RESIDENT_HOURLY/);
 assert.throws(()=>residentBudgetFromEnv({...enabled,DAILY_BUDGET_USD:'20'}),/split_budget_exceeds_daily/);
 assert.throws(()=>residentBudgetFromEnv({...enabled,MODEL_BUDGET_END_AT:'2026-11-03T00:00:00+09:00'}),/period_window/);
 assert.throws(()=>residentBudgetFromEnv({...enabled,RESIDENT_MODEL_ENABLED:'perhaps'}),/RESIDENT_MODEL_ENABLED/);
});
test('only the server-provided peer classification selects the last-resort personal response priority',()=>{
 assert.equal(residentKindFor('spotlight',true),'action');assert.equal(residentKindFor('encounter',false),'chat');
 assert.equal(residentKindFor('encounter',true),'personal');assert.equal(residentKindFor('trade',false),'trade');
 assert.equal(residentKindFor('reflection',false),'reflection');
});
