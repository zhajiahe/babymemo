import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduledReportPeriods,reportPeriod} from '../src/family-report-schedule.mjs';

test('weekly report is the current local Monday-Sunday, monthly report is last complete month',()=>{
 assert.deepEqual(reportPeriod('week','2026-10-18'),{kind:'week',start:'2026-10-12',end:'2026-10-18'});
 assert.deepEqual(reportPeriod('month','2026-11-01'),{kind:'month',start:'2026-10-01',end:'2026-10-31'});
 assert.deepEqual(reportPeriod('month','2026-03-01'),{kind:'month',start:'2026-02-01',end:'2026-02-28'});
});
test('reports run on recipient configured local calendar, not UTC',()=>{
 const sunday=new Date('2026-10-18T12:05:00Z');
 assert.deepEqual(scheduledReportPeriods(sunday,'Asia/Shanghai',20),[{kind:'week',start:'2026-10-12',end:'2026-10-18'}]);
 assert.deepEqual(scheduledReportPeriods(sunday,'America/Los_Angeles',20),[]);
 assert.deepEqual(scheduledReportPeriods(new Date('2026-11-01T12:03:00Z'),'Asia/Shanghai',20),[
  {kind:'week',start:'2026-10-26',end:'2026-11-01'},
  {kind:'month',start:'2026-10-01',end:'2026-10-31'}
 ]);
});
test('daylight saving spring-forward does not affect date range',()=>{
 assert.deepEqual(scheduledReportPeriods(new Date('2026-03-08T18:00:00Z'),'America/Los_Angeles',12),[]);
 assert.deepEqual(scheduledReportPeriods(new Date('2026-03-08T20:00:00Z'),'America/Los_Angeles',12),[
  {kind:'week',start:'2026-03-02',end:'2026-03-08'}
 ]);
});
