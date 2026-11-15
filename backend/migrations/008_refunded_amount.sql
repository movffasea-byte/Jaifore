-- How much of each order has been refunded so far, in dollars. The refund
-- route checks new refunds against what is left and updates this with a
-- compare-and-set, so a double click can't record (or pay out) twice.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(10,2) NOT NULL DEFAULT 0;

-- Fully refunded orders refunded their whole total. Partly refunded ones
-- stay at 0: the amount was never stored, and Stripe still refuses any
-- refund above what is actually left on the charge.
UPDATE orders SET refunded_amount = total
 WHERE payment_status = 'refunded' AND refunded_amount = 0;
