import mysql from 'mysql2/promise';
import type { PoolConnection } from 'mysql2';
import { env } from '../config/env.js';

const mysqlSessionTimeZone = '+07:00';

export const mysqlPool = mysql.createPool({
	host: env.DB_HOST,
	port: env.DB_PORT,
	database: env.DB_NAME,
	user: env.DB_USER,
	password: env.DB_PASSWORD,
	timezone: mysqlSessionTimeZone,
	waitForConnections: true,
	connectionLimit: 10,
	queueLimit: 0
});

mysqlPool.on('connection', (connection) => {
	const callbackConnection = connection as unknown as PoolConnection;
	callbackConnection.query(`SET time_zone = '${mysqlSessionTimeZone}'`, (error) => {
		if (error) callbackConnection.destroy();
	});
});

export async function checkDatabaseConnection(): Promise<void> {
	await mysqlPool.query('SELECT 1');
}
