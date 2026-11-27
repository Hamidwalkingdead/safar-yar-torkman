-- Do not trap a passenger in a group they cannot individually leave yet.
DROP TRIGGER IF EXISTS prevent_duplicate_active_shared_booking ON public.shared_bookings;
DROP FUNCTION IF EXISTS public.prevent_duplicate_active_shared_booking();
