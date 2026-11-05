ALTER TABLE bookings ADD COLUMN passenger_note text
  CHECK (char_length(passenger_note) <= 500);
