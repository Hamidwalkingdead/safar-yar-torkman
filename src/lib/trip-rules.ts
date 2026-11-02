export type TripStatus = "pending" | "accepted" | "ongoing" | "done" | "cancelled";
export function allowedTransition(
  current: TripStatus,
  next: TripStatus,
  party: "passenger" | "driver",
) {
  if (party === "passenger")
    return next === "cancelled" && ["pending", "accepted"].includes(current);
  return (
    (current === "pending" && next === "accepted") ||
    (current === "accepted" && next === "ongoing") ||
    (current === "ongoing" && next === "done") ||
    (["accepted", "ongoing"].includes(current) && next === "cancelled")
  );
}
export const contactsVisible = (status: TripStatus, participant: boolean) =>
  participant && ["accepted", "ongoing", "done"].includes(status);

export function pendingForDriver(
  trip: { status: string; passenger_id: string; departure_at: string },
  driverId: string | null,
  now = Date.now(),
) {
  return (
    !!driverId &&
    trip.status === "pending" &&
    trip.passenger_id !== driverId &&
    new Date(trip.departure_at).getTime() > now
  );
}

export function tripParty(
  trip: { passenger_id: string; driver_id: string | null },
  userId: string | null,
): "passenger" | "driver" | null {
  if (!userId) return null;
  if (trip.driver_id === userId) return "driver";
  if (trip.passenger_id === userId) return "passenger";
  return null;
}
