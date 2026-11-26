import 'dotenv/config';
import { z } from 'zod';

export function isUatDatabaseName(name: string): boolean {
	return /^sla_pengajuan$/i.test(name) || /_staging$/i.test(name);
}

const envSchema = z.object({
	NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
	API_HOST: z.string().min(1).default('127.0.0.1'),
	API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
	FRONTEND_ORIGIN: z.string().url().default('http://localhost:5173'),
	DB_HOST: z.string().min(1).default('127.0.0.1'),
	DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
	DB_NAME: z.string().min(1).default('sla_pengajuan'),
	DB_USER: z.string().min(1),
	DB_PASSWORD: z.string().default(''),
	SSO_BASE_URL: z.string().url(),
	SSO_APP_CODE: z.string().min(1),
	SSO_APP_TOKEN: z.string().trim().default(''),
	SSO_DUMMY_LOGIN_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
	SSO_DUMMY_LOGIN_UAT_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
	SSO_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
	PRIVATE_UPLOAD_DIR: z.string().trim().min(1).default('./private-uploads'),
	SSO_CONNECT_IP: z.preprocess(
		(value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
		z.string().trim()
			.regex(/^(?:\d{1,3}\.){3}\d{1,3}$/)
			.refine((value) => value.split('.').every((part) => Number(part) <= 255), 'must be a valid IPv4 address')
			.optional()
	),
	SLA_INITIAL_ADMIN_EMPLOYEE_ID: z.string().trim().default(''),
	DUMMY_AUTH_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true')
}).superRefine((config, context) => {
	const isUatDatabase = isUatDatabaseName(config.DB_NAME);
	if (config.NODE_ENV === 'production' && config.DUMMY_AUTH_ENABLED && !isUatDatabase) {
		context.addIssue({
			code: 'custom',
			path: ['DUMMY_AUTH_ENABLED'],
			message: 'Dummy authentication in production is only allowed for sla_pengajuan during UAT or databases ending in _staging.'
		});
	}
	if (config.SSO_DUMMY_LOGIN_UAT_ENABLED && (config.NODE_ENV !== 'production' || !isUatDatabase)) {
		context.addIssue({
			code: 'custom',
			path: ['SSO_DUMMY_LOGIN_UAT_ENABLED'],
			message: 'UAT SSO dummy login requires NODE_ENV=production and DB_NAME=sla_pengajuan or a database ending in _staging.'
		});
	}
	if (config.SSO_DUMMY_LOGIN_UAT_ENABLED && !config.SSO_DUMMY_LOGIN_ENABLED) {
		context.addIssue({
			code: 'custom',
			path: ['SSO_DUMMY_LOGIN_UAT_ENABLED'],
			message: 'SSO_DUMMY_LOGIN_ENABLED must also be true to enable the UAT exception.'
		});
	}
	if (config.SSO_DUMMY_LOGIN_ENABLED && config.NODE_ENV !== 'development' && !config.SSO_DUMMY_LOGIN_UAT_ENABLED) {
		context.addIssue({
			code: 'custom',
			path: ['SSO_DUMMY_LOGIN_ENABLED'],
			message: 'Remote SSO dummy login outside development requires SSO_DUMMY_LOGIN_UAT_ENABLED=true on an approved UAT database.'
		});
	}
	if (config.SSO_DUMMY_LOGIN_ENABLED && !config.SSO_APP_TOKEN) {
		context.addIssue({
			code: 'custom',
			path: ['SSO_APP_TOKEN'],
			message: 'SSO_APP_TOKEN is required when remote SSO dummy login is enabled.'
		});
	}
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
	const issues = result.error.issues
		.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
		.join('; ');
	throw new Error(`Invalid environment configuration: ${issues}`);
}

export const env = result.data;
