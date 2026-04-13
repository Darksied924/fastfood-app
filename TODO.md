# Schema Migration Fix TODO
✅ 1. Create/update TODO.md (current)
✅ 2. Edit schema-migrations.sql with all fixes
   - ✅ Change INT UNSIGNED → INT (all FKs/PKs)
   - ✅ Remove redundant ALTER orders status
   - ✅ Add ON UPDATE CASCADE to FKs
   - ✅ Remove duplicate INDEXes
   - ✅ Remove verification SHOW/DESCRIBE
✅#q7@H5fS 3. Test migration: Full DB recreate + run both schemas → success (no FK errors)
✅ 4. Verify: Tables created, FKs correct, describes show INT types
✅ 5. Complete task
