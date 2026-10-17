// Reads the GPS-camera stamp on own-vehicle trip photos and checks it.
//
// Site staff already take their photos with a GPS / timestamp camera app (the
// same ones they post in the site WhatsApp groups). The app prints the date,
// time and address on the image, e.g.
//   "Sep 4, 2026 9:19:38 AM · 32° NE · Jaypee Greens, Greater Noida,
//    Meerut Division, Uttar Pradesh · Altitude 162.3 m · Speed 0.2 km/h"
// so the photo itself says when and where it was taken. This reads that stamp
// and the odometer digits, and turns them into flags for Finance — it never
// approves anything on its own.
//
// Found while building it: one employee's "start" and "end" odometer photos
// were the same picture (identical stamp, 4 Sep 9:19:38 AM, 25,528.8 km).
import crypto from 'node:crypto';
import { completeJSON } from './llmClient.js';
import { roadDistanceKm } from './travelService.js';
import { supabaseAdmin } from '../config/supabase.js';
import { siteVariants } from '../config/sites.js';

const SITE_RADIUS_KM = 5;      // site photo must be taken within this road distance of the site
const READING_TOLERANCE_KM = 2; // typed reading vs the digits on the odometer photo
const PHOTO_LABEL = { odometer_start: 'start odometer', odometer_end: 'end odometer', site: 'site' };

const stampPrompt = `This photo was taken by an Indian site engineer, usually with a GPS / timestamp camera app that prints the date, time and location on the image.
Read what is printed on the photo and return ONLY this JSON, no other text:
{
  "has_stamp": <true if a date and time are printed on the image by a camera app, else false>,
  "stamp_datetime": <the printed date and time as "YYYY-MM-DD HH:MM:SS" in 24-hour local time, or null>,
  "stamp_address": <the printed place / area / city / state lines joined with ", ", or null — leave out compass, altitude and speed>,
  "latitude": <number or null — only a printed "Lat"/"Latitude" value; a compass bearing like "32° NE" is NOT a latitude>,
  "longitude": <number or null — only a printed "Long"/"Longitude" value>,
  "shows_odometer": <true if a vehicle odometer is visible>,
  "odometer_km": <the vehicle's TOTAL odometer reading as a number (not the trip meter, not the speed). The last wheel is often a differently coloured tenths digit — give it after a decimal point, e.g. digits 2 5 5 2 8 | 8 → 25528.8 — or null if not readable>
}
Never guess a value that is not visible; use null.`;

// Plausible India coordinates only — guards against a compass bearing read as a latitude.
const inIndia = (lat, lng) => lat != null && lng != null && lat >= 6 && lat <= 37 && lng >= 68 && lng <= 98;

/**
 * The model sometimes merges the odometer's tenths wheel into the whole number
 * (25528 | 8 read as 255288). Of the reading and that reading ÷ 10, take the one
 * nearer to what the employee typed.
 */
function bestReading(read, typed) {
  if (read == null) return null;
  const candidates = [read, Math.round((read / 10) * 10) / 10];
  return candidates.reduce((best, c) => (Math.abs(c - typed) < Math.abs(best - typed) ? c : best));
}

/** Reads one photo's stamp and odometer. Never throws — null fields when unreadable. */
async function readPhoto(file) {
  try {
    const { data } = await completeJSON({
      text: stampPrompt,
      files: [{ buffer: file.buffer, mimetype: file.mimetype }],
      maxTokens: 300,
      purpose: 'ocr',
    });
    if (!data) return { read: false };
    const num = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
    const lat = num(data.latitude);
    const lng = num(data.longitude);
    const coords = inIndia(lat, lng);
    return {
      read: true,
      hasStamp: !!data.has_stamp && !!data.stamp_datetime,
      takenAt: typeof data.stamp_datetime === 'string' ? data.stamp_datetime.trim() : null,
      address: typeof data.stamp_address === 'string' && data.stamp_address.trim() ? data.stamp_address.trim() : null,
      lat: coords ? lat : null,
      lng: coords ? lng : null,
      showsOdometer: !!data.shows_odometer,
      odometerKm: num(data.odometer_km),
    };
  } catch (e) {
    console.warn('[trip-photo] read failed:', e.message);
    return { read: false };
  }
}

