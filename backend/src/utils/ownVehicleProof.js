// Own-vehicle (bike / car) conveyance expenses.
//
// The employee rides their own vehicle and is paid per km, so there is no bill
// or UPI payment to prove. The receipt OCR and the AI auditor both look for a
// payment, so they blocked every honest claim (8 blocked submissions on one
// ₹1,180 bike trip) — the reminder then expired and the employee was locked out
// of new imprests. These expenses go straight to a person instead: the employee
// describes the trip (from, to, purpose, km) and Finance reviews it.
import { OWN_VEHICLE_RATE_PER_KM } from '../config/constants.js';

// Short descriptions ("bike", "petrol") give Finance nothing to review.
export const OWN_VEHICLE_MIN_DESCRIPTION = 20;

/** True when the imprest was raised as own-vehicle conveyance. */
export function isOwnVehicleImprest(imprest) {
  return imprest?.category === 'Conveyance' && imprest?.conveyance_mode === 'Own Vehicle';
}

export function ownVehicleRate(vehicleType) {
  return OWN_VEHICLE_RATE_PER_KM[vehicleType] ?? OWN_VEHICLE_RATE_PER_KM.Bike;
}

/** What Finance sees next to the employee's description. */
export function ownVehicleReview(imprest) {
  const vehicleType = imprest.vehicle_type || 'Bike';
  const rate = ownVehicleRate(vehicleType);
  const plannedKm = imprest.ai_estimated_distance_km != null ? Number(imprest.ai_estimated_distance_km) : null;
  const estimate = plannedKm ? Math.round(plannedKm * rate) : null;
  const route = imprest.travel_from || imprest.travel_to
    ? ` Route on the imprest: ${imprest.travel_from || '?'} → ${imprest.travel_to || '?'}${plannedKm ? ` (${plannedKm} km ≈ ₹${estimate} at ₹${rate}/km)` : ''}.`
    : '';
  return {
    vehicleType,
    rate,
    from: imprest.travel_from || null,
    to: imprest.travel_to || null,
    plannedKm,
    estimate,
    reasoning: `Own ${vehicleType} trip — paid per km, so there is no bill to check.${route} Read the employee's description of where they went and why, then approve or reject.`,
  };
}
