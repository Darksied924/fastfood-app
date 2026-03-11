# TODO - Database Schema Migration for Order Replacements

## Task
Update the database schema to support order replacements feature:
- Add `replaces_order_id` column to orders table
- Add 'replaced' status enum value

## Steps Completed:
- [x] Read and analyze schema.sql to understand the target schema
- [x] Read order.service.js to understand the code requirements
- [x] Read db.js to understand the existing migration system

## Steps Remaining:
- [ ] Update db.js to add migration for replaces_order_id column
- [ ] Update db.js to add migration for 'replaced' status enum
- [ ] Test the migration by running the application

## Implementation Details:
The fix involves adding two migrations in db.js:
1. Add `replaces_order_id` column (INT UNSIGNED NULL) with FK constraint
2. Modify status ENUM to include 'replaced' value

