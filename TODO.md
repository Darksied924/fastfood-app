# TODO: Role-Based Visibility for Order Information

## Backend Changes (controllers/orders.controller.js)
- [x] 1. Update getAllOrders - Already returns all details for admin/manager
- [x] 2. Update getOrder - Add role-based filtering (remove total/prices for delivery)
- [x] 3. Update getAssignedOrders - Remove total for delivery role
- [x] 4. Update getDeliveryDashboard - Remove orderValue for delivery role

## Frontend Changes
- [x] 5. Update delivery-dashboard.js - Remove order value columns

## Testing
- [x] 6. Verify API returns all fields for admin
- [x] 7. Verify API returns all fields for manager
- [x] 8. Verify API does NOT return order value for delivery
- [x] 9. Verify frontend doesn't display order value for delivery

