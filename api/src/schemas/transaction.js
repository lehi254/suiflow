import Joi from 'joi';

// Create transaction schema
export const createTransactionSchema = Joi.object({
  receiverPhone: Joi.string()
    .pattern(/^\+?[1-9]\d{1,14}$/)
    .required()
    .messages({
      'string.pattern.base': 'Receiver phone number must be a valid international format',
      'any.required': 'Receiver phone number is required'
    }),
  
  amount: Joi.number()
    .positive()
    .precision(6) // Allow up to 6 decimal places for SUI
    .min(0.000001) // Minimum amount (1 MIST in SUI)
    .max(1000000) // Maximum amount (1 million SUI)
    .required()
    .messages({
      'number.positive': 'Amount must be positive',
      'number.min': 'Amount must be at least 0.000001 SUI',
      'number.max': 'Amount cannot exceed 1,000,000 SUI',
      'any.required': 'Amount is required'
    }),
  
  pin: Joi.string()
    .length(4)
    .pattern(/^\d{4}$/)
    .required()
    .messages({
      'string.length': 'PIN must be exactly 4 digits',
      'string.pattern.base': 'PIN must contain only numbers',
      'any.required': 'PIN is required'
    })
});

// Get transactions schema (query parameters)
export const getTransactionsSchema = Joi.object({
  limit: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .default(50)
    .messages({
      'number.integer': 'Limit must be an integer',
      'number.min': 'Limit must be at least 1',
      'number.max': 'Limit cannot exceed 100'
    }),
  
  offset: Joi.number()
    .integer()
    .min(0)
    .default(0)
    .messages({
      'number.integer': 'Offset must be an integer',
      'number.min': 'Offset cannot be negative'
    })
});