import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT, SITE_URL, ICS_PATH, buildIcs, googleCalendarUrl, calendarLinks } from '../../site/calendar.js';

const unfold = (s) => s.replace(/\r\n[ \t]/g, '');

test('ics is an all-day floating event on 2027-08-20', () => {
  const ics = buildIcs();
  assert.match(ics, /\r\nDTSTART;VALUE=DATE:20270820\r\n/);
  assert.match(ics, /\r\nDTEND;VALUE=DATE:20270821\r\n/);
  assert.doesNotMatch(ics, /TZID|LOCATION|VALARM/);
});
test('ics has required envelope properties', () => {
  const ics = buildIcs();
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  for (const p of ['PRODID:', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT', `UID:${EVENT.uid}`, `DTSTAMP:${EVENT.stamp}`, 'END:VEVENT'])
    assert.ok(ics.includes(p), p);
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
});
test('ics uses CRLF only', () => assert.doesNotMatch(buildIcs().replace(/\r\n/g, ''), /[\r\n]/));
test('ics keeps Lithuanian title intact', () => assert.ok(unfold(buildIcs()).includes('SUMMARY:Emilijos ir Dominyko vestuvės')));
test('ics escapes description newline and special chars', () => {
  const ics = unfold(buildIcs({ ...EVENT, description: 'a,b;c\\d\ne' }));
  assert.ok(ics.includes('DESCRIPTION:a\\,b\\;c\\\\d\\ne'));
});
test('ics folds lines at 75 octets without splitting UTF-8 characters', () => {
  const long = 'ąčęėįšųūž'.repeat(20);
  const ics = buildIcs({ ...EVENT, description: long });
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line);
  assert.ok(unfold(ics).includes(`DESCRIPTION:${long}`));
});
test('google url carries title, dates and details', () => {
  const u = new URL(googleCalendarUrl());
  assert.equal(u.origin + u.pathname, 'https://calendar.google.com/calendar/render');
  assert.equal(u.searchParams.get('action'), 'TEMPLATE');
  assert.equal(u.searchParams.get('text'), 'Emilijos ir Dominyko vestuvės');
  assert.equal(u.searchParams.get('dates'), '20270820/20270821');
  assert.equal(u.searchParams.get('details'), EVENT.description);
});

const UA = {
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipadAsMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  instagramIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0',
  messengerAndroid: 'Mozilla/5.0 (Linux; Android 13; SM-S911B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/460.0]',
};
const ICS = { href: ICS_PATH, external: false };
const GOOGLE = { href: googleCalendarUrl(), external: true };

test('android: google primary, other-calendar ics secondary', () => {
  assert.deepEqual(calendarLinks(UA.android), {
    primary: { ...GOOGLE, label: 'Pridėti į kalendorių' },
    secondary: { ...ICS, label: 'Kitas kalendorius' },
  });
});
for (const k of ['iphone', 'ipadAsMac', 'desktop', '']) {
  test(`${k || 'empty UA'}: ics primary, google secondary`, () => {
    assert.deepEqual(calendarLinks(UA[k] ?? ''), {
      primary: { ...ICS, label: 'Pridėti į kalendorių' },
      secondary: { ...GOOGLE, label: 'Google kalendorius' },
    });
  });
}
test('in-app browser user agents', () => {
  assert.equal(calendarLinks(UA.instagramIos).primary.href, ICS_PATH);
  assert.equal(calendarLinks(UA.messengerAndroid).primary.href, googleCalendarUrl());
});
test('SITE_URL has no trailing slash', () => assert.ok(!SITE_URL.endsWith('/')));
