const { validationResult } = require('express-validator');
const { errorResponse } = require('../utils/response.util');

/**
 * Middleware to check validation results
 * Should be used after validation chain in routes
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    // Format errors nicely
    const formattedErrors = errors.array().map(err => ({
      field: err.path || err.param,
      message: err.msg
    }));
    
    return errorResponse(res, 'Validation failed', 400, formattedErrors);
  }
  
  next();
};

module.exports = validate;

