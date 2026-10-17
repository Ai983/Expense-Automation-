// Own-vehicle (bike / car) conveyance expenses.
//
// The employee rides their own vehicle and is paid per km, so there is no bill
// or UPI payment to prove. The receipt OCR and the AI auditor both look for a
// payment and rejected every honest claim (8 blocked submissions on one ₹1,180
// bike trip). Proof here is three photos — odometer at the start, odometer at
// the end, and one at the site — plus the two readings, checked by fixed rules:
//
//   km        = end reading − start reading
//   max claim = km × rate (Bike ₹5 / Car ₹10 per km)
//   flag      = km more than OWN_VEHICLE_KM_TOLERANCE over the planned route,
//               or no planned route saved on the imprest
//
// Nothing is auto-approved: a person still looks at the photos, because the
// readings on them are typed by the employee. A clean claim reaches Finance
// marked "checks passed"; a flagged one marked "needs review".
import { OWN_VEHICLE_RATE_PER_KM, OWN_VEHICLE_KM_TOLERANCE } from '../config/constants.js';

export const OWN_VEHICLE_PHOTO_ROLES = ['odometer_start', 'odometer_end', 'site'];
const MAX_TRIP_KM = 3000; // a single claim above this is a typo, not a trip

/** True when the imprest was raised as own-vehicle conveyance. */
export function isOwnVehicleImprest(imprest) {
  return imprest?.category === 'Conveyance' && imprest?.conveyance_mode === 'Own Vehicle';
}

export function ownVehicleRate(vehicleType) {
  return OWN_VEHICLE_RATE_PER_KM[vehicleType] ?? OWN_VEHICLE_RATE_PER_KM.Bike;
}

/**
 * Validates and scores an own-vehicle claim.
 * Returns { error } when the claim cannot be accepted as entered (the employee
 * fixes it on the spot), otherwise { km, rate, maxAmount, plannedKm, flags, checks, reasoning }.
 */
export function evaluateOwnVehicleClaim({ startKm, endKm, amount, vehicleType, plannedKm, files }) {
  const start = parseFloat(startKm);
  const end = parseFloat(endKm);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0) {
    return { error: 'Odometer ki start aur end reading (km) bharein. / Enter the start and end odometer readings.' };
  }
  if (end <= start) {
    return { error: 'End reading start reading se zyada honi chahiye. / The end reading must be more than the start reading.' };
  }
  const km = Math.round((end - start) * 10) / 10;
  if (km > MAX_TRIP_KM) {
    return { error: `${km} km ek trip ke liye bahut zyada hai — reading check karein. / ${km} km is too much for one trip — check the readings.` };
  }
  if (!files || files.length !== OWN_VEHICLE_PHOTO_ROLES.length || files.some((f) => !f.mimetype?.startsWith('image/'))) {
    return { error: 'Teeno photo zaroori hain: start odometer, end odometer aur site ki photo. / All three photos are required: start odometer, end odometer and a photo at the site.' };
  }

  const rate = ownVehicleRate(vehicleType);
  const maxAmount = Math.round(km * rate);
  if (parseFloat(amount) > maxAmount + 1) {
    return { error: `${km} km × ₹${rate}/km = ₹${maxAmount}. Isse zyada claim nahi kar sakte. / You can claim at most ₹${maxAmount} for ${km} km.` };
  }

  const planned = parseFloat(plannedKm);
  const hasPlan = Number.isFinite(planned) && planned > 0;
  const flags = [];
  const checks = [
    { step: 'odometer_readings', result: 'pass', score: 1, detail: `${start} → ${end} km = ${km} km` },
    { step: 'amount_vs_km', result: 'pass', score: 1, detail: `Claimed ₹${amount} ≤ ${km} km × ₹${rate}/km = ₹${maxAmount}` },
  ];
  if (!hasPlan) {
    flags.push('No planned route on the imprest — distance could not be compared');
    checks.push({ step: 'route_distance', result: 'warn', score: 0.5, detail: 'No planned route saved on the imprest' });
  } else if (km > planned * (1 + OWN_VEHICLE_KM_TOLERANCE)) {
    flags.push(`Rode ${km} km but the planned route is ${planned} km (${Math.round((km / planned - 1) * 100)}% more)`);
    checks.push({ step: 'route_distance', result: 'fail', score: 0, detail: `${km} km ridden vs ${planned} km planned` });
  } else {
    checks.push({ step: 'route_distance', result: 'pass', score: 1, detail: `${km} km ridden vs ${planned} km planned` });
  }
  checks.push({ step: 'trip_photos', result: 'pass', score: 1, detail: 'Odometer start, odometer end and site photo attached' });

  const result = { km, rate, maxAmount, plannedKm: hasPlan ? planned : null, flags, checks, startKm: start, endKm: end, vehicleType: vehicleType || 'Bike' };
  return { ...result, reasoning: ownVehicleReasoning(result) };
}

/** The note Finance reads — rebuilt whenever more flags are added (e.g. by the photo checks). */
export function ownVehicleReasoning({ km, rate, maxAmount, plannedKm, flags, startKm, endKm, vehicleType }) {
  const head = `Own ${vehicleType} trip: ${km} km at ₹${rate}/km allows ₹${maxAmount}`;
  return flags.length
    ? `${head}. Needs review — ${flags.join('; ')}.`
    : `${head}; within the planned ${plannedKm} km route, photos stamped on the trip day at the site. Checks passed — confirm the odometer photos read ${startKm} and ${endKm} km, then approve.`;
}
