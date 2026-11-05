import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { apiRouter } from './routes/api.routes.js';

export const app = express();

app.disable('x-powered-by');
app.use(helmet());
const allowedOrigins = new Set([env.FRONTEND_ORIGIN]);
if (env.NODE_ENV === 'development') {

	allowedOrigins.add('http://localhost:5173');
	allowedOrigins.add('http://127.0.0.1:5173');
}

app.use(
	cors({
		origin(origin, callback) {
			if (!origin || allowedOrigins.has(origin)) {
				callback(null, true);
				return;
			}

			callback(null, false);
		}
	})
);
app.use(express.json({ limit: '1mb' }));
app.use('/api/v1', apiRouter);

app.use((_request, response) => {
	response.status(404).json({
		status: 'error',
		message: 'Route not found'
	});
});
