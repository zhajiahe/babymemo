import test from 'node:test';
import assert from 'node:assert/strict';
import {ageOnDay} from '../src/wechat-answer.mjs';
test('calendar age from a date of birth without intent-specific pattern matching',()=>{
 assert.deepEqual(ageOnDay('2025-05-30','2026-10-13'),{years:1,months:4,remainderDays:13,days:501});
 assert.deepEqual(ageOnDay('2024-01-31','2024-02-29'),{years:0,months:1,remainderDays:0,days:29});
 assert.deepEqual(ageOnDay('2024-02-29','2025-02-28'),{years:1,months:0,remainderDays:0,days:365});
 assert.equal(ageOnDay('2026-10-14','2026-10-13'),null);
 assert.equal(ageOnDay('2025-02-30','2026-10-13'),null);
});
