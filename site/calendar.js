export const SITE_URL = 'https://emilija-dominykas.netlify.app';
export const ICS_PATH = '/save-the-date.ics';

export const EVENT = {
  title: 'Emilijos ir Dominyko vestuvės',
  date: '2027-08-20',
  description: 'Kvietimą atsiųsime vėliau.\n' + SITE_URL + '/',
  uid: '20270820-emilija-dominykas@emilija-dominykas.netlify.app',
  stamp: '20261108T000000Z',
};

const compact = (d) => d.replaceAll('-', '');

function nextDay(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function escapeText(s) {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

const encoder = new TextEncoder();

// Fold at 75 octets; continuation lines start with a space (counted in their limit).
function fold(line) {
  const parts = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    if (bytes + n > limit) {
      parts.push(current);
      current = ' ';
      bytes = 1;
      limit = 75;
    }
    current += ch;
    bytes += n;
  }
  parts.push(current);
  return parts.join('\r\n');
}

export function buildIcs(event = EVENT) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Emilija ir Dominykas//Save the date//LT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${event.stamp}`,
    `DTSTART;VALUE=DATE:${compact(event.date)}`,
    `DTEND;VALUE=DATE:${compact(nextDay(event.date))}`,
    `SUMMARY:${escapeText(event.title)}`,
    `DESCRIPTION:${escapeText(event.description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function googleCalendarUrl(event = EVENT) {
  const dates = `${compact(event.date)}/${compact(nextDay(event.date))}`;
  const q = [
    ['action', 'TEMPLATE'],
    ['text', event.title],
    ['dates', dates],
    ['details', event.description],
  ]
    .map(([k, v]) => `${k}=${encodeURIComponent(v).replace('%2F', '/')}`)
    .join('&');
  return `https://calendar.google.com/calendar/render?${q}`;
}

export function isAndroid(userAgent) {
  return /Android/i.test(userAgent);
}

export function calendarLinks(userAgent) {
  const ics = { href: ICS_PATH, external: false };
  const google = { href: googleCalendarUrl(), external: true };
  return isAndroid(userAgent)
    ? { primary: { ...google, label: 'Pridėti į kalendorių' }, secondary: { ...ics, label: 'Kitas kalendorius' } }
    : { primary: { ...ics, label: 'Pridėti į kalendorių' }, secondary: { ...google, label: 'Google kalendorius' } };
}
