import { writeFileSync } from 'node:fs';
import { buildIcs } from '../site/calendar.js';

writeFileSync(new URL('../site/save-the-date.ics', import.meta.url), buildIcs());
