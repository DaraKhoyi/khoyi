import { todayNY, dayNY, startOfDayNY, endOfDayNY, offsetMinutesNY, daysBetweenNY } from '../src/clock.js';
let fail = 0;
const ok = (name, got, want) => {
  const good = String(got) === String(want);
  if (!good) fail++;
  console.log((good ? '  ok   ' : '  FAIL ') + name + ' -> ' + got + (good ? '' : '   expected ' + want));
};
console.log('The evening rollover — the actual bug:');
ok('11:30pm NY Sep 8 is Sep 8', dayNY(new Date('2026-09-09T03:30:00Z')), '2026-09-08');
ok('12:30am NY Sep 9 is Sep 9', dayNY(new Date('2026-09-09T04:30:00Z')), '2026-09-09');

console.log('DST, both directions:');
ok('offset in July is -240 (EDT)', offsetMinutesNY(new Date('2026-07-01T12:00:00Z')), -240);
ok('offset in January is -300 (EST)', offsetMinutesNY(new Date('2026-01-15T12:00:00Z')), -300);
ok('spring forward day starts 05:00Z', startOfDayNY(new Date('2026-03-08T18:00:00Z')).toISOString(), '2026-03-08T05:00:00.000Z');
ok('fall back day starts 04:00Z', startOfDayNY(new Date('2026-11-01T12:00:00Z')).toISOString(), '2026-11-01T04:00:00.000Z');
ok('a winter day starts 05:00Z', startOfDayNY(new Date('2026-01-15T18:00:00Z')).toISOString(), '2026-01-15T05:00:00.000Z');

console.log('Day boundaries:');
ok('end of day is 1ms before midnight', endOfDayNY(new Date('2026-09-08T18:00:00Z')).toISOString(), '2026-09-09T03:59:59.999Z');
ok('overnight span counts as 1 day', daysBetweenNY(new Date('2026-09-08T23:00:00-04:00'), new Date('2026-09-09T01:00:00-04:00')), 1);
ok('same evening counts as 0 days', daysBetweenNY(new Date('2026-09-08T18:00:00-04:00'), new Date('2026-09-08T23:00:00-04:00')), 0);

console.log('Device zone must not matter:');
const inst = new Date('2026-09-09T03:30:00Z');
for (const tz of ['America/New_York','Europe/Budapest','Asia/Tokyo','Pacific/Auckland']) {
  process.env.TZ = tz;
  ok('device ' + tz + ' still reads Sep 8', dayNY(inst), '2026-09-08');
}
console.log(fail ? '\nFAILED ' + fail : '\nALL PASS');
process.exit(fail ? 1 : 0);
