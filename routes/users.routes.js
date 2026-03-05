const express = require('express');
const usersController = require('../controllers/users.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

// Protect all routes after this middleware
router.use(protect);

// Restrict all routes to admin only
router.use(restrictTo('admin'));

router.route('/')
  .get(usersController.getAllUsers)
  .post(usersController.createUser);

router.route('/:id')
  .get(usersController.getUser)
  .patch(usersController.updateUser)
  .delete(usersController.deleteUser);

router.patch('/:id/role', usersController.updateUserRole);

module.exports = router;