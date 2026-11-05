import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

export const mysqlPool = mysql.createPool({
	host: env.DB_HOST,
	port: env.DB_PORT,
	database: env.DB_NAME,
	user: env.DB_USER,
	password: env.DB_PASSWORD,
	waitForConnections: true,
	connectionLimit: 10,
	queueLimit: 0
});

export async function checkDatabaseConnection(): Promise<void> {
	await mysqlPool.query('SELECT 1');
}
