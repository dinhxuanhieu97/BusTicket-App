ALTER TABLE operator_policies
  ADD COLUMN deposit_single int CHECK (deposit_single BETWEEN 1 AND 20000000),
  ADD COLUMN deposit_double int CHECK (deposit_double BETWEEN 1 AND 20000000),
  ADD CONSTRAINT operator_policies_fixed_deposit_pair
    CHECK ((deposit_single IS NULL) = (deposit_double IS NULL));
