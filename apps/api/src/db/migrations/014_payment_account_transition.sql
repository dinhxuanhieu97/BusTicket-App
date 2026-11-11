ALTER TABLE operator_payment_accounts ADD COLUMN receive_until timestamptz;
ALTER TABLE bookings ADD COLUMN payment_account_id uuid REFERENCES operator_payment_accounts(id);

CREATE TABLE booking_previous_payment_accounts (
  booking_id uuid NOT NULL REFERENCES bookings(id),
  account_id uuid NOT NULL REFERENCES operator_payment_accounts(id),
  PRIMARY KEY (booking_id, account_id)
);

-- Existing payable bookings may already have received the currently active QR.
UPDATE bookings b SET payment_account_id = a.id
FROM operator_payment_accounts a
WHERE a.operator_id = b.operator_id AND a.active
  AND b.paid_amount < b.total_amount
  AND (b.status IN ('HOLDING', 'CONFIRMED') OR (b.status = 'EXPIRED' AND b.release_at > now() - interval '72 hours'));
