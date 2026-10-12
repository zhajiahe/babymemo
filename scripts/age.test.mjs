import test from 'node:test';
import assert from 'node:assert/strict';
import {ageLabel} from '../src/lib/age.mjs';
test('local birth time influences age',()=>{
 assert.equal(ageLabel('2025-05-30','10:30','Asia/Shanghai',new Date('2025-05-30T02:15:00Z')),'尚未出生');
 assert.equal(ageLabel('2025-05-30','10:30','Asia/Shanghai',new Date('2025-05-30T03:30:00Z')),'1 小时');
 assert.equal(ageLabel('2025-05-30','10:30','Asia/Shanghai',new Date('2025-05-31T03:30:00Z')),'1 天');
});
test('calendar months respect short months',()=>{
 assert.equal(ageLabel('2026-01-31','','Asia/Shanghai',new Date('2026-02-28T08:00:00Z')),'1 个月');
 assert.equal(ageLabel('2026-01-31','','Asia/Shanghai',new Date('2026-03-02T08:00:00Z')),'1 个月 2 天');
});
test('old babies without time remain valid',()=>{
 assert.match(ageLabel('2025-05-30','','Asia/Shanghai',new Date('2026-10-12T16:00:00Z')),/^16 个月/);
});
