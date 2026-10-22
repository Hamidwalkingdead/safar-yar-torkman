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
