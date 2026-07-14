import { createLogger, format, transports } from 'winston';

const { combine, timestamp, json, errors } = format;

export const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  defaultMeta: { service: 'shadow-brain' },
  format: combine(timestamp(), errors({ stack: true }), json()),
  transports: [
    new transports.Console(),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new transports.File({ filename: 'logs/error.log', level: 'error' }));
  logger.add(new transports.File({ filename: 'logs/combined.log' }));
}

export default logger;
