import { app } from './app.js';
import { env } from './config/env.js';
import { mysqlPool } from './db/client.js';

const server = app.listen(env.API_PORT, env.API_HOST, () => {
	console.info(`SLA API listening at http://${env.API_HOST}:${env.API_PORT}`);
});

async function shutdown(signal: string): Promise<void> {
	console.info(`${signal} received. Shutting down API.`);
	server.close(async () => {
		await mysqlPool.end();
		process.exit(0);
	});
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