/** Where the site is: the trip's destination, else the project's address, else its name. */
async function siteLocation(imprest) {
  if (imprest.travel_to?.trim()) return imprest.travel_to.trim();
  try {
    const { data } = await supabaseAdmin.schema('public').from('projects')
      .select('site_address').in('name', await siteVariants(imprest.site)).not('site_address', 'is', null).limit(1);
    if (data?.[0]?.site_address) return data[0].site_address;
  } catch { /* fall through to the name */ }
  return imprest.site ? `${imprest.site}, India` : null;
}

const dayOf = (takenAt) => (takenAt ? takenAt.slice(0, 10) : null);
const daysApart = (a, b) => Math.abs((new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`)) / 86400000);

/**
 * Checks the three trip photos (in OWN_VEHICLE_PHOTO_ROLES order).
 * Returns { error } to refuse the submission, else { photos, flags, checks }.
 */
export async function checkTripPhotos({ files, roles, imprest, employeeId, startKm, endKm }) {
  // The same file twice is never a mistake worth sending to Finance.
  const hashes = files.map((f) => crypto.createHash('sha1').update(f.buffer).digest('hex'));
  if (new Set(hashes).size !== hashes.length) {
    return { error: 'Ek hi photo do baar lagayi hai. Teeno alag photo honi chahiye. / The same photo is attached twice — all three must be different.' };
  }

  const reads = await Promise.all(files.map(readPhoto));
  const photos = reads.map((r, i) => ({ role: roles[i], ...r }));

  // If the photos could be read but not one carries a stamp, these are not
  // GPS-camera photos — tell the employee now rather than leave it to Finance.
  const readable = photos.filter((p) => p.read);
  if (readable.length === photos.length && readable.every((p) => !p.hasStamp)) {
    return { error: 'GPS camera wali photo upload karein — photo par date, time aur location likha hona chahiye (jaise WhatsApp group me bhejte hain). / Upload GPS-camera photos showing the date, time and location.' };
  }

  const flags = [];
  const checks = [];
  const label = (p) => PHOTO_LABEL[p.role] || p.role;

  for (const p of photos) {
    if (!p.read) {
      flags.push(`The ${label(p)} photo could not be read — check it by eye`);
    } else if (!p.hasStamp) {
      flags.push(`No date/time/location stamp on the ${label(p)} photo`);
    }
  }

  const [start, end, site] = photos;

  // Start and end must be two different moments, start first.
  if (start.takenAt && end.takenAt) {
    if (start.takenAt === end.takenAt) {
      flags.push(`Start and end odometer photos have the same stamp (${start.takenAt}) — the same picture used twice`);
      checks.push({ step: 'photo_times', result: 'fail', score: 0, detail: `Start and end both stamped ${start.takenAt}` });
    } else if (end.takenAt < start.takenAt) {
      flags.push(`End odometer photo (${end.takenAt}) is stamped before the start photo (${start.takenAt})`);
      checks.push({ step: 'photo_times', result: 'fail', score: 0, detail: `End ${end.takenAt} before start ${start.takenAt}` });
    } else {
      checks.push({ step: 'photo_times', result: 'pass', score: 1, detail: `Start ${start.takenAt} → end ${end.takenAt}` });
    }
  }

  // Photos must be from the trip day (±1 day for an overnight trip).
  if (imprest.travel_date) {
    const off = photos.filter((p) => p.takenAt && daysApart(dayOf(p.takenAt), imprest.travel_date) > 1);
    if (off.length) {
      flags.push(`${off.map((p) => `${label(p)} photo dated ${dayOf(p.takenAt)}`).join(', ')} — trip date is ${imprest.travel_date}`);
      checks.push({ step: 'photo_dates', result: 'fail', score: 0, detail: `Trip date ${imprest.travel_date}` });
    } else if (photos.some((p) => p.takenAt)) {
      checks.push({ step: 'photo_dates', result: 'pass', score: 1, detail: `Photos dated on the trip date ${imprest.travel_date}` });
    }
  }

  // The site visit belongs to the trip: same day(s) as the odometer photos.
  if (site.takenAt && start.takenAt && end.takenAt) {
    const first = dayOf(start.takenAt < end.takenAt ? start.takenAt : end.takenAt);
    const last = dayOf(start.takenAt < end.takenAt ? end.takenAt : start.takenAt);
    const siteDay = dayOf(site.takenAt);
    if (siteDay < first || siteDay > last) {
      flags.push(`Site photo is dated ${siteDay} but the odometer photos are from ${first === last ? first : `${first} to ${last}`}`);
      checks.push({ step: 'site_photo_day', result: 'fail', score: 0, detail: `Site ${siteDay}, trip ${first}–${last}` });
    }
  }

  // Typed readings vs the digits on the odometer photos.
  for (const [p, typed] of [[start, startKm], [end, endKm]]) {
    if (!p.read) continue;
    p.odometerKm = bestReading(p.odometerKm, typed);
    if (!p.showsOdometer) {
      flags.push(`The ${label(p)} photo does not show an odometer`);
    } else if (p.odometerKm != null && Math.abs(p.odometerKm - typed) > READING_TOLERANCE_KM) {
      flags.push(`Typed ${typed} km but the ${label(p)} photo reads ${p.odometerKm} km`);
      checks.push({ step: 'odometer_match', result: 'fail', score: 0, detail: `${label(p)}: typed ${typed}, photo ${p.odometerKm}` });
    } else if (p.odometerKm != null) {
      checks.push({ step: 'odometer_match', result: 'pass', score: 1, detail: `${label(p)}: typed ${typed}, photo ${p.odometerKm}` });
    }
  }

  // The site photo must be taken at the site.
  if (site.read && (site.address || (site.lat != null && site.lng != null))) {
    const at = site.lat != null && site.lng != null ? `${site.lat},${site.lng}` : site.address;
    const target = await siteLocation(imprest);
    const km = target ? await roadDistanceKm(at, target) : null;
    site.siteTarget = target;
    site.distanceToSiteKm = km;
    if (km == null) {
      flags.push(`Could not work out how far the site photo location (${site.address || at}) is from the site`);
    } else if (km > SITE_RADIUS_KM) {
      flags.push(`Site photo taken at ${site.address || at}, about ${km} km from the site (${target})`);
      checks.push({ step: 'site_location', result: 'fail', score: 0, detail: `${km} km from ${target}` });
    } else {
      checks.push({ step: 'site_location', result: 'pass', score: 1, detail: `Site photo within ${km} km of ${target}` });
    }
  }

  // A stamp that already settled another trip is the same photo claimed twice.
  const stamps = photos.map((p) => p.takenAt).filter(Boolean);
  if (stamps.length) {
    const since = new Date(Date.now() - 180 * 86400000).toISOString();
    const { data: earlier } = await supabaseAdmin
      .from('expenses')
      .select('ref_id, screenshot_metadata')
      .eq('employee_id', employeeId)
      .eq('ai_model', 'odometer-rules')
      .not('status', 'eq', 'rejected')
      .gte('submitted_at', since);
    for (const e of earlier || []) {
      const used = (e.screenshot_metadata?.ownVehicle?.photos || []).map((p) => p.takenAt).filter(Boolean);
      const reused = stamps.find((s) => used.includes(s));
      if (reused) flags.push(`A photo stamped ${reused} was already used in ${e.ref_id}`);
    }
  }

  // What is kept on the expense — no image data, just what was read.
  const kept = photos.map(({ role, read, hasStamp, takenAt, address, lat, lng, odometerKm, distanceToSiteKm, siteTarget }) => ({
    role, read, hasStamp, takenAt, address, lat, lng, odometerKm,
    ...(role === 'site' && { distanceToSiteKm: distanceToSiteKm ?? null, siteTarget: siteTarget ?? null }),
  }));

  return { photos: kept, flags, checks };
}
